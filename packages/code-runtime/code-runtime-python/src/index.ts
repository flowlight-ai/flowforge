/**
 * Python process code runtime: a fresh CPython subprocess runs each program and
 * bridges bindings host-side over a stdio JSON-lines protocol (fd 3). This is
 * containment, not a security boundary: model code has process-level trust
 * despite an empty environment, wall-clock and output-byte budgets, and
 * terminate-on-abort/timeout.
 * @module @flowforge/code-runtime-python
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import { Context } from '@flowforge/cordis'
import z from '@flowforge/schemastery'
import { MAX_TIMER_DELAY_MS } from '@flowforge/timeout'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@flowforge/code-runtime'
import type { CodeBindingNamespace, CodeJsonValue, CodeRunFailure, CodeRunRequest, CodeRunResult } from '@flowforge/code-runtime'
import { snapshotJsonValue } from '@flowforge/session'
import { buildPythonArgs, resolvePythonCommand } from './bootstrap.ts'
import type { BootMessage, CallMessage, DoneMessage, ReplyMessage } from './protocol.ts'
import { encodeJsonPlain, hasNonLosslessNumber, hasUnsafeIntegerToken, validateChildFrame } from './protocol.ts'
import { jsonStringBytesUpTo, jsonValueBytesUpTo, truncateJsonStringBytes } from './output-json.ts'

/** Plugin config: every execution cap, changeable from `cordis.yml`. */
export interface Config {
  /** Wall-clock ceiling in milliseconds; the backstop for an awaiting program. At most `MAX_TIMER_DELAY_MS`. */
  maxWallMs?: number
  /** Hard cap for serialized log-array, completion-value, and failure-message payloads; fixed result-envelope syntax is excluded. */
  maxOutputBytes?: number
  /** Absolute path, relative path, or basename of the CPython interpreter. Defaults to `python3` (POSIX) or `python`. */
  pythonBin?: string
}

/** {@link Config} after schemastery fills the defaults (every field present). */
type ResolvedConfig = Required<Config>

/** The interpreter name resolved at load, mirroring `pythonBin`'s default. */
const DEFAULT_PYTHON_BIN = resolvePythonCommand(undefined)

/** Smallest cap that can represent the counted payloads: an empty logs array plus an empty JSON failure message. */
const MIN_OUTPUT_BYTES = 4

/** SIGTERM→SIGKILL escalation window when terminating a run's subprocess. */
const KILL_GRACE_MS = 2_000

/**
 * A frame's RAW length is capped before `JSON.parse`: the cap admits every
 * legal in-budget value (a JSON-escaped payload never exceeds ~6x its bytes)
 * while bounding host decode amplification from a forged near-infinite frame.
 */
function frameParseCap(maxOutputBytes: number): number {
  return maxOutputBytes * 6 + 1024
}

/**
 * The seam's language-portable identifier subset (see
 * `CodeBindingNamespace.global`).
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Render an unknown thrown value as a message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve after a child pipe emits all queued data, or closes/errors during termination. */
function waitForPipeDrain(stream: Readable | null): Promise<void> {
  if (stream === null || stream.readableEnded || stream.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      stream.off('end', done)
      stream.off('close', done)
      stream.off('error', done)
      resolve()
    }
    stream.once('end', done)
    stream.once('close', done)
    stream.once('error', done)
    if (stream.readableEnded || stream.destroyed) done()
  })
}

/** One run's combined outer-output ledger; binding values never enter it. */
class OutputLedger {
  private bytes = 2 // JSON serialization of the empty logs array: []
  private entries = 0

  constructor(private readonly maxBytes: number) {}

  /** Admit one exact log entry, or report that the hard cap was crossed. */
  admit(text: string, sink: string[]): boolean {
    const separatorBytes = this.entries > 0 ? 1 : 0
    const stringBytes = jsonStringBytesUpTo(text, this.maxBytes - this.bytes - separatorBytes)
    if (stringBytes === undefined) return false
    this.bytes += stringBytes + separatorBytes
    this.entries += 1
    sink.push(text)
    return true
  }

