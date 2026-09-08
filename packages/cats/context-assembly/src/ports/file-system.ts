/**
 * Filesystem seam (self-contained).
 *
 * Replaces clowder's direct `node:fs` / `findMonorepoRoot()` access so
 * governance-l0, prompt-template-loader and staging-content are testable via an
 * injected in-memory implementation. EP2 wires the host's real filesystem.
 */

export interface FileSystemSeam {
  /** Root of the monorepo / install. Path inputs are resolved relative to it. */
  rootDir: string;
  readFileSync(path: string): string | null;
  existsSync(path: string): boolean;
}

/**
 * In-memory contract implementation used by vitest (real store, no mocks).
 * `files` are keyed by absolute path fragment; `readFileSync` resolves the
 * requested path to an absolute path under `rootDir` before lookup.
 */
export class MemoryFileSystem implements FileSystemSeam {
  rootDir: string;
  private files = new Map<string, string>();

  constructor(rootDir = '.', files: Record<string, string> = {}) {
    this.rootDir = rootDir;
    for (const [key, value] of Object.entries(files)) this.files.set(key, value);
  }

  private resolve(path: string): string {
    // Strip leading slashes so Windows/Posix absolute fragments align with keys.
    return path.replace(/^[/\\]+/, '');
  }

  readFileSync(path: string): string | null {
    return this.files.get(this.resolve(path)) ?? null;
  }

  existsSync(path: string): boolean {
    return this.files.has(this.resolve(path));
  }

  put(path: string, content: string): void {
    this.files.set(this.resolve(path), content);
  }
}