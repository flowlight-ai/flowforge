/**
 * Route mounting convention (R18 dual-stack isolation): the TS stack owns
 * `/api/v2/*` end-to-end while the Python legacy stack keeps `/api/v1/*`
 * until sunset (stage 11). An application plugin never mounts raw paths —
 * it declares {@link RouteMountDeclaration} suffixes, and the host mounts
 * them at `/api/v2/<pluginId><suffix>` in manifest order.
 *
 * @module @flowforge/plugin-contract/routes
 */

import type { HttpMethod, PluginManifest, RouteMountDeclaration } from './manifest.ts'

/** Root prefix the TS HTTP surface owns (R18). */
export const API_V2_PREFIX = '/api/v2'

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Plugin ids are the second path segment; this grammar keeps them URL-safe. */
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Literal segments: lowercase words only (no loose chars, no case mixing). */
const LITERAL_SEGMENT_PATTERN = /^[a-z][a-z0-9]*$/

/** `:param` placeholders: camelCase identifiers after the colon. */
const PARAM_SEGMENT_PATTERN = /^:[a-zA-Z_][a-zA-Z0-9_]*$/

function segmentViolatesGrammar(segment: string): boolean {
  if (segment.startsWith(':')) return !PARAM_SEGMENT_PATTERN.test(segment)
  return !LITERAL_SEGMENT_PATTERN.test(segment)
}

/**
 * One concrete mount the host will register for a plugin.
 * `fullPath` is the exact express-style path string mounted on the app.
 */
export interface ResolvedRouteMount {
  readonly pluginId: string
  readonly declaration: RouteMountDeclaration
  readonly fullPath: string
}

/**
 * Validate one declared route suffix. Fail-closed: anything outside the
 * grammar is rejected, because a loose mount could shadow another plugin's
 * namespace or escape the `/api/v2` root.
 */
export function validateRouteMount(route: RouteMountDeclaration): readonly string[] {
  // The host hands us UNTRUSTED manifest values: every field may be absent
  // or mistyped, so probe the raw shape before reading typed properties.
  const raw = route as { path?: unknown; methods?: unknown }
  const errors: string[] = []
  if (typeof raw.path !== 'string') {
    errors.push('route path must be a string')
  } else {
    if (!raw.path.startsWith('/')) errors.push('must start with "/"')
    else if (raw.path.length > 1 && raw.path.endsWith('/')) errors.push('must not end with "/"')
    const segments = raw.path.slice(1).split('/').filter(Boolean)
    if (segments.length === 0) errors.push('route path must contain at least one segment')
    for (const segment of segments) {
      if (segmentViolatesGrammar(segment)) errors.push(`route segment "${segment}" is not lowercase-word or :param grammar`)
    }
  }
  if (!Array.isArray(raw.methods) || raw.methods.length === 0) {
    errors.push('at least one HTTP method')
  } else {
    for (const method of raw.methods) {
      if (typeof method !== 'string' || !HTTP_METHODS.includes(method as HttpMethod)) {
        errors.push(`unknown HTTP method ${JSON.stringify(method)}`)
      }
    }
  }
  return errors
}

/**
 * Resolve every declared route of a manifest into its concrete mount path.
 * Throws on any invalid plugin id or route declaration — hosts call this at
 * assembly time, so a bad manifest fails the boot, not a request.
 */
export function resolveRouteMounts(manifest: PluginManifest): readonly ResolvedRouteMount[] {
  if (!PLUGIN_ID_PATTERN.test(manifest.pluginId)) {
    throw new Error(`plugin-contract: pluginId "${manifest.pluginId}" is not URL-safe (kebab-case lowercase required)`)
  }
  const mounts: ResolvedRouteMount[] = []
  const seen = new Set<string>()
  for (const declaration of manifest.routes ?? []) {
    const errors = validateRouteMount(declaration)
    if (errors.length > 0) {
      throw new Error(`plugin-contract: route "${declaration.path}" of ${manifest.pluginId} is invalid: ${errors.join('; ')}`)
    }
    const fullPath = `${API_V2_PREFIX}/${manifest.pluginId}${declaration.path}`
    if (seen.has(fullPath)) {
      throw new Error(`plugin-contract: duplicate route mount ${fullPath}`)
    }
    seen.add(fullPath)
    mounts.push({ pluginId: manifest.pluginId, declaration, fullPath })
  }
  return mounts
}