  /** Finalize a successful absent-or-JSON completion against the combined cap. */
  success(logs: string[], value?: CodeJsonValue): CodeRunResult {
    if (value !== undefined && jsonValueBytesUpTo(value, this.maxBytes - this.bytes) === undefined) return this.limit(logs)
    return { logs, ...value !== undefined ? { value } : {} }
  }

  /** Finalize a failure diagnostic, with output-limit taking precedence when combined bytes exceed the cap. */
  failure(logs: string[], error: CodeRunFailure): CodeRunResult {
    if (jsonStringBytesUpTo(error.message, this.maxBytes - this.bytes) === undefined) return this.limit(logs)
    return { logs, error }
  }

  /** Build the explicit output-limit failure while retaining a fitting prefix of the final log. */
  limit(logs: string[]): CodeRunResult {
    const fullMessage = `outer output exceeded ${this.maxBytes} bytes`
    // The fixed diagnostic is ASCII, so every character is one byte plus the quotes.
    const messageBytes = fullMessage.length + 2
    const retained: string[] = []
    let retainedBytes = 2
    const logBudget = this.maxBytes - messageBytes
    for (const text of logs) {
      const separatorBytes = retained.length > 0 ? 1 : 0
      const availableBytes = logBudget - retainedBytes - separatorBytes
      const stringBytes = jsonStringBytesUpTo(text, availableBytes)
      if (stringBytes !== undefined) {
        retained.push(text)
        retainedBytes += stringBytes + separatorBytes
        continue
      }
      const prefix = truncateJsonStringBytes(text, availableBytes)
      if (prefix.length > 0) {
        const prefixBytes = jsonStringBytesUpTo(prefix, availableBytes)
        /* v8 ignore next -- truncateJsonStringBytes guarantees its returned prefix fits the same budget. */
        if (prefixBytes === undefined) throw new Error('output ledger produced an oversized log prefix')
        retained.push(prefix)
        retainedBytes += prefixBytes + separatorBytes
      }
      break
    }
    const availableMessageBytes = this.maxBytes - retainedBytes
    const message = truncateJsonStringBytes(fullMessage, availableMessageBytes)
    return { logs: retained, error: { kind: 'output-limit', message } }
  }
}

/** One in-flight run's host-side state, tracked for disposal. */
interface LiveRun {
  child: ChildProcess
  settle(failure: CodeRunFailure): void
  finished: Promise<void>
}

/**
 * The shipped {@link CodeRuntime} backend (`ctx.codeRuntime`) for Python. Runs
 * each program in a fresh CPython subprocess; every cap comes from validated
 * config. See the module doc for the containment model and the Service
 * Definition's class JSDoc for the contract this implements.
 */
export class PythonCodeRuntime extends CodeRuntime {
  static Config: z<Config> = z.object({
    maxWallMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(67_108_864),
    pythonBin: z.string().default(DEFAULT_PYTHON_BIN),
  })

  readonly language = 'python'
  readonly isolation = 'process'

