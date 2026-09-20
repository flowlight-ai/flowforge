/**
 * Desktop shell configuration — every tunable lives here so the shell never
 * hardcodes a backend port or URL (port of clowder `desktop/main.js` constants).
 * Defaults mirror the upstream host (`FRONTEND_PORT=3003`, `API_PORT=3004`)
 * but stay overridable through env, exactly like every other FlowForge seam.
 * @module @flowforge/desktop/config
 */

/** Desktop config keys read from the environment. */
export const DESKTOP_CONFIG_ENV_KEYS = {
  host: 'FF_DESKTOP_HOST',
  webPort: 'FF_DESKTOP_WEB_PORT',
  apiPort: 'FF_DESKTOP_API_PORT',
  backendCommand: 'FF_DESKTOP_BACKEND_COMMAND',
  webBasePath: 'FF_DESKTOP_WEB_BASE_PATH',
  apiBasePath: 'FF_DESKTOP_API_BASE_PATH',
} as const

/** Resolution outcome of {@link resolveDesktopConfig}. */
export interface DesktopConfig {
  /** Host bound for both the web frontend and backend health probe. */
  host: string
  /** Port the Next.js web frontend serves on. */
  webPort: number
  /** Port the backend API health probe targets. */
  apiPort: number
  /** Executable (or command name) that starts the backend service set. */
  backendCommand: string
  /** Additional backend arguments. */
  backendArgs: readonly string[]
  /** Web root path; the ready web bundle lives at `/{webBasePath}`. */
  webBasePath: string
  /** API root path used for the readiness probe. */
  apiBasePath: string
  /** Resolved http origin of the web frontend. */
  webUrl: string
  /** Resolved http probe origin of the backend API. */
  apiUrl: string
  /** Wall-clock budget in ms for the API readiness probe. */
  apiProbeTimeoutMs: number
  /** Interval in ms between readiness probes. */
  apiProbeIntervalMs: number
}

/** Upstream default ports, retained from clowder `main.js`. */
export const DEFAULT_WEB_PORT = 3003
export const DEFAULT_API_PORT = 3004
/** Upstream default bound host. */
export const DEFAULT_HOST = '127.0.0.1'
/** Default backend startup command. */
export const DEFAULT_BACKEND_COMMAND = 'flowforge'
/** Default API root path used for the readiness probe. */
export const DEFAULT_API_BASE_PATH = '/api'

/** Read a positive-integer port from `env`, falling back to `def`. */
function readPort(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return def
  const value = Number.parseInt(raw, 10)
  if (Number.isFinite(value) && value > 0 && value <= 65535) return value
  return def
}

/** Read a string from `env`, falling back to `def`. */
function readString(env: NodeJS.ProcessEnv, key: string, def: string): string {
  const raw = env[key]
  return raw === undefined || raw === '' ? def : raw
}

/** Collapse a base-path to trailing-slash form (`foo/` / `api/`), or empty. */
export function normalizeDesktopRoot(base: string): string {
  const stripped = base.replace(/^\/+|\/+$/gu, '')
  return stripped.length === 0 ? '' : `${stripped}/`
}

/**
 * Resolve desktop config from an injected env, defaulting to the upstream
 * host values. Pure and injection-friendly: pass an explicit `env` for tests
 * (or `process.env` in production) — the shell never reads `process.env`
 * directly, which keeps every branch unit-testable.
 */
export function resolveDesktopConfig(env: NodeJS.ProcessEnv): DesktopConfig {
  const host = readString(env, DESKTOP_CONFIG_ENV_KEYS.host, DEFAULT_HOST)
  const webPort = readPort(env, DESKTOP_CONFIG_ENV_KEYS.webPort, DEFAULT_WEB_PORT)
  const apiPort = readPort(env, DESKTOP_CONFIG_ENV_KEYS.apiPort, DEFAULT_API_PORT)
  const backendCommand = readString(env, DESKTOP_CONFIG_ENV_KEYS.backendCommand, DEFAULT_BACKEND_COMMAND)
  const webBasePath = normalizeDesktopRoot(readString(env, DESKTOP_CONFIG_ENV_KEYS.webBasePath, ''))
  const apiBasePath = normalizeDesktopRoot(readString(env, DESKTOP_CONFIG_ENV_KEYS.apiBasePath, DEFAULT_API_BASE_PATH))
  return {
    host,
    webPort,
    apiPort,
    backendCommand,
    backendArgs: [],
    webBasePath,
    apiBasePath,
    webUrl: `http://${host}:${webPort}/${webBasePath}`,
    apiUrl: `http://${host}:${apiPort}/${apiBasePath}`,
    apiProbeTimeoutMs: 20_000,
    apiProbeIntervalMs: 500,
  }
}