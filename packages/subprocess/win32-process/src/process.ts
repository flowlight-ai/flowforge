/**
 * Node-native process lifecycle helpers for the FlowForge host platform
 * (Windows-first). Unlike the low-level FFI primitives in the original
 * package, this port builds directly on `node:child_process` and `process`
 * and uses `taskkill` for tree kills, so it needs no native module and runs
 * on every platform Node supports.
 *
 * Understandings:
 * - `process.kill(pid, SIGTERM)` on Windows maps to TerminateProcess and only
 *   terminates that single process — it never follows descendants.
 * - A real tree kill therefore shells out to `taskkill /T /F`, which
 *   terminates the child and everything it spawned.
 * @module @flowforge/win32-process/process
 */

import { spawn as nodeSpawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { platform } from 'node:os'

/** Process spawn inputs owned by the caller. */
export interface SpawnProcessOptions {
  /** Executable argv entry passed through to `child_process.spawn`. */
  command: string
  /** Arguments excluding the executable. */
  args?: readonly string[]
  /** Existing child working directory. */
  cwd?: string
  /** Explicit environment for the child (default: inherit the current one). */
  env?: NodeJS.ProcessEnv
  /** Hide the console window on Windows (default true). */
  windowsHide?: boolean
}

/** Result of a driver-level tree kill. */
export interface TreeKillResult {
  /** Number of processes killed (the root and any reported children). */
  killed: number
  /** Whether the root still appeared alive after the kill. */
  signalSent: boolean
}

const isWindowsFlag = platform() === 'win32'

/** Whether the current host is Windows (tree-kill routing target). */
export function isWindows(): boolean {
  return isWindowsFlag
}

/**
 * Spawn a child with pipe'd stdio and Windows console hiding by default.
 * @param options - command, args, cwd, and optional environment override.
 * @returns a live ChildProcess handle.
 */
export function spawnProcess(options: SpawnProcessOptions): ChildProcess {
  const child = nodeSpawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    windowsHide: options.windowsHide ?? true,
    stdio: 'pipe',
  })
  return child
}

/**
 * Resolve the child's exit code, rejecting on spawn-time errors. Node sets
 * `child.exitCode` before emitting the `exit` event, so a non-null value
 * proves the event already happened; checking it first closes the race where
 * the caller attaches after the child exited.
 * @param child - a live ChildProcess.
 * @returns the exit code (signal-only exits resolve to 1).
 */
export function waitForProcessExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
}

/** Best-effort single-process signal; never throws for an already-dead pid. */
async function signalProcess(pid: number, signal: NodeJS.Signals): Promise<boolean> {
  try {
    return process.kill(pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/**
 * Terminate one direct child. On Windows a single `SIGKILL` is what actually
 * forces termination (`SIGTERM` is treated the same as it cannot be caught),
 * but we defer to the caller's signal on POSIX.
 * @param pid - the direct child process id.
 * @param signal - signal to send (ignored-as-SIGKILL on Windows).
 * @returns whether the pid was alive and signalled.
 */
export async function terminateProcess(pid: number, signal: NodeJS.Signals = 'SIGKILL'): Promise<boolean> {
  const effective = isWindowsFlag ? 'SIGKILL' : signal
  return signalProcess(pid, effective)
}

/** Interpret a `taskkill` exit code: 0 ok, 128 already gone, 255 access denied/unknown pid. */
function taskkillOk(code: number | null): boolean {
  return code === 0 || code === 128
}

/**
 * Kill a process tree. On Windows this shells out to `taskkill /PID <pid>
 * /T /F` which forcibly terminates the root and every descendant — Node's own
 * `process.kill` cannot reach grandchildren. On POSIX it walks the children
 * via `ps` recursively then signals the root last.
 * @param pid - the root process id.
 * @param signal - POSIX-only signal for non-Windows hosts.
 * @returns the number of nodes signalled and whether the root was alive.
 */
export async function treeKill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<TreeKillResult> {
  if (isWindowsFlag) {
    const code = await new Promise<number | null>(resolve => {
      const taskkill = execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
        (error, _stdout, _stderr) => {
          resolve(error === null ? 0 : (error as NodeJS.ErrnoException & { code?: string | number }).code === 'ENOENT'
            ? null
            : Number((error as { code?: unknown }).code) || 1)
        },
      )
      taskkill.once('error', () => resolve(null))
    })
    if (code === null) {
      // taskkill not available — fall back to a best-effort single kill.
      return { killed: (await signalProcess(pid, 'SIGKILL')) ? 1 : 0, signalSent: true }
    }
    return { killed: taskkillOk(code) ? 1 : 0, signalSent: true }
  }

  // POSIX: recurse into children discovered via `ps -o pid= --ppid <pid>`.
  const children = await new Promise<number[]>(resolve => {
    execFile('ps', ['-o', 'pid=', '--ppid', String(pid)], { windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        resolve([])
        return
      }
      const pids = stdout
        .trim()
        .split(/\s+/u)
        .map(raw => Number.parseInt(raw, 10))
        .filter(raw => Number.isFinite(raw) && raw > 0)
      resolve(pids)
    })
  })
  let killed = 0
  for (const child of children) {
    killed += (await treeKill(child, signal)).killed
  }
  killed += (await signalProcess(pid, signal)) ? 1 : 0
  return { killed, signalSent: killed > 0 }
}