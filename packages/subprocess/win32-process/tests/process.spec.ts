import { describe, it, expect, afterEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  isWindows,
  spawnProcess,
  terminateProcess,
  treeKill,
  waitForProcessExit,
} from '../src/index.ts'

/** Node executable used to host real subprocesses in these tests. */
const NODE = process.execPath

const live: ChildProcess[] = []

afterEach(() => {
  for (const child of live.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null) child.kill('SIGKILL')
  }
})

function spawnLive(command: string, args: readonly string[]): ChildProcess {
  const child = spawnProcess({ command, args })
  live.push(child)
  return child
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('spawnProcess', () => {
  it('spawns a real child and captures its stdout', async () => {
    const child = spawnLive(NODE, ['-e', 'process.stdout.write("hello")'])
    const out = new Promise<string>(resolve => {
      let buf = ''
      child.stdout!.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
      })
      child.stdout!.on('end', () => resolve(buf))
    })
    expect(await waitForProcessExit(child)).toBe(0)
    expect(await out).toBe('hello')
  })
})

describe('spawnProcess / args', () => {
  it('forwards arguments verbatim (no shell reinterpretation)', async () => {
    const child = spawnLive(NODE, ['-e', 'process.stdout.write(process.argv[1] === "two words" ? "ok" : "bad")', 'two words'])
    const out = new Promise<string>(resolve => {
      let buf = ''
      child.stdout!.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
      })
      child.stdout!.on('end', () => resolve(buf))
    })
    expect(await waitForProcessExit(child)).toBe(0)
    expect(await out).toBe('ok')
  })
})

describe('terminateProcess', () => {
  it('terminates a live direct child', async () => {
    const child = spawnLive(NODE, ['-e', 'setInterval(() => {}, 1000)'])
    const pid = child.pid!
    expect(alive(pid)).toBe(true)
    await expect(terminateProcess(pid)).resolves.toBe(true)
    await expect(waitForProcessExit(child)).resolves.toBeGreaterThan(0)
    expect(alive(pid)).toBe(false)
  })

  it('resolves false for an already-exited pid instead of throwing', async () => {
    const child = spawnLive(NODE, ['-e', ''])
    await waitForProcessExit(child)
    await expect(terminateProcess(child.pid!)).resolves.toBe(false)
  })
})

describe('treeKill', () => {
  it('kills a live process tree root and reports the outcome', async () => {
    const child = spawnLive(NODE, ['-e', 'setInterval(() => {}, 1000)'])
    const pid = child.pid!
    expect(alive(pid)).toBe(true)
    const result = await treeKill(pid)
    expect(result.signalSent).toBe(true)
    expect(result.killed).toBeGreaterThan(0)
    await expect(waitForProcessExit(child)).resolves.toBeGreaterThan(0)
    expect(alive(pid)).toBe(false)
  }, 180000)

  it('resolves without throwing for an already-exited pid', async () => {
    const child = spawnLive(NODE, ['-e', ''])
    await waitForProcessExit(child)
    await expect(treeKill(child.pid!)).resolves.toBeDefined()
  }, 180000)
})

describe('platform', () => {
  it('reports the host platform consistently', () => {
    expect(isWindows()).toBe(process.platform === 'win32')
  })
})