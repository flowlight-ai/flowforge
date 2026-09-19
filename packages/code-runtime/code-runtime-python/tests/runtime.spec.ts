import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { Context } from '@flowforge/cordis'
import { PythonCodeRuntime } from '../src/index.ts'
import { resolvePythonCommand } from '../src/bootstrap.ts'
import type { Config } from '../src/index.ts'
import type { CodeBindingFunction, CodeBindingNamespace, CodeRunResult } from '@flowforge/code-runtime'

/** Whether a real CPython interpreter is reachable; integration cases skip when absent. */
const pythonAvailable = (() => {
  try {
    const probe = spawnSync(resolvePythonCommand(undefined), ['--version'], { timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return probe.status === 0
  } catch {
    return false
  }
})()

/** Fresh-context installer so each case can tune its own budgets. */
async function setup(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(PythonCodeRuntime, config)
  const runtime = ctx.codeRuntime as PythonCodeRuntime
  return { ctx, runtime }
}

/** Convenience: one namespace `tools` with the given functions. */
function tools(functions: Record<string, (args: unknown) => Promise<unknown>>): CodeBindingNamespace[] {
  return [{
    global: 'tools',
    functions: functions as Record<string, CodeBindingFunction>,
    errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
  }]
}

describe.skipIf(!pythonAvailable)('PythonCodeRuntime — programs and bindings (real python)', () => {
  it('registers with the seam descriptors', async () => {
    const { runtime } = await setup()
    expect(runtime.language).toBe('python')
    expect(runtime.isolation).toBe('process')
  }, 30_000)

  it('runs a Python program, captures print output in order, returns the value', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: `
        point = {'x': 1, 'y': 2}
        print('point', point['x'], point['y'])
        import sys as _sys
        _sys.stdout.write('raw-out\\n')
        return point['x'] + point['y']
      `,
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(3)
    // Python log capture streams newline-complete lines, so a trailing newline
    // is consumed as the line terminator rather than preserved in the text.
    expect(result.logs).toEqual(['point 1 2', 'raw-out'])
  }, 30_000)

  it('bridges binding calls and materializes a typed rejection class', async () => {
    const { runtime } = await setup()
    const calls: unknown[] = []
    const result = await runtime.run({
      program: `
        first = await tools.echo({'n': 1})
        caught = {}
        try:
            await tools.fail({})
        except ToolCallError as error:
            caught = {'isTyped': True, 'name': type(error).__name__, 'toolName': error.toolName, 'message': str(error)}
        return {'first': first, 'caught': caught}
      `,
      bindings: tools({
        echo: async (args) => { calls.push(args); return { echoed: args } },
        fail: async () => { throw new Error('nope') },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({
      first: { echoed: { n: 1 } },
      caught: { isTyped: true, name: 'ToolCallError', toolName: 'fail', message: 'nope' },
    })
    expect(calls).toEqual([{ n: 1 }])
  }, 30_000)

  it('materializes a typed rejection from a generic namespace descriptor', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: `
        try:
            await helpers.fail({})
        except HelperCallError as error:
            return {'name': type(error).__name__, 'helperName': error.helperName, 'message': str(error)}
      `,
      bindings: [{
        global: 'helpers',
        functions: { fail: async () => { throw new Error('nope') } },
        errorClass: { name: 'HelperCallError', memberNameProperty: 'helperName' },
      }],
    })
    expect(result.value).toEqual({
      name: 'HelperCallError',
      helperName: 'fail',
      message: 'nope',
    })
  }, 30_000)

  it('returns a None completion as the value null', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: 'x = 1', bindings: [] })
    expect(result.error).toBeUndefined()
    expect('value' in result).toBe(true)
    expect(result.value).toBeNull()
  }, 30_000)

  it('does not leak the host environment: a marker var in the parent never reaches the child', async () => {
    // Windows cannot launch a fully empty process environment: Node injects a
    // minimal set of essential system vars (PATH, TEMP, USERPROFILE, ...). The
    // scrub contract we assert is that the parent's own variables and secrets
    // are NOT inherited by the subprocess.
    const leaked = 'FF_PYTHON_LEASE_TOKEN'
    process.env[leaked] = 'must-not-leak'
    try {
      const { runtime } = await setup()
      const result = await runtime.run({ program: `import os\nreturn "${leaked}" in os.environ`, bindings: [] })
      expect(result.error).toBeUndefined()
      expect(result.value).toBe(false)
    } finally {
      delete process.env[leaked]
    }
  }, 30_000)

  it('rejects a non-lossless completion (a set) as invalid-output', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: 'return {1, 2, 3}', bindings: [] })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('invalid-output')
  }, 30_000)

  it('rejects a lossless-JSON completion with a non-string key', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: 'return {1: "x"}', bindings: [] })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('invalid-output')
  }, 30_000)

  it('reports a runtime throw as an exception with the message', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: 'raise Exception("kaboom")', bindings: [] })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('kaboom')
  }, 30_000)

  it('keeps logs streamed before a failure', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'print("before")\nraise Exception("after-log")',
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.logs).toContain('before')
  }, 30_000)
})