  private readonly config: ResolvedConfig
  private readonly live = new Set<LiveRun>()
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery filled the defaults; the cast records that. Positivity is a
    // semantic check the schema's plain number type does not carry.
    this.config = config as ResolvedConfig
    // Positivity is a numeric constraint only; the numeric caps are checked here
    // while the string `pythonBin` is exempted (schemastery's plain number type
    // carries no positivity).
    for (const [key, value] of Object.entries(this.config)) {
      if (typeof value === 'number' && !(Number.isFinite(value) && value > 0)) {
        throw new Error(`flowforge-code-runtime-python: config.${key} must be a positive number, got ${String(value)}`)
      }
    }
    if (!Number.isSafeInteger(this.config.maxOutputBytes) || this.config.maxOutputBytes < MIN_OUTPUT_BYTES) {
      throw new Error(`flowforge-code-runtime-python: config.maxOutputBytes must be a safe integer of at least ${MIN_OUTPUT_BYTES}, got ${String(this.config.maxOutputBytes)}`)
    }
    if (this.config.maxWallMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`flowforge-code-runtime-python: config.maxWallMs must be at most ${MAX_TIMER_DELAY_MS}, got ${String(this.config.maxWallMs)}`)
    }
    ctx.effect(() => () => this.teardown(), 'python code-runtime teardown')
  }

  /** Dispose to quiescence: mark the service unusable, fail every in-flight run, and AWAIT each child's exit. */
  private async teardown(): Promise<void> {
    this.disposed = true
    const runs = [...this.live]
    for (const run of runs) run.settle({ kind: 'abort', message: 'runtime disposed' })
    await Promise.all(runs.map(run => run.finished))
  }

  /**
   * Execute one program in a fresh Python subprocess. Program outcomes —
   * including a host-side bindings rejection — resolve with `result.error`; the
   * method rejects only for Service Definition contract misuse.
   * @param request - the program, its bindings, and the abort signal.
   * @returns the run's outcome per the seam contract.
   */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) throw new Error('flowforge-code-runtime-python: run() after disposal')
    const bindings = this.validateBindings(request)
    if (request.signal?.aborted) {
      return this.failureBeforeWorker({ kind: 'abort', message: String(request.signal.reason) })
    }
    return await this.execute(request, bindings)
  }

  /** Apply the outer-output ledger to failures that occur before a subprocess owns one. */
  private failureBeforeWorker(error: CodeRunFailure): CodeRunResult {
    return new OutputLedger(this.config.maxOutputBytes).failure([], error)
  }

  /** Reject malformed binding globals or typed-error declarations as Service Definition contract misuse. */
  private validateBindings(request: CodeRunRequest): Map<string, CodeBindingNamespace> {
    const bindings = new Map<string, CodeBindingNamespace>()
    for (const namespace of request.bindings) {
      if (!IDENTIFIER.test(namespace.global) || PORTABLE_RESERVED_WORDS.has(namespace.global)) {
        throw new Error(`flowforge-code-runtime-python: binding global ${JSON.stringify(namespace.global)} is not a usable identifier`)
      }
      if (RESERVED_BINDING_GLOBALS.has(namespace.global)) {
        throw new Error(`flowforge-code-runtime-python: reserved binding global ${JSON.stringify(namespace.global)}`)
      }
      if (bindings.has(namespace.global)) {
        throw new Error(`flowforge-code-runtime-python: duplicate binding global ${JSON.stringify(namespace.global)}`)
      }
      bindings.set(namespace.global, namespace)
    }

    const errorClassNames = new Set<string>()
    for (const namespace of request.bindings) {
      const descriptor = namespace.errorClass
      if (!descriptor) continue
      if (!IDENTIFIER.test(descriptor.name) || PORTABLE_RESERVED_WORDS.has(descriptor.name)) {
        throw new Error(`flowforge-code-runtime-python: binding error class ${JSON.stringify(descriptor.name)} is not a usable identifier`)
      }
      if (RESERVED_BINDING_GLOBALS.has(descriptor.name)) {
        throw new Error(`flowforge-code-runtime-python: reserved binding global ${JSON.stringify(descriptor.name)}`)
      }
      if (bindings.has(descriptor.name) || errorClassNames.has(descriptor.name)) {
        throw new Error(`flowforge-code-runtime-python: duplicate injected global ${JSON.stringify(descriptor.name)}`)
      }
      const member = descriptor.memberNameProperty
      if (member.length === 0 || RESERVED_ERROR_MEMBERS.has(member) || DUNDER_MEMBER.test(member)) {
        throw new Error(`flowforge-code-runtime-python: binding error member property ${JSON.stringify(descriptor.memberNameProperty)} is not usable`)
      }
      errorClassNames.add(descriptor.name)
    }
    return bindings
  }

  /** Spawn the fresh Python subprocess for one validated run and drive it to settlement. */
  private execute(request: CodeRunRequest, bindings: Map<string, CodeBindingNamespace>): Promise<CodeRunResult> {
    const boot: BootMessage = {
      type: 'boot',
      maxOutputBytes: this.config.maxOutputBytes,
      namespaces: [...bindings].map(([global, namespace]) => ({
        global,
        names: Object.keys(namespace.functions),
        ...namespace.errorClass ? { errorClass: { name: namespace.errorClass.name, memberNameProperty: namespace.errorClass.memberNameProperty } } : {},
      })),
    }

    let child: ChildProcess | undefined
    try {
      child = spawn(this.config.pythonBin, buildPythonArgs(), {
        // fd 3 carries host->child frames (boot / run / reply); fd 4 carries
        // child->host frames (boot-ack / call / log / done). Splitting the
        // directions onto two pipes lets the child read and write concurrently:
        // a single pipe handle blocked-read and -written from separate threads
        // stalls on Windows.
        stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
        env: {},
        cwd: tmpdir(),
        windowsHide: true,
      })
    } catch (error: unknown) {
      return Promise.resolve(this.failureBeforeWorker({ kind: 'worker-exit', message: `failed to spawn python: ${messageOf(error)}` }))
    }

    return new Promise<CodeRunResult>((resolve) => {
      let settled = false
      const answered = new Set<number>()
      const logs: string[] = []
      const strayLogs: string[] = []
      const output = new OutputLedger(this.config.maxOutputBytes)
      const protoCap = frameParseCap(this.config.maxOutputBytes)

      const writeEnd = child.stdio[3]
      const readEnd = child.stdio[4]
      if (writeEnd == null || readEnd == null) {
        resolve(this.failureBeforeWorker({ kind: 'worker-exit', message: 'python subprocess protocol fds unavailable' }))
        return
      }
      const toChild: Writable = writeEnd as Writable
      const fromChild: Readable = readEnd as Readable

      const toChildWrite = (text: string): void => {
        try { toChild.write(`${text}\n`) } catch { /* subscriber gone */ }
      }

      const answerBinding = (payload: ReplyMessage): void => {
        if (settled) return
        toChildWrite(encodeJsonPlain(payload))
      }

      // Terminate the child (SIGTERM, escalating to SIGKILL) and await its exit.
      const terminate = (): Promise<void> => {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
        return new Promise<void>((resolveExit) => {
          let done = false
          const killEscalator = setTimeout(() => {
            try { child.kill('SIGKILL') } catch { /* already gone */ }
          }, KILL_GRACE_MS)
          const close = (): void => {
            if (done) return
            done = true
            clearTimeout(killEscalator)
            resolveExit()
          }
          child.once('exit', close)
          child.once('error', close)
          // Reap the state-change race between the guard above and the listeners.
          if (child.exitCode !== null || child.signalCode !== null) close()
          try { child.kill() } catch { /* already gone */ }
        })
      }

      let finishResolve!: () => void
      const finished = new Promise<void>((done) => { finishResolve = done })

      let wallTimer: NodeJS.Timeout | undefined = undefined
      let onAbort: (() => void) | undefined = undefined

      const finish = (finalize: CodeRunResult | (() => CodeRunResult)): void => {
        if (settled) return
        settled = true
        if (wallTimer !== undefined) clearTimeout(wallTimer)
        if (onAbort !== undefined) request.signal?.removeEventListener('abort', onAbort)
        this.live.delete(live)
        // Deliver pipe bytes already queued independently of the terminal frame
        // before termination closes the streams.
        void new Promise<void>((resume) => { setImmediate(resume) }).then(async () => {
          const stdoutDrained = waitForPipeDrain(child.stdout)
          const stderrDrained = waitForPipeDrain(child.stderr)
          await terminate()
          await Promise.all([stdoutDrained, stderrDrained])
          const result = typeof finalize === 'function' ? finalize() : finalize
          finishResolve()
          resolve(result)
        })
      }

      // Backstop capture: the bootstrap async-wraps writes into its own fd-3
      // frames, so these pipes normally stay silent; native-level writes land here.
      const captureStray = (chunk: Buffer): void => {
        if (settled) return
        const text = chunk.toString('utf8')
        if (!output.admit(text, strayLogs)) {
          finish(output.limit([...logs, ...strayLogs, text]))
        }
      }
      child.stdout?.on('data', captureStray)
      child.stderr?.on('data', captureStray)

      // Exactly one outcome wins; every path terminates and awaits the child.
      const onDone = (message: DoneMessage): void => {
        if (message.error) {
          const { kind, message: errorMessage } = message.error
          finish(() => output.failure([...logs, ...strayLogs], { kind, message: errorMessage }))
          return
        }
        if (message.value === undefined) {
          finish(() => output.success([...logs, ...strayLogs]))
          return
        }
        if (hasNonLosslessNumber(message.value)) {
          finish(() => output.failure([...logs, ...strayLogs], { kind: 'invalid-output', message: 'program completion must be lossless JSON' }))
          return
        }
        finish(() => output.success([...logs, ...strayLogs], message.value as CodeJsonValue))
      }

      const onCall = (message: CallMessage): void => {
        if (settled) return
        if (answered.has(message.id)) return
        answered.add(message.id)
        const record = bindings.get(message.global)?.functions
        // Own-property lookup only: a forged name must not walk the prototype chain.
        const fn = record && Object.hasOwn(record, message.name) ? record[message.name] : undefined
        if (typeof fn !== 'function') {
          answerBinding({ type: 'reply', id: message.id, ok: false, message: `unknown binding ${JSON.stringify(`${message.global}.${message.name}`)}` })
          return
        }
        if (hasNonLosslessNumber(message.args)) {
          answerBinding({ type: 'reply', id: message.id, ok: false, message: 'binding arguments must be lossless JSON' })
          return
        }
        void (async () => {
          try {
            const resolved = await fn(message.args)
            let value: CodeJsonValue | undefined
            try { value = snapshotJsonValue(resolved) } catch { value = undefined }
            if (value === undefined) answerBinding({ type: 'reply', id: message.id, ok: false, message: 'binding resolution must be lossless JSON' })
            else answerBinding({ type: 'reply', id: message.id, ok: true, value })
          } catch (error: unknown) {
            answerBinding({ type: 'reply', id: message.id, ok: false, message: messageOf(error) })
          }
        })()
      }

      // fd-3 JSON-lines reader: the peer is hostile, so frames are validated.
      let protoBuf = Buffer.alloc(0)
      const handleChunk = (chunk: Buffer): void => {
        protoBuf = Buffer.concat([protoBuf, chunk])
        while (protoBuf.length > 0) {
          const nl = protoBuf.indexOf(0x0a)
          if (nl === -1) break
          const line = protoBuf.subarray(0, nl)
          protoBuf = protoBuf.subarray(nl + 1)
          if (line.length === 0 || settled) continue
          if (line.length > protoCap) { finish(() => output.failure([...logs, ...strayLogs], { kind: 'worker-exit', message: 'python frame exceeded the parse cap' })); return }
          const lineText = line.toString('utf8')
          let raw: unknown
          try { raw = JSON.parse(lineText) } catch { continue }
          const message = validateChildFrame(raw)
          if (!message || settled) continue
          if (message.type === 'log') {
            if (!output.admit(message.text, logs)) { finish(output.limit([...logs, ...strayLogs, message.text])); return }
            continue
          }
          if (message.type === 'call') { onCall(message); continue }
          if (message.type === 'done') {
            if (message.value !== undefined && hasUnsafeIntegerToken(lineText)) {
              finish(() => output.failure([...logs, ...strayLogs], { kind: 'invalid-output', message: 'program completion must be lossless JSON' }))
              return
            }
            onDone(message)
            return
          }
        }
        if (!settled && protoBuf.length > protoCap) {
          finish(() => output.failure([...logs, ...strayLogs], { kind: 'worker-exit', message: 'python protocol overflowed the buffer' }))
        }
      }
      fromChild.on('data', handleChunk)

      const fail = (failure: CodeRunFailure): void => {
        finish(() => output.failure([...logs, ...strayLogs], failure))
      }
      child.on('error', (error: Error) => fail({ kind: 'worker-exit', message: `failed to start python: ${error.message}` }))
      child.on('exit', (exitCode: number) => {
        if (!settled) fail({ kind: 'worker-exit', message: `python exited with code ${exitCode} before completing` })
      })

      wallTimer = setTimeout(() => {
        fail({ kind: 'timeout', message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)` })
      }, this.config.maxWallMs)
      onAbort = (): void => {
        fail({ kind: 'abort', message: String(request.signal?.reason) })
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      // The run is registered, then the boot/run frames are sent. Order matters:
      // registration must precede any terminal (abort) path.
      const live: LiveRun = { child, finished, settle: fail }
      this.live.add(live)

      toChildWrite(encodeJsonPlain(boot))
      toChildWrite(encodeJsonPlain({ type: 'run', program: request.program }))
    })
  }
}

export default PythonCodeRuntime