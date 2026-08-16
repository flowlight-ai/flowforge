import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FF_HOME_DISPLAY,
  FF_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultFlowforgeHome,
  flowforgeHomeDisplay,
  flowforgeHomePath,
  expandHomePath,
  resolveFlowforgeHome,
} from '@flowforge/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('flowforge path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(FF_HOME_DIR_NAME).toBe('.flowforge')
    expect(DEFAULT_FF_HOME_DISPLAY).toBe('~/.flowforge')
    expect(defaultFlowforgeHome()).toBe(join(homedir(), '.flowforge'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.flowforge')).toBe(join(homedir(), '.flowforge'))
    expect(expandHomePath('~\\.flowforge')).toBe(join(homedir(), '.flowforge'))
    expect(expandHomePath('/tmp/.flowforge')).toBe('/tmp/.flowforge')
    expect(expandHomePath('~other/.flowforge')).toBe('~other/.flowforge')
  })

  it('resolves explicit path before FF_HOME and the default', () => {
    const envHome = join(homedir(), 'env-flowforge')

    expect(resolveFlowforgeHome('/tmp/explicit-flowforge', { FF_HOME: '~/env-flowforge' })).toBe(resolve('/tmp/explicit-flowforge'))
    expect(resolveFlowforgeHome(undefined, { FF_HOME: '~/env-flowforge' })).toBe(envHome)
    expect(resolveFlowforgeHome(undefined, {})).toBe(defaultFlowforgeHome())
  })

  it('treats an empty or whitespace-only FF_HOME as unset', () => {
    expect(resolveFlowforgeHome(undefined, { FF_HOME: '' })).toBe(defaultFlowforgeHome())
    expect(resolveFlowforgeHome(undefined, { FF_HOME: '   ' })).toBe(defaultFlowforgeHome())
  })

  it('joins child segments onto the resolved FF_HOME', () => {
    vi.stubEnv('FF_HOME', '~/env-flowforge')
    expect(flowforgeHomePath()).toBe(join(homedir(), 'env-flowforge'))
    expect(flowforgeHomePath('storages', 'cache')).toBe(join(homedir(), 'env-flowforge', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(flowforgeHomeDisplay(resolve(defaultFlowforgeHome()))).toBe('~/.flowforge')
    expect(flowforgeHomeDisplay('/some/other/root')).toBe('$FF_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flowforge-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
