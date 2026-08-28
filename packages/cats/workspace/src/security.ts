/**
 * @flowforge/cats-workspace — workspace 安全层（F063）。
 *
 * TS 移植自 clowder-ai `domains/workspace/workspace-security.ts`：
 * traversal / symlink-escape / denylist 三重防护 + worktree 注册表 +
 * linked roots（env + .cat-cafe/linked-roots.json）。
 * 插件化改造：模块级单例（worktreeRegistry / process.cwd / process.env）
 * 全部提升为 `WorkspaceSecurity` 实例字段（host 可注入 cwd / env / GitRunner）。
 *
 * @module @flowforge/cats-workspace/security
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import type { GitRunner } from './git-worktree-probe.js';
import { readGitWorktreeList } from './git-worktree-probe.js';

const DENYLIST_PATTERNS = [/^\.env/, /\.pem$/, /\.key$/, /^id_rsa/];

const DENYLIST_DIRS = new Set(['.git', 'secrets']);

export class WorkspaceSecurityError extends Error {
  constructor(
    message: string,
    public readonly code: 'TRAVERSAL' | 'DENIED' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'WorkspaceSecurityError';
  }
}

export interface WorktreeEntry {
  id: string;
  canonicalId?: string;
  root: string;
  branch: string;
  head: string;
}

export interface WorkspaceSecurityOptions {
  /** 默认工作目录（缺省 process.cwd()）。 */
  readonly cwd?: string;
  /** 环境变量（缺省 process.env；WORKSPACE_LINKED_ROOTS 读取）。 */
  readonly env?: NodeJS.ProcessEnv;
  /** git 执行端口（缺省 nodeGitRunner）。 */
  readonly gitRunner?: GitRunner;
  /** linked roots 配置文件路径（缺省 <cwd>/.cat-cafe/linked-roots.json）。 */
  readonly linkedRootsConfigPath?: string;
}

/**
 * workspace 安全服务：路径校验 + worktree 注册表 + linked roots。
 * 实例级状态（registry / cwd / env），宿主可注入 GitRunner 与持久化路径。
 */
export class WorkspaceSecurity {
  private readonly registry = new Map<string, string>();
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly gitRunner: GitRunner;
  private readonly configPath: string;

  constructor(options: WorkspaceSecurityOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.gitRunner = options.gitRunner ?? (null as never); // 延迟绑定，避免循环依赖
    this.configPath = options.linkedRootsConfigPath ?? resolve(this.cwd, '.cat-cafe', 'linked-roots.json');
    // gitRunner 缺省在方法内用 nodeGitRunner（延迟 import 防循环引用）
  }

  private runner(): GitRunner {
    return this.gitRunner ?? import('./git-worktree-probe.js').then((m) => m.nodeGitRunner) as never;
  }

  /** 注册 worktree 条目，供 getWorktreeRoot 后续解析（foreign repos）。 */
  registerWorktrees(entries: WorktreeEntry[]): void {
    for (const e of entries) this.registry.set(e.id, e.root);
  }

  private async resolveWorkspacePathValue(root: string, pathValue: string): Promise<string> {
    const resolved = resolve(root, pathValue);
    const relFromRoot = relative(root, resolved);

    if (relFromRoot.startsWith('..') || resolve(root, relFromRoot) !== resolved) {
      throw new WorkspaceSecurityError('Path outside workspace root', 'TRAVERSAL');
    }

    const segments = relFromRoot.split(sep);
    for (const seg of segments) {
      if (DENYLIST_DIRS.has(seg)) {
        throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
      }
      for (const pat of DENYLIST_PATTERNS) {
        if (pat.test(seg)) {
          throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
        }
      }
    }

    // Symlink escape check：resolve 完整真实路径（跟随每段 symlink），
    // 同时 realpath root（处理 root 本身经过 symlink 的情况，如 macOS /tmp → /private/tmp）。
    try {
      const [real, realRoot] = await Promise.all([realpath(resolved), realpath(root)]);
      if (!real.startsWith(realRoot + sep) && real !== realRoot) {
        throw new WorkspaceSecurityError('Symlink escapes workspace root', 'TRAVERSAL');
      }
      // realpath 结果上复查 denylist：名为 "safe" 指向 ".env" 的 symlink 也必须拒绝
      const realRel = relative(realRoot, real);
      for (const seg of realRel.split(sep)) {
        if (DENYLIST_DIRS.has(seg)) {
          throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
        }
        for (const pat of DENYLIST_PATTERNS) {
          if (pat.test(seg)) {
            throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
          }
        }
      }
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) throw e;
      // ENOENT = 文件尚不存在；上面的 traversal 检查已覆盖
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }

