/**
 * Web bundle declarations (the patch) and runtime glue behavior: dist serving,
 * the web-surface prompt section and bash runtime variable, the URL line, the
 * default-browser handoff, and bind-dependent trust publication.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@flowforge/cordis'
import { entryListSchema } from '@flowforge/cordis-plugin-include'
import { createLaunchEnvironmentSnapshot, FF_LAUNCH_ENVIRONMENT_KEY } from '@flowforge/launch-environment'
import SystemPrompt from '@flowforge/system-prompt'
import type { WebServer } from '@flowforge/host-webserver'
import { apply, Config, internals } from '../src/index.ts'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

let dist: string | undefined

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  internals.resolveDistIndex = originalResolveDistIndex
  internals.openBrowser = originalOpenBrowser
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

const originalResolveDistIndex = internals.resolveDistIndex
const originalOpenBrowser = internals.openBrowser

/** Stage a dist fixture and point the bundle's resolver at it. */
function stageDist(): string {
  dist = mkdtempSync(join(tmpdir(), 'flowforge-web-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
  return index
}

/** A fake webServer capturing the fallback seat. */
function fakeHttpServer(host: '127.0.0.1' | '0.0.0.0' = '127.0.0.1'): { server: WebServer; seat: () => unknown } {
  let fallback: unknown
  const server = {
    host,
    port: 4567,
    registerFallback: (handler: unknown) => {
      fallback = handler
      return () => { fallback = undefined }
    },
    applyIndexTaps: async (html: string) => html,
  } as unknown as WebServer
  return { server, seat: () => fallback }
}

/** A fake Loader whose settlement the test controls (the URL line waits on it). */
function provideLoader(ctx: Context, settle: () => Promise<void> = async () => {}): void {
  ctx.provide('loader', { await: settle } as never)
}

interface BashContribution {
  name: string
  variables: Record<string, { description: string }>
  resolve: () => Record<string, string>
}

describe('@flowforge/web-app bundle patch', () => {
  it('declares web-only host rows and moves the agent plane behind presets', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      flowforge?: { bundle?: { patch?: string } }
    }
    expect(manifest.flowforge?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.flowforge!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ id?: string; disabled?: boolean; insert?: Array<{ id?: string; inject?: string[]; name?: string }> }>
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'web-startup')?.name).toBe('@flowforge/web-app/startup')
    expect(rows.find(row => row.id === 'webserver')?.inject).toEqual(['webStartup'])
    expect(rows.find(row => row.id === 'web-runtime')?.name).toBe('@flowforge/web-app')
    expect(rows.find(row => row.id === 'web-runtime')?.inject).toEqual(['webStartup'])
    expect(rows.find(row => row.id === 'connection')?.inject).toEqual(['webRuntime'])
    expect(rows.find(row => row.id === 'agent-presets')?.name).toBe('@flowforge/agent-presets')
    expect(patches.find(patch => patch.id === 'tool-bash')).toMatchObject({ disabled: true })
  })
})

describe('web-app runtime glue', () => {
  it('mounts dist serving, prompt section, bash variables, and publishes the URL with the LAN snapshot', async () => {
    stageDist()
    const ctx = new Context()
    // Editor markers and a project .env SSH value do not establish a remote launch.
    ctx.provide(FF_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { VSCODE_IPC_HOOK_CLI: '/tmp/local-vscode-ipc' } },
      { source: 'project-env', path: '/work/.env', values: { SSH_CONNECTION: 'stale-project-value' } },
    ]))
    const { server, seat } = fakeHttpServer('0.0.0.0')
    ctx.provide('webServer', server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    provideLoader(ctx)
    const lifecycle: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((message) => { lifecycle.push(String(message)) })
    const openBrowser = vi.fn(async (url: string) => { lifecycle.push(`open:${url}`) })
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: ['lab.internal'] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seat()).toBeDefined() // frontend-static claimed the fallback
    expect(ctx.get('webRuntime')).toEqual({
      lanAddresses: ['192.168.1.5'],
      trustedHosts: ['192.168.1.5', 'lab.internal'],
    })
    expect(log).toHaveBeenCalledWith('flowforge web: http://127.0.0.1:4567 (LAN: http://192.168.1.5:4567)')
    expect(log).toHaveBeenCalledWith('flowforge web: opening the default browser; pass --no-open to disable')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4567')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')).toBeDefined()
    const section = assembly.sections.find(entry => entry.name === 'app:web-surface')
    expect(section?.text).toContain('http://127.0.0.1:4567')
    expect(section?.text).toContain('pnpm run dev:web')
    const webRuntime = contributions.find(contribution => contribution.name === 'web-runtime')
    expect(webRuntime?.resolve()).toEqual({ FF_WEB_URL: 'http://127.0.0.1:4567' })
    await ctx.fiber.dispose()
  })

  it('publishes no readiness side effect when printing and browser opening are disabled', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'app:web-surface')?.text)
      .toContain('rebuilding the affected Web artifacts')
    await ctx.fiber.dispose()
  })

  it('skips the surface context when disabled (the one-shot layer): no prompt section, no bash variables', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:web-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    expect(contributions).toEqual([])
    await ctx.fiber.dispose()
  })

  it('prints the loopback-only URL line when no LAN snapshot exists', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    provideLoader(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ openBrowser: false, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('flowforge web: http://127.0.0.1:4567')
    await ctx.fiber.dispose()
  })

  it('defers readiness publication until Loader settlement and drops it on failure', async () => {
    stageDist()
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser

    let release: () => void
    const settlement = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const settled = new Context()
    settled.provide('webServer', fakeHttpServer().server)
    provideLoader(settled, () => settlement)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(settled, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    release!()
    await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
    expect(log).toHaveBeenCalledWith('flowforge web: http://127.0.0.1:4567')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4567')
    await settled.fiber.dispose()

    log.mockClear()
    openBrowser.mockClear()
    const failed = new Context()
    failed.provide('webServer', fakeHttpServer().server)
    provideLoader(failed, async () => { throw new Error('boot failed') })
    apply(failed, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    await failed.fiber.dispose()
  })

  it.each([
    ['SSH_CONNECTION', '10.0.0.2 55000 10.0.0.9 22'],
    ['SSH_TTY', '/dev/pts/3'],
  ] as const)('prints the host URL but skips browser handoff when %s marks an SSH launch', async (name, value) => {
    vi.stubEnv(name, value)
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    provideLoader(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('flowforge web: http://127.0.0.1:4567')
    expect(openBrowser).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('fails loud when the prompt section resolves against a portless webserver', async () => {
    stageDist()
    const ctx = new Context()
    const { server } = fakeHttpServer()
    Object.defineProperty(server, 'port', { get: () => undefined })
    ctx.provide('webServer', server)
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('webServer service missing')
    await ctx.fiber.dispose()
  })
})