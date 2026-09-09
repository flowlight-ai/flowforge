/**
 * Git seam — injected command execution with command-construction guards.
 *
 * Controllers build git command lines (args) and delegate execution to this
 * seam. Contract tests inject a MemoryGitSeam that returns canned stdout per
 * (cwd, command); EP2 binds the real `git` binary.
 */

export interface GitOutput {
  stdout: string;
  /** Whether the command "failed" (git uses non-zero exit for diffs/detached). */
  ok: boolean;
}

export interface GitSeam {
  exec(cwd: string, args: string[], opts?: { timeoutMs?: number }): Promise<GitOutput>;
}

/**
 * In-memory contract implementation. Route git command construction is verified
 * by asserting the recorded commands; stdout is served from a key→stdout map.
 */
export class MemoryGitSeam implements GitSeam {
  private readonly scripted = new Map<string, string>();
  readonly calls: Array<{ cwd: string; args: string[] }> = [];

  constructor(script: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(script)) this.scripted.set(key, value);
  }

  /** Address a script by a "startswith" key of the joined args. */
  private keyOf(args: string[]): string {
    return args.join(' ');
  }

  exec(cwd: string, args: string[], opts?: { timeoutMs?: number }): Promise<GitOutput> {
    void opts;
    this.calls.push({ cwd, args: [...args] });
    const key = this.keyOf(args);
    for (const [scriptKey, stdout] of this.scripted.entries()) {
      if (key.startsWith(scriptKey)) {
        return Promise.resolve({ stdout, ok: true });
      }
    }
    return Promise.resolve({ stdout: '', ok: true });
  }

  /** Script a fuller match: script prefix + later args (e.g. show <hash>). */
  script(argsPrefix: string, stdout: string): void {
    this.scripted.set(argsPrefix, stdout);
  }

  clear(): void {
    this.calls.length = 0;
  }
}