    return resolved;
  }

  /** 解析 URI 形态（用户提供、可能含 %-escape）的相对路径。 */
  async resolveWorkspacePath(root: string, userPath: string): Promise<string> {
    return this.resolveWorkspacePathValue(root, decodeURIComponent(userPath));
  }

  /** 解析原生文件系统相对路径（不解释字面 % 为 URI 转义）。绝对路径适配器必须用此入口。 */
  async resolveWorkspaceFilesystemPath(root: string, filesystemPath: string): Promise<string> {
    return this.resolveWorkspacePathValue(root, filesystemPath);
  }

  /** 相对路径是否命中 denylist（搜索结果过滤用）。 */
  isDenylisted(relPath: string): boolean {
    const segments = relPath.split(/[\\/]/);
    for (const seg of segments) {
      if (DENYLIST_DIRS.has(seg)) return true;
      for (const pat of DENYLIST_PATTERNS) {
        if (pat.test(seg)) return true;
      }
    }
    return false;
  }

  private worktreeIdForRoot(root: string): string {
    return basename(root).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /** 向上查找 cat-cafe-skills/manifest.yaml 定位项目根（startup-root 语义）。 */
  private resolveStartupProjectRoot(startDir?: string): string {
    let dir = startDir ?? this.cwd;
    while (dir !== dirname(dir)) {
      const candidate = resolve(dir, 'cat-cafe-skills', 'manifest.yaml');
      if (existsSync(candidate)) return dir;
      dir = dirname(dir);
    }
    return this.cwd;
  }

  private fallbackWorktreeEntry(cwd: string): WorktreeEntry {
    const root = this.resolveStartupProjectRoot(cwd);
    return {
      id: this.worktreeIdForRoot(root),
      root,
      branch: 'exported',
      head: 'nogit',
    };
  }

  /** 列出 git worktrees（非 git 仓库回退为 startup root 单条目）。 */
  async listWorktrees(repoRoot?: string): Promise<WorktreeEntry[]> {
    const cwd = repoRoot ?? this.cwd;
    const stdout = await readGitWorktreeList(cwd, this.runner());
    if (stdout === null) return [this.fallbackWorktreeEntry(cwd)];
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.root) entries.push(current as WorktreeEntry);
        const root = line.slice('worktree '.length);
        current = {
          root,
          id: this.worktreeIdForRoot(root),
          branch: 'HEAD',
          head: '',
        };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length, 'HEAD '.length + 8);
      } else if (line.startsWith('branch ')) {
        const branchRef = line.slice('branch '.length);
        current.branch = branchRef.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : branchRef;
      }
    }
    if (current.root) entries.push(current as WorktreeEntry);

    // Deduplicate IDs
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) e.id = `${e.id}_${e.head}`;
      seen.add(e.id);
    }

    return entries;
  }

  /** 全部 workspace root 条目：git worktrees + linked roots + 注册表。 */
  async listWorkspaceRootEntries(repoRoot?: string): Promise<WorktreeEntry[]> {
    const [worktrees, linked] = await Promise.all([this.listWorktrees(repoRoot), this.getLinkedRootsAsync()]);
    const entries = [...worktrees, ...linked];
    for (const [id, root] of this.registry.entries()) {
      entries.push({ id, root, branch: 'registered', head: 'registered' });
    }
    return entries;
  }

  /** 按 worktreeId 解析 root 绝对路径；找不到抛 NOT_FOUND。 */
  async getWorktreeRoot(worktreeId: string, repoRoot?: string): Promise<string> {
    const entries = await this.listWorktrees(repoRoot);
    const entry = entries.find((e) => e.id === worktreeId);
    if (entry) return entry.root;

    const linked = await this.getLinkedRootsAsync();
    const linkedEntry = linked.find((r) => r.id === worktreeId);
    if (linkedEntry) return linkedEntry.root;

    const registeredRoot = this.registry.get(worktreeId);
    if (registeredRoot) return registeredRoot;

    throw new WorkspaceSecurityError(`Worktree not found: ${worktreeId}`, 'NOT_FOUND');
  }

  /** 反向查找：给定绝对目录路径 → canonical worktreeId。 */
  async resolveWorktreeIdByPath(dirPath: string, repoRoot?: string): Promise<string> {
    const resolved = resolve(dirPath);
    const canonicalResolved = await realpath(resolved).catch(() => resolved);

    const entries = await this.listWorktrees(repoRoot);
    const entry = (
      await Promise.all(
        entries.map(async (e) => ({
          entry: e,
          canonicalRoot: await realpath(e.root).catch(() => e.root),
        })),
      )
    ).find(({ entry, canonicalRoot }) => entry.root === resolved || canonicalRoot === canonicalResolved)?.entry;
    if (entry) return entry.id;

    const linked = await this.getLinkedRootsAsync();
    const linkedEntry = (
      await Promise.all(
        linked.map(async (r) => ({
          entry: r,
          canonicalRoot: await realpath(r.root).catch(() => r.root),
        })),
      )
    ).find(({ entry, canonicalRoot }) => entry.root === resolved || canonicalRoot === canonicalResolved)?.entry;
    if (linkedEntry) return linkedEntry.id;

    for (const [id, root] of this.registry.entries()) {
      const canonicalRoot = await realpath(root).catch(() => root);
      if (root === resolved || canonicalRoot === canonicalResolved) return id;
    }

    throw new WorkspaceSecurityError(`No worktree found for path: ${dirPath}`, 'NOT_FOUND');
  }

  private toLinkedEntry(name: string, rootPath: string): WorktreeEntry {
    return {
      id: `linked_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      root: resolve(rootPath),
      branch: name,
      head: 'linked',
    };
  }

  private async readLinkedRootsConfig(): Promise<Array<{ name: string; path: string }>> {
    try {
      const data = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeLinkedRootsConfig(entries: Array<{ name: string; path: string }>): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  }

  /** env var 里的 linked roots（格式 "name:path,name:path"）。 */
  getLinkedRoots(): WorktreeEntry[] {
    const envRoots: WorktreeEntry[] = [];
    const raw = this.env.WORKSPACE_LINKED_ROOTS;
    if (raw) {
      for (const segment of raw.split(',')) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) continue;
        envRoots.push(this.toLinkedEntry(trimmed.slice(0, colonIdx).trim(), trimmed.slice(colonIdx + 1).trim()));
      }
    }
    return envRoots;
  }

  /** 全部 linked roots（env + config 合并，env 优先去重）。 */
  async getLinkedRootsAsync(): Promise<WorktreeEntry[]> {
    const envRoots = this.getLinkedRoots();
    const configEntries = await this.readLinkedRootsConfig();
    const configRoots = configEntries.map((e) => this.toLinkedEntry(e.name, e.path));

    const seen = new Set(envRoots.map((r) => r.id));
    const merged = [...envRoots];
    for (const cr of configRoots) {
      if (!seen.has(cr.id)) {
        merged.push(cr);
        seen.add(cr.id);
      }
    }
    return merged;
  }

  /** 添加 linked root 到配置文件（校验路径存在且为目录）。 */
  async addLinkedRoot(name: string, rootPath: string): Promise<WorktreeEntry> {
    const resolved = resolve(rootPath);
    const st = await stat(resolved).catch(() => null);
    if (!st || !st.isDirectory()) {
      throw new WorkspaceSecurityError(`Path is not a directory: ${resolved}`, 'NOT_FOUND');
    }

    const entries = await this.readLinkedRootsConfig();
    const entry = this.toLinkedEntry(name, resolved);
    const filtered = entries.filter((e) => this.toLinkedEntry(e.name, e.path).id !== entry.id);
    filtered.push({ name, path: resolved });
    await this.writeLinkedRootsConfig(filtered);
    return entry;
  }

  /** 按 linkedId 移除 linked root；不存在返回 false。 */
  async removeLinkedRoot(linkedId: string): Promise<boolean> {
    const entries = await this.readLinkedRootsConfig();
    const filtered = entries.filter((e) => this.toLinkedEntry(e.name, e.path).id !== linkedId);
    if (filtered.length === entries.length) return false;
    await this.writeLinkedRootsConfig(filtered);
    return true;
  }
}
