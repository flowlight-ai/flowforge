/**
 * Host-side bootstrap for the Python subprocess: how the interpreter is located
 * and invoked. The entry script is the shipped `py/bootstrap.py`, spawned with
 * `-u` (unbuffered stdio) against a scrubbed environment; program text and
 * binding namespaces cross on fd 3, so the child never touches a program file.
 * @module @flowforge/code-runtime-python/bootstrap
 */

import { fileURLToPath } from 'node:url'

/** The POSIX-safe interpreter name; on Windows `python3` is rarely installed. */
function defaultPythonBin(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'python' : 'python3'
}

/**
 * The absolute path of the Python entry script the child runs. Shipped next to
 * the built JS under `py/`; the interpreter is an external process so it must
 * resolve to a real filesystem path.
 */
export const PY_BOOTSTRAP_PATH = fileURLToPath(new URL('../py/bootstrap.py', import.meta.url))

/**
 * The interpreter command line, resolved at load. An explicit `pythonBin`
 * config wins; otherwise the platform-default `python3` (POSIX) or `python`.
 */
export function resolvePythonCommand(pythonBin: string | undefined, platform: NodeJS.Platform = process.platform): string {
  return pythonBin || defaultPythonBin(platform)
}

/**
 * The `spawn` arguments for one run: the unbuffered flag plus the entry script.
 * The child finds its sibling `py/protocol.py` by inserting its own directory
 * on `sys.path`, so no module import resolution is needed here.
 */
export function buildPythonArgs(bootstrapPath: string = PY_BOOTSTRAP_PATH): string[] {
  return ['-u', bootstrapPath]
}