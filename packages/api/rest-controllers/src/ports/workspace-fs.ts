/**
 * Filesystem + shell seam (self-contained).
 *
 * Replaces clowder's direct `node:fs` / `child_process.execFile` / `find` so the
 * workspace controllers are testable via an injected in-memory implementation.
 * EP2 wires the host's real filesystem / command execution.
 */

import { createHash } from 'node:crypto';

export interface FileStat {
  path: string;
  type: 'file' | 'directory';
  size: number;
}

export interface WorkspaceFsSeam {
  /** Enumerate all file paths under a root directory (find semantics). */
  listFiles(root: string): Promise<string[]>;
  /** Read a text file; returns null when missing. */
  readFileText(path: string): Promise<string | null>;
  stat(path: string): Promise<FileStat | null>;
  writeFileText(path: string, content: string): Promise<void>;
  writeFileBytes(path: string, bytes: Uint8Array): Promise<void>;
  mkdirp(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Directory listing used to build the tree (entries relative to dir). */
  readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  /** Optional reveal seam: open path in OS file manager (injected platform cmd). */
  revealBranch?: RevealBranch;
}

/** Platform-specific reveal command construction (injected for testability). */
export type RevealBranch = 'darwin' | 'win32' | 'linux';

export interface RevealSeam {
  /** Construct the exec args + program used to reveal a file/dir on a platform. */
  revealCommand(platform: RevealBranch, resolvedPath: string, isDirectory: boolean): RevealCommand | null;
}

export interface RevealCommand {
  program: string;
  args: string[];
}

export class DefaultRevealSeam implements RevealSeam {
  revealCommand(platform: RevealBranch, resolvedPath: string, isDirectory: boolean): RevealCommand | null {
    if (platform === 'darwin') {
      return isDirectory ? { program: 'open', args: [resolvedPath] } : { program: 'open', args: ['-R', resolvedPath] };
    }
    if (platform === 'win32') {
      return { program: 'explorer', args: ['/select,', resolvedPath] };
    }
    return { program: 'xdg-open', args: [isDirectory ? resolvedPath : parentDir(resolvedPath)] };
  }
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  const idxWin = path.lastIndexOf('\\');
  const cut = Math.max(idx, idxWin);
  return cut <= 0 ? path : path.slice(0, cut);
}

/** hash helper used by the fs/security + edit-token layers. */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.yaml', '.yml']);
const BINARY_PATH = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip']);

export function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'text/plain';
}

export function isTextPreview(path: string, content: string): boolean {
  const ext = path.split('.').pop();
  if (ext && BINARY_PATH.has(`.${ext.toLowerCase()}`)) return false;
  return TEXT_EXTENSIONS.has(extAndDot(path)) || !content.includes('\u0000');
}

function extAndDot(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx <= 0 ? '' : path.slice(idx);
}

/**
 * In-memory contract implementation (real store, no mocks).
 * `files` are keyed by normalized path with POSIX separators.
 */
export class MemoryWorkspaceFs implements WorkspaceFsSeam {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(['/']);

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      const normalized = normalize(path);
      this.files.set(normalized, content);
      this.ensureParents(normalized);
    }
  }

  private ensureParents(path: string): void {
    let idx = path.lastIndexOf('/');
    while (idx > 0) {
      const parent = path.slice(0, idx);
      this.dirs.add(parent || '/');
      idx = parent.lastIndexOf('/');
    }
    this.dirs.add('/');
  }

  async listFiles(root: string): Promise<string[]> {
    const base = normalize(root);
    const prefix = base === '/' ? '' : base + '/';
    return [...this.files.keys()]
      .filter((p) => (prefix ? p.startsWith(prefix) : true))
      .map((p) => p)
      .sort((a, b) => a.localeCompare(b));
  }
  async readFileText(path: string): Promise<string | null> {
    return this.files.get(normalize(path)) ?? null;
  }
  async stat(path: string): Promise<FileStat | null> {
    const n = normalize(path);
    if (this.files.has(n)) return { path: n, type: 'file', size: (this.files.get(n) as string).length };
    if (this.dirs.has(n) || hasChild(this.files, n)) return { path: n, type: 'directory', size: 0 };
    return null;
  }
  async writeFileText(path: string, content: string): Promise<void> {
    const n = normalize(path);
    this.files.set(n, content);
    this.ensureParents(n);
  }
  async writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
    const n = normalize(path);
    this.files.set(n, bytesToLatin1(bytes));
    this.ensureParents(n);
  }
  async mkdirp(path: string): Promise<void> {
    const n = normalize(path);
    this.dirs.add(n);
    this.ensureParents(n);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(normalize(path));
  }
  async removeDir(path: string): Promise<void> {
    const n = normalize(path);
    this.dirs.delete(n);
    for (const p of [...this.files.keys()]) {
      if (p.startsWith(n + '/')) this.files.delete(p);
    }
  }
  async rename(from: string, to: string): Promise<void> {
    const nf = normalize(from);
    const nt = normalize(to);
    if (this.files.has(nf)) {
      const content = this.files.get(nf) as string;
      this.files.delete(nf);
      this.files.set(nt, content);
      this.ensureParents(nt);
    } else if (this.dirs.has(nf)) {
      this.dirs.delete(nf);
      this.dirs.add(nt);
    }
  }
  async readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const n = normalize(path);
    const prefix = n === '/' ? '' : n + '/';
    const out: Array<{ name: string; isDirectory: boolean }> = [];
    const seen = new Set<string>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const seg = rest.split('/')[0];
      if (!seg || seen.has(seg)) continue;
      seen.add(seg);
      out.push({ name: seg, isDirectory: rest.includes('/') });
    }
    for (const d of this.dirs) {
      if (!d.startsWith(prefix) || d === n) continue;
      const rest = d.slice(prefix.length);
      const seg = rest.split('/')[0] ?? '';
      if (!seg || seen.has(seg)) continue;
      seen.add(seg);
      out.push({ name: seg, isDirectory: true });
    }
    return out;
  }

  put(path: string, content: string): this {
    const n = normalize(path);
    this.files.set(n, content);
    this.ensureParents(n);
    return this;
  }
}

function hasChild(files: Map<string, string>, dir: string): boolean {
  const prefix = dir === '/' ? '' : dir + '/';
  for (const key of files.keys()) {
    if (prefix ? key.startsWith(prefix) : true) return true;
  }
  return false;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

export function normalize(path: string): string {
  const unix = path.replace(/\\/g, '/');
  const stripped = unix.replace(/^\/+/, '');
  const parts: string[] = [];
  for (const seg of stripped.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}