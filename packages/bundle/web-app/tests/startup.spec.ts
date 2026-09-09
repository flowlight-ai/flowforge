/** The Web command-line provider: flag parsing, help, and usage rejection. */

import { Context } from '@flowforge/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { internals, provideCmdline } from '@flowforge/cmdline'
import { apply, WEB_STARTUP_SERVICE, type WebStartupValues } from '../src/startup.ts'

afterEach(() => {
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** Run the provider with captured command output and exit requests. */
function start(args: string[]): { ctx: Context; exits: number[]; out: () => string; values: () => WebStartupValues | undefined } {
  const ctx = new Context()
  const exits: number[] = []
  let out = ''
  const capture = { write: (chunk: string) => { out += chunk; return true } }
  internals.stdout = capture
  internals.stderr = capture
  provideCmdline(ctx, { args, exit: code => void exits.push(code) })
  apply(ctx)
  return {
    ctx,
    exits,
    out: () => out,
    values: () => ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag this invocation named', () => {
    const { values } = start([
      '--host', '127.0.0.1',
      '--no-open',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
    ])
    expect(values()).toEqual({
      host: '127.0.0.1',
      openBrowser: false,
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
    })
  })

  it('leaves deployment values to each consumer when flags omit them', () => {
    expect(start([]).values()).toEqual({ openBrowser: true, trustedHosts: [] })
  })

  it('prints its own help and provides nothing', () => {
    const { values, exits, out } = start(['--help'])
    expect(out()).toContain('flowforge --profile web')
    expect(out()).toContain('--no-open')
    expect(out()).toContain('--trusted-host')
    expect(values()).toBeUndefined()
    expect(exits).toEqual([0])
  })

  it('rejects a non-numeric port before publishing', () => {
    const { values, exits, out } = start(['--port', 'abc'])
    expect(out()).toContain('--port must be a number')
    expect(values()).toBeUndefined()
    expect(exits).toEqual([1])
  })

  it('rejects the intentionally unsupported all-interfaces host before publishing', () => {
    const { values, exits, out } = start(['--host', '0.0.0.0'])
    expect(out()).toContain('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    expect(values()).toBeUndefined()
    expect(exits).toEqual([1])
  })
})