describe.skipIf(!pythonAvailable)('PythonCodeRuntime — budgets and containment (real python)', () => {
  it('ends an idle-forever await at the wall-clock ceiling', async () => {
    const { runtime } = await setup({ maxWallMs: 400 })
    const result = await runtime.run({
      program: 'import asyncio\nawait asyncio.sleep(30)\nreturn 1',
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.error?.message).toContain('wall-clock ceiling')
  }, 30_000)

  it('reports an abort mid-run and stops the subprocess', async () => {
    const { runtime } = await setup()
    const controller = new AbortController()
    setTimeout(() => { controller.abort('user-cancel') }, 200)
    const result = await runtime.run({ program: 'while True: pass', bindings: [], signal: controller.signal })
    expect(result.error).toEqual({ kind: 'abort', message: 'user-cancel' })
  }, 30_000)

  it('fails runaway log output explicitly while retaining a bounded prefix', async () => {
    const { runtime } = await setup({ maxOutputBytes: 300 })
    const result = await runtime.run({
      program: 'for i in range(1000):\n    print("spam line", i)\nreturn 1',
      bindings: [],
    })
    expect(result.error).toEqual({ kind: 'output-limit', message: 'outer output exceeded 300 bytes' })
    expect(result.value).toBeUndefined()
    expect(result.logs.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(result.logs), 'utf8')).toBeLessThan(300)
  }, 30_000)

  it('fails an oversized return value under the frame cap without substituting a string', async () => {
    const { runtime } = await setup({ maxOutputBytes: 64 })
    // 1000 bytes is under the frame-parse cap (64*6+1024) yet over the budget.
    const result = await runtime.run({ program: 'return "y" * 1000', bindings: [] })
    expect(result.value).toBeUndefined()
    expect(result.error).toEqual({ kind: 'output-limit', message: 'outer output exceeded 64 bytes' })
  }, 30_000)
})

describe('PythonCodeRuntime — seam misuse and lifecycle', () => {
  it('rejects invalid and duplicate binding globals loudly', async () => {
    const { runtime } = await setup()
    const cases: [string, RegExp][] = [
      ['not valid!', /not a usable identifier/],
      ['await', /not a usable identifier/],
      ['$tools', /not a usable identifier/],
      ['a$b', /not a usable identifier/],
      ['lambda', /not a usable identifier/],
      ['console', /reserved binding global/],
    ]
    for (const [global, message] of cases) {
      await expect(runtime.run({ program: 'return 1', bindings: [{ global, functions: {} }] })).rejects.toThrow(message)
    }
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: {} }, { global: 'tools', functions: {} }],
    })).rejects.toThrow(/duplicate binding global/)
  })

  it('rejects malformed or colliding binding error-class declarations', async () => {
    const { runtime } = await setup()
    const run = async (bindings: CodeBindingNamespace[]) => await runtime.run({ program: 'return 1', bindings })
    const namespace = (global: string, name: string, memberNameProperty = 'memberName'): CodeBindingNamespace => ({
      global,
      functions: {},
      errorClass: { name, memberNameProperty },
    })

    await expect(run([namespace('tools', 'not valid!')])).rejects.toThrow(/error class.*not a usable identifier/)
    await expect(run([namespace('tools', 'lambda')])).rejects.toThrow(/error class.*not a usable identifier/)
    await expect(run([namespace('tools', 'console')])).rejects.toThrow(/reserved binding global/)
    await expect(run([namespace('tools', 'tools')])).rejects.toThrow(/duplicate injected global/)
    await expect(run([
      namespace('tools', 'CallError'),
      namespace('helpers', 'CallError'),
    ])).rejects.toThrow(/duplicate injected global/)
    await expect(run([namespace('tools', 'CallError', '')])).rejects.toThrow(/member property.*not usable/)
    await expect(run([namespace('tools', 'CallError', 'message')])).rejects.toThrow(/member property.*not usable/)
    await expect(run([namespace('tools', 'CallError', 'args')])).rejects.toThrow(/member property.*not usable/)
    await expect(run([namespace('tools', 'CallError', '__dict__')])).rejects.toThrow(/member property.*not usable/)
  })

  it('rejects config values that are not positive numbers', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { maxOutputBytes: -1 })).rejects.toThrow(/positive number/)
  })

  it('rejects a maxWallMs above MAX_TIMER_DELAY_MS', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { maxWallMs: 2_147_483_648 }))
      .rejects.toThrow(/maxWallMs must be at most 2147483647/)
    await expect(ctx.plugin(PythonCodeRuntime, { maxWallMs: 2_147_483_647 })).resolves.toBeTruthy()
  })

  it('requires maxOutputBytes to fit the smallest counted outer payloads', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { maxOutputBytes: 3 })).rejects.toThrow(/safe integer of at least 4/)
    await expect(ctx.plugin(PythonCodeRuntime, { maxOutputBytes: 4.5 })).rejects.toThrow(/safe integer of at least 4/)
  })

  it('reports a pre-aborted signal without spawning', async () => {
    const { runtime } = await setup()
    const controller = new AbortController()
    controller.abort('too-late')
    const result = await runtime.run({ program: 'return 1', bindings: [], signal: controller.signal })
    expect(result.error).toEqual({ kind: 'abort', message: 'too-late' })
  })

  it('disposal aborts in-flight runs, awaits subprocess exit, and rejects later runs', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(PythonCodeRuntime)
    const runtime = ctx.codeRuntime as PythonCodeRuntime
    const inflight: Promise<CodeRunResult> = runtime.run({ program: 'while True: pass', bindings: [] })
    await new Promise(resolve => setTimeout(resolve, 300))
    await fiber.dispose()
    const result = await inflight
    expect(result.error).toEqual({ kind: 'abort', message: 'runtime disposed' })
    await expect(runtime.run({ program: 'return 1', bindings: [] })).rejects.toThrow(/after disposal/)
  }, 30_000)
})