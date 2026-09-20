import { describe, it, expect } from 'vitest'
import {
  DEFAULT_API_PORT,
  DEFAULT_BACKEND_COMMAND,
  DEFAULT_HOST,
  DEFAULT_WEB_PORT,
  DESKTOP_CONFIG_ENV_KEYS,
  normalizeDesktopRoot,
  resolveDesktopConfig,
} from '../src/config.ts'

/** Unit tests for the externalized desktop config resolver. */
describe('resolveDesktopConfig', () => {
  it('uses upstream defaults when env is empty', () => {
    const config = resolveDesktopConfig({})
    expect(config.host).toBe(DEFAULT_HOST)
    expect(config.webPort).toBe(DEFAULT_WEB_PORT)
    expect(config.apiPort).toBe(DEFAULT_API_PORT)
    expect(config.backendCommand).toBe(DEFAULT_BACKEND_COMMAND)
    expect(config.apiBasePath).toBe('api/')
    expect(config.webUrl).toBe(`http://${DEFAULT_HOST}:${DEFAULT_WEB_PORT}/`)
    expect(config.apiUrl).toBe(`http://${DEFAULT_HOST}:${DEFAULT_API_PORT}/api/`)
  })

  it('reads host, ports, and command from env', () => {
    const env = {
      [DESKTOP_CONFIG_ENV_KEYS.host]: '0.0.0.0',
      [DESKTOP_CONFIG_ENV_KEYS.webPort]: '8080',
      [DESKTOP_CONFIG_ENV_KEYS.apiPort]: '9090',
      [DESKTOP_CONFIG_ENV_KEYS.backendCommand]: 'ff serve',
    }
    const config = resolveDesktopConfig(env)
    expect(config.host).toBe('0.0.0.0')
    expect(config.webPort).toBe(8080)
    expect(config.apiPort).toBe(9090)
    expect(config.webUrl).toBe('http://0.0.0.0:8080/')
    expect(config.apiUrl).toBe('http://0.0.0.0:9090/api/')
  })

  it('ignores a non-numeric or out-of-range port and falls back to default', () => {
    const garbage = resolveDesktopConfig({ [DESKTOP_CONFIG_ENV_KEYS.webPort]: 'abc' })
    expect(garbage.webPort).toBe(DEFAULT_WEB_PORT)
    const tooBig = resolveDesktopConfig({ [DESKTOP_CONFIG_ENV_KEYS.webPort]: '70000' })
    expect(tooBig.webPort).toBe(DEFAULT_WEB_PORT)
  })

  it('collapses base paths to trailing-slash normalized form in URLs', () => {
    const config = resolveDesktopConfig({
      [DESKTOP_CONFIG_ENV_KEYS.webBasePath]: '/app',
      [DESKTOP_CONFIG_ENV_KEYS.apiBasePath]: 'v2/',
    })
    expect(config.webBasePath).toBe('app/')
    expect(config.apiBasePath).toBe('v2/')
    expect(config.webUrl).toBe(`http://${DEFAULT_HOST}:${DEFAULT_WEB_PORT}/app/`)
    expect(config.apiUrl).toBe(`http://${DEFAULT_HOST}:${DEFAULT_API_PORT}/v2/`)
  })

  it('is pure with respect to process.env (injection-friendly)', () => {
    const env = { [DESKTOP_CONFIG_ENV_KEYS.webPort]: '7000' }
    delete process.env[DESKTOP_CONFIG_ENV_KEYS.webPort]
    expect(resolveDesktopConfig(env).webPort).toBe(7000)
    expect(resolveDesktopConfig({}).webPort).toBe(DEFAULT_WEB_PORT)
  })
})

/** Unit tests for root path normalization. */
describe('normalizeDesktopRoot', () => {
  it('handles leading/trailing slashes and empty strings', () => {
    expect(normalizeDesktopRoot('/app')).toBe('app/')
    expect(normalizeDesktopRoot('app/')).toBe('app/')
    expect(normalizeDesktopRoot('/deep/nested/path/')).toBe('deep/nested/path/')
    expect(normalizeDesktopRoot('')).toBe('')
    expect(normalizeDesktopRoot('/')).toBe('')
  })
})