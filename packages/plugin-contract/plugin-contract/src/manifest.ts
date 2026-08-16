/**
 * Application plugin manifest: the machine-readable declaration a FlowForge
 * application plugin (cats/chat/limb/forgekin domains, stage 4+) ships beside
 * its cordis plugin entry. Mapped from the upstream application contract's
 * `PluginManifest` (manifest.schema.json projection) with three FlowForge
 * extensions demanded by the refactor plan (R13/R18):
 *
 * - `routes`: HTTP route mounts under `/api/v2/*` (dual-stack isolation —
 *   Python keeps `/api/v1/*` until sunset);
 * - `credentials`: credential requirements the plugin asks the credentials
 *   store for (P: `core/credential_store.py` baseline);
 * - `lifecycle`: which application-level hooks the plugin implements.
 *
 * The manifest declares; the host decides. Nothing here executes.
 *
 * @module @flowforge/plugin-contract/manifest
 */

import type { Capability } from './capability.ts'

/** A semantic-version string (validated by {@link validateManifest}). */
export type SemVer = string

/** Classification of data a plugin owns, deciding its retention rules. */
export type DataClass =
  | 'cache'
  | 'ephemeral'
  | 'user-authored'
  | 'derived-user-visible'
  | 'relationship'
  | 'interaction-history'

/** What happens to a declared dataset when the plugin goes away. */
export type DataStrategy = 'lifecycle' | 'retained' | 'ask-on-uninstall'

/**
 * A declared dataset. `cache`/`ephemeral` may choose any strategy; anything
 * user-derived must at minimum be retained or asked about — a `lifecycle`
 * (delete-with-plugin) strategy is a contract violation for those classes.
 */
export type DataDeclaration =
  | { readonly name: string; readonly dataClass: 'cache' | 'ephemeral'; readonly strategy: DataStrategy; readonly schemaVersion?: string }
  | {
      readonly name: string
      readonly dataClass: 'user-authored' | 'derived-user-visible' | 'relationship' | 'interaction-history'
      readonly strategy: 'retained' | 'ask-on-uninstall'
      readonly schemaVersion?: string
    }

/** Which strategies each data class legally allows (schema-owned truth). */
export const DATA_CLASS_ALLOWED_STRATEGIES = {
  cache: ['lifecycle', 'retained', 'ask-on-uninstall'],
  ephemeral: ['lifecycle', 'retained', 'ask-on-uninstall'],
  'user-authored': ['retained', 'ask-on-uninstall'],
  'derived-user-visible': ['retained', 'ask-on-uninstall'],
  relationship: ['retained', 'ask-on-uninstall'],
  'interaction-history': ['retained', 'ask-on-uninstall'],
} as const satisfies Record<DataClass, readonly DataStrategy[]>

/** A named host resource a feature binds to (thread, store, window…). */
export interface ResourceReference {
  readonly type: string
  readonly id: string
}

/** A user-facing feature bundle: the capabilities one feature needs. */
export interface PluginFeature {
  readonly id: string
  readonly name: string
  readonly resources: readonly ResourceReference[]
  readonly capabilities: readonly Capability[]
}

/** External runtimes ride a transport the host can supervise. */
export type ExternalRuntimeTransport = 'stdio' | 'ipc'

export interface ExternalRuntimeDeclaration {
  readonly transport: ExternalRuntimeTransport
  readonly entrypoint: string
}

/** Builtin runtimes mount in-process through the cordis loader. */
export interface BuiltinRuntimeDeclaration {
  readonly transport: 'builtin'
  /** Optional module specifier; defaults to the plugin's own entry. */
  readonly entrypoint?: string
}

export type RuntimeDeclaration = ExternalRuntimeDeclaration | BuiltinRuntimeDeclaration

/** Application-level lifecycle hooks a plugin may implement (see lifecycle.ts). */
export type AppLifecycleHookName =
  | 'onInstall'
  | 'onEnable'
  | 'onDisable'
  | 'onUninstall'
  | 'onBeforeShutdown'

/** Which application-level lifecycle hooks the plugin implements. */
export interface LifecycleDeclaration {
  readonly hooks: readonly AppLifecycleHookName[]
}

/** A credential the plugin asks the credentials store for at enable time. */
export interface CredentialRequirement {
  /** Stable credential identifier in the host credentials store. */
  readonly id: string
  /** Provider the credential authenticates against (openai/gitee/…). */
  readonly provider: string
  /** Human-readable reason — surfaced verbatim in the approval prompt. */
  readonly purpose: string
  /** Hard requirement blocks enable; soft degrades the feature that uses it. */
  readonly required: boolean
}

/**
 * The full application plugin manifest. `routes`/`credentials`/`lifecycle`
 * are the FlowForge extensions over the upstream shape.
 */
export interface PluginManifest {
  readonly pluginId: string
  readonly version: SemVer
  /** Contract version the plugin was built against (this package's version). */
  readonly contractVersion: SemVer
  readonly name: string
  readonly description?: string
  readonly features: readonly PluginFeature[]
  readonly data?: readonly DataDeclaration[]
  readonly runtime: RuntimeDeclaration
  readonly routes?: readonly RouteMountDeclaration[]
  readonly credentials?: readonly CredentialRequirement[]
  readonly lifecycle?: LifecycleDeclaration
}

/**
 * One HTTP route group the plugin asks the host to mount (R18): every path
 * lives under `/api/v2/<pluginId>` and is validated by `validateRouteMount`.
 */
export interface RouteMountDeclaration {
  /** Path suffix after `/api/v2/<pluginId>`; starts with `/`, no trailing slash. */
  readonly path: string
  readonly methods: readonly HttpMethod[]
  readonly description?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
