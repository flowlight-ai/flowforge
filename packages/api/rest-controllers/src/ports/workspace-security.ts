/**
 * Workspace security + worktree/linked-root resolution seam.
 *
 * Rebuilds clowder's `domains/workspace/workspace-security.ts` as pure logic on
 * injected seams: traversal/denylist/symlink guards, worktree listing via the
 * injected GitSeam, and linked-roots persistence via LinkedRootsStore. Host
 * wires the real filesystem + config in EP2.
 */

import type { GitSeam } from './git.ts';
import type { WorktreeEntry } from '../contract/workspace.ts';
import { WorkspaceSecurityError } from '../contract/workspace.ts';
import { normalize } from './workspace-fs.ts';

const DENYLIST_PATTERNS = [/^\.env/, /\.pem$/, /\.key$/, /^id_rsa/];
const DENYLIST_DIRS = new Set(['.git', 'secrets']);

/** Worktree-id → absolute root. Populated by `/api/workspace/worktrees`. */
export class WorktreeRegistry {
  private readonly registry = new Map<string, string>();
  register(entries: WorktreeEntry[]): void {
    for (const e of entries) this.registry.set(e.id, e.root);
  }
  get(id: string): string | undefined {
    return this.registry.get(id);
  }
  entries(): Array<[string, string]> {
    return [...this.registry.entries()];
  }
}

export interface LinkedRootsStore {
  list(): Promise<WorktreeEntry[]> | WorktreeEntry[];
  add(name: string, path: string): Promise<WorktreeEntry> | WorktreeEntry;
  remove(linkedId: string): boolean | Promise<boolean>;
}

export class MemoryLinkedRootsStore implements LinkedRootsStore {
  private readonly entries = new Map<string, WorktreeEntry>();
  constructor(seed: WorktreeEntry[] = []) {
    for (const e of seed) this.entries.set(e.id, e);
  }
  list(): WorktreeEntry[] {
    return [...this.entries.values()];
  }
  add(name: string, path: string): WorktreeEntry {
    const id = `linked_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const entry: WorktreeEntry = { id, root: path, branch: name, head: 'linked' };
    this.entries.set(id, entry);
    return entry;
  }
  remove(linkedId: string): boolean {
    return this.entries.delete(linkedId);
  }
}

export interface WorktreeResolverOptions {
  git: GitSeam;
  linkedRoots: LinkedRootsStore;
  registry?: WorktreeRegistry;
  cwd?: string;
  /** Real-path resolution for symlink escape detection (identity in memory). */
  realpath?: (p: string) => Promise<string> | string;
}

function worktreeIdForRoot(root: string): string {
  const base = root.replace(/[\\/]+$/, '');
  const name = base.split(/[\\/]/).pop() ?? base;
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function isDenylisted(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/);
  for (const seg of segments) {
    if (DENYLIST_DIRS.has(seg)) return true;
    for (const pat of DENYLIST_PATTERNS) {
      if (pat.test(seg)) return true;
    }
  }
  return false;
}

export function resolveWorkspaceFilesystemPath(
  root: string,
  filesystemPath: string,
  realpath?: (p: string) => Promise<string> | string,
): Promise<string> | string {
  return resolvePathValue(root, filesystemPath, realpath);
}

function resolvePathValue(
  root: string,
  pathValue: string,
  realpath?: (p: string) => Promise<string> | string,
): Promise<string> | string {
  const resolved = normalize(joinPath(root, pathValue));
  const realRoot = normalize(root);

  if (!resolved.startsWith(realRoot + '/') && resolved !== realRoot) {
    throw new WorkspaceSecurityError('Path outside workspace root', 'TRAVERSAL');
  }
  const relFromRoot = resolved === realRoot ? '' : resolved.slice(realRoot.length + 1);
  for (const seg of relFromRoot.split('/')) {
    if (DENYLIST_DIRS.has(seg)) throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
    for (const pat of DENYLIST_PATTERNS) {
      if (pat.test(seg)) throw new WorkspaceSecurityError(`Access denied: ${seg}`, 'DENIED');
    }
  }

  if (realpath) {
    const check = async (): Promise<string> => {
      const real = normalize(await realpath(resolved));
      const realR = normalize(await realpath(realRoot));
      if (!real.startsWith(realR + '/') && real !== realR) {
        throw new WorkspaceSecurityError('Symlink escapes workspace root', 'TRAVERSAL');
      }
      return resolved;
    };
    return check();
  }
  return resolved;
}

function joinPath(root: string, pathValue: string): string {
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(pathValue);
  const r = normalize(root);
  if (pathValue.startsWith('/')) {
    // Absolute within root's container is treated as relative-from-root for safety.
    return normalize(root + '/' + pathValue);
  }
  if (isWinAbs) {
    return normalize(pathValue);
  }
  return normalize(r + '/' + pathValue);
}

export class WorkspaceSecurity {
  readonly registry: WorktreeRegistry;
  constructor(private readonly opts: WorktreeResolverOptions) {
    this.registry = opts.registry ?? new WorktreeRegistry();
  }

  private cwd(): string {
    return this.opts.cwd ?? '.';
  }

  async listWorktrees(repoRoot?: string): Promise<WorktreeEntry[]> {
    const cwd = repoRoot ?? this.cwd();
    const { stdout } = await this.opts.git.exec(cwd, ['worktree', 'list', '--porcelain'], { timeoutMs: 5000 });
    if (!stdout.trim()) {
      return [{ id: worktreeIdForRoot(cwd), root: cwd, branch: 'exported', head: 'nogit' }];
    }
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.root) entries.push(current as WorktreeEntry);
        const root = line.slice('worktree '.length);
        current = { root, id: worktreeIdForRoot(root), branch: 'HEAD', head: '' };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length, 'HEAD '.length + 8);
      } else if (line.startsWith('branch ')) {
        const branchRef = line.slice('branch '.length);
        current.branch = branchRef.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : branchRef;
      }
    }
    if (current.root) entries.push(current as WorktreeEntry);
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) e.id = `${e.id}_${e.head}`;
      seen.add(e.id);
    }
    return entries;
  }

  async getWorktreeRoot(worktreeId: string, repoRoot?: string): Promise<string> {
    const entries = await this.listWorktrees(repoRoot);
    const entry = entries.find((e) => e.id === worktreeId);
    if (entry) return entry.root;
    const linked = await this.opts.linkedRoots.list();
    const linkedEntry = linked.find((r) => r.id === worktreeId);
    if (linkedEntry) return linkedEntry.root;
    const registered = this.registry.get(worktreeId);
    if (registered) return registered;
    throw new WorkspaceSecurityError(`Worktree not found: ${worktreeId}`, 'NOT_FOUND');
  }

  resolveFilesystemPath(root: string, filesystemPath: string): Promise<string> | string {
    return resolveWorkspaceFilesystemPath(root, filesystemPath, this.opts.realpath);
  }
}