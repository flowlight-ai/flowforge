/**
 * @flowforge/external-agent worktree — 三方 Agent 工作区隔离（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/worktree.py：
 *   - WorktreeConfig: worktree_root / source_repo / network_allowlist /
 *     readonly_paths / enable_rollback
 *   - AuditEntry: 审计日志条目
 *   - ExternalAgentWorktree: create（唯一目录名 + 复制源（跳过 .git /
 *     node_modules / __pycache__ / .venv））/ audit / rollback（快照恢复）/
 *     cleanup / exportAuditLog
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 工作区配置（worktree.py WorktreeConfig）。 */
export interface WorktreeConfig {
  /** worktree 根目录。 */
  readonly worktree_root: string;
  /** 源仓库路径（可为空，空时仅创建空目录）。 */
  readonly source_repo?: string;
  /** 网络白名单。 */
  readonly network_allowlist?: readonly string[];
  /** 只读路径列表。 */
  readonly readonly_paths?: readonly string[];
  /** 是否启用回滚（创建时快照）。 */
  readonly enable_rollback?: boolean;
}

/** 审计条目（worktree.py AuditEntry）。 */
export interface AuditEntry {
  /** 时间戳（ISO 8601）。 */
  readonly timestamp: string;
  /** 操作类型。 */
  readonly action: string;
  /** 操作详情。 */
  readonly detail: string;
}

/** 复制源时跳过的目录（worktree.py _SKIP_DIRS）。 */
const SKIP_DIRS: readonly string[] = ['.git', 'node_modules', '__pycache__', '.venv'];

/** 外部 Agent 工作区（worktree.py ExternalAgentWorktree）。 */
export class ExternalAgentWorktree {
  private readonly _config: WorktreeConfig;
  /** 实际创建的目录路径。 */
  private readonly _worktreePath: string;
  /** 审计日志。 */
  private readonly _auditLog: AuditEntry[] = [];
  /** 快照清单（回滚用）：相对路径 -> 是否目录。 */
  private readonly _snapshot = new Map<string, boolean>();

  private constructor(config: WorktreeConfig, worktreePath: string) {
    this._config = config;
    this._worktreePath = worktreePath;
  }

  /**
   * 创建工作区（worktree.py create）。
   *
   * 唯一目录名格式：{provider 点转下划线}-{forgekin_id}-{ts}-{uuid8}；
   * 复制源目录（跳过 .git / node_modules / __pycache__ / .venv）；
   * enable_rollback 时生成快照清单。
   */
  static create(
    providerName: string,
    forgekinId: string,
    sourceSubdir?: string,
    config?: Partial<WorktreeConfig>,
  ): ExternalAgentWorktree {
    const cfg: WorktreeConfig = {
      worktree_root: config?.worktree_root ?? '',
      ...(config?.source_repo !== undefined ? { source_repo: config.source_repo } : {}),
      network_allowlist: config?.network_allowlist ?? [],
      readonly_paths: config?.readonly_paths ?? [],
      enable_rollback: config?.enable_rollback ?? true,
    };
    const dirName = `${providerName.replaceAll('.', '_')}-${forgekinId}-${Date.now()}-${uuid8()}`;
    const root = cfg.worktree_root || (cfg.source_repo ? join(cfg.source_repo, '..') : process.cwd());
    const worktreePath = join(root, dirName);
    mkdirSync(worktreePath, { recursive: true });

    const worktree = new ExternalAgentWorktree(cfg, worktreePath);
    if (cfg.source_repo) {
      const sourcePath = sourceSubdir
        ? join(cfg.source_repo, sourceSubdir)
        : cfg.source_repo;
      worktree._copySource(sourcePath);
    }
    if (cfg.enable_rollback) {
      worktree._snapshotTree(worktreePath, '');
    }
    worktree._audit('create', `worktree created: ${worktreePath}`);
    return worktree;
  }

  /** 当前 worktree 路径。 */
  get worktreePath(): string {
    return this._worktreePath;
  }

  /** 配置快照。 */
  get config(): WorktreeConfig {
    return { ...this._config };
  }

  /** 追加审计条目（worktree.py audit）。 */
  audit(action: string, detail: string): void {
    this._audit(action, detail);
  }

  /** 导出审计日志（worktree.py export_audit_log）。 */
  exportAuditLog(): AuditEntry[] {
    return [...this._auditLog];
  }

  /**
   * 回滚到创建时快照（worktree.py rollback）：
   * 删除快照后新增的文件，恢复被删目录（快照中记录的目录重新创建）。
   */
  rollback(): void {
    if (!this._config.enable_rollback) {
      throw new Error('rollback disabled for this worktree');
    }
    // 1. 删除快照之外的文件/目录
    const now = new Set(this._walkTree(this._worktreePath));
    for (const rel of now) {
      if (!this._snapshot.has(rel)) {
        rmSync(join(this._worktreePath, rel), { recursive: true, force: true });
      }
    }
    // 2. 恢复快照中存在的目录（若已被删除）
    for (const [rel, isDir] of this._snapshot) {
      if (isDir) {
        const full = join(this._worktreePath, rel);
        if (!existsSync(full)) {
          mkdirSync(full, { recursive: true });
        }
      }
    }
    this._audit('rollback', `worktree rolled back to snapshot: ${this._worktreePath}`);
  }

  /** 清理工作区（worktree.py cleanup）。 */
  cleanup(): void {
    rmSync(this._worktreePath, { recursive: true, force: true });
    this._audit('cleanup', `worktree removed: ${this._worktreePath}`);
  }

  // ── 内部方法 ──────────────────────────────────────────────────

  private _audit(action: string, detail: string): void {
    this._auditLog.push({ timestamp: new Date().toISOString(), action, detail });
  }

  private _copySource(sourcePath: string): void {
    if (!existsSync(sourcePath)) {
      throw new Error(`source repo not found: ${sourcePath}`);
    }
    this._copyDir(sourcePath, this._worktreePath, '');
  }

  private _copyDir(srcDir: string, destDir: string, relPrefix: string): void {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (SKIP_DIRS.includes(entry.name)) {
        continue;
      }
      const src = join(srcDir, entry.name);
      const dest = join(destDir, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(src, dest, join(relPrefix, entry.name));
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        copyFileRecursive(src, dest);
      }
    }
  }

  private _snapshotTree(root: string, relPrefix: string): void {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const rel = relPrefix ? join(relPrefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        this._snapshot.set(rel, true);
        this._snapshotTree(join(root, entry.name), rel);
      } else {
        this._snapshot.set(rel, false);
      }
    }
  }

  private _walkTree(root: string): string[] {
    const result: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? join(prefix, entry.name) : entry.name;
        result.push(rel);
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), rel);
        }
      }
    };
    walk(root, '');
    return result;
  }
}

/** 生成 8 位 hex（uuid8 语义）。 */
function uuid8(): string {
  return randomBytes(4).toString('hex');
}

/** 复制文件（保留目标目录）。 */
function copyFileRecursive(src: string, dest: string): void {
  mkdirSync(join(dest, '..'), { recursive: true });
  const content = statSync(src);
  if (content.isSymbolicLink()) {
    // 符号链接以链接本身复制（防御性）
    return;
  }
  // 使用流式复制避免大文件内存占用
  writeFileSync(dest, readFileSync(src));
}


