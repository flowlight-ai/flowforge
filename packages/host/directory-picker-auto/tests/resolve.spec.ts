import { describe, it, expect } from 'vitest'
import type { DirectoryPickerHostFacts } from '../src/index.ts'
import { resolveDirectoryPickerBackend } from '../src/index.ts'

/** Default facts: loopback bind, win32, no remote/env signals. */
function facts(overrides: Partial<DirectoryPickerHostFacts> = {}): DirectoryPickerHostFacts {
  return {
    bindHost: '127.0.0.1',
    platform: 'win32',
    env: {},
    linuxChooser: false,
    ...overrides,
  }
}

describe('resolveDirectoryPickerBackend', () => {
  it('resolves native on an attended loopback win32 host', () => {
    expect(resolveDirectoryPickerBackend(facts())).toBe('native')
  })

  it('resolves native on an attended loopback darwin host', () => {
    expect(resolveDirectoryPickerBackend(facts({ platform: 'darwin' }))).toBe('native')
  })

  it('resolves browse for a non-loopback bind host', () => {
    expect(resolveDirectoryPickerBackend(facts({ bindHost: '0.0.0.0' }))).toBe('browse')
    expect(resolveDirectoryPickerBackend(facts({ bindHost: '192.168.1.10' }))).toBe('browse')
  })

  it('resolves browse under an SSH remote session', () => {
    expect(resolveDirectoryPickerBackend(facts({ env: { SSH_CONNECTION: 'host' } }))).toBe('browse')
    expect(resolveDirectoryPickerBackend(facts({ env: { SSH_TTY: 'pts/0' } }))).toBe('browse')
  })

  it('treats empty env values as unset', () => {
    expect(resolveDirectoryPickerBackend(facts({ env: { SSH_CONNECTION: '' } }))).toBe('native')
    expect(resolveDirectoryPickerBackend(facts({ platform: 'linux', linuxChooser: true, env: { DISPLAY: '' } }))).toBe('browse')
  })

  it('requires a chooser binary on linux before native', () => {
    const li = facts({ platform: 'linux' })
    expect(resolveDirectoryPickerBackend({ ...li, linuxChooser: false, env: { DISPLAY: ':0' } })).toBe('browse')
    expect(resolveDirectoryPickerBackend({ ...li, linuxChooser: true, env: { DISPLAY: ':0' } })).toBe('native')
  })

  it('requires a display signal on linux even with a chooser binary', () => {
    const li = facts({ platform: 'linux', linuxChooser: true })
    expect(resolveDirectoryPickerBackend({ ...li, env: {} })).toBe('browse')
    expect(resolveDirectoryPickerBackend({ ...li, env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe('native')
  })

  it('never resolves native outside darwin/win32/linux', () => {
    // A linux-like host without a chooser resolves browse.
    expect(resolveDirectoryPickerBackend(facts({ platform: 'linux' }))).toBe('browse')
  })
})