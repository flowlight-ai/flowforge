/**
 * Manifest validation: the untrusted-manifest boundary. Mapped from the
 * upstream application contract's `validation/manifest` (Ajv over manifest.schema.json) —
 * same result shape ({@link ManifestValidationResult}) so host control-plane
 * code reads identically — implemented as structured hand checks instead of
 * a schema engine, because the semantic rules (data-class × strategy,
 * capability closed enum, transport × entrypoint pairing) dominate and the
 * FlowForge repo keeps validation dependency-free (R19).
 *
 * YAML assembly entry ({@link loadManifestYaml}) follows R17: plugin
 * manifests are YAML, loaded through the same path the cordis loader uses.
 *
 * @module @flowforge/plugin-contract/validation
 */

import { load } from 'js-yaml'
import type { Capability } from './capability.ts'
import { VALID_CAPABILITIES } from './capability.ts'
import type { AppLifecycleHookName, PluginManifest, RouteMountDeclaration } from './manifest.ts'
import { DATA_CLASS_ALLOWED_STRATEGIES } from './manifest.ts'
import { validateRouteMount } from './routes.ts'

/** One structured validation failure (Ajv-compatible field names). */
export interface ManifestValidationError {
  readonly instancePath: string
  readonly schemaPath: string
  readonly keyword: string
  readonly message: string
}

export type ManifestValidationResult =
  | { readonly valid: true; readonly manifest: PluginManifest; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly ManifestValidationError[] }

/**
 * Strict SemVer: no ranges, no wildcards, no leading-zero numeric
 * prerelease identifiers (the upstream fixtures reject both).
 */
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const APP_HOOK_NAMES: readonly AppLifecycleHookName[] = ['onInstall', 'onEnable', 'onDisable', 'onUninstall', 'onBeforeShutdown']

const RUNTIME_TRANSPORTS = ['stdio', 'ipc', 'builtin'] as const

function error(instancePath: string, keyword: string, message: string): ManifestValidationError {
  return { instancePath, schemaPath: `#/properties${instancePath}`, keyword, message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkString(value: unknown, path: string, errors: ManifestValidationError[], required: boolean): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (value === undefined && !required) return undefined
  errors.push(error(path, typeof value === 'string' ? 'minLength' : 'type', 'must be a non-empty string'))
  return undefined
}

function checkSemVer(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (typeof value !== 'string') {
    errors.push(error(path, 'type', 'must be a SemVer string'))
    return
  }
  if (!SEMVER_PATTERN.test(value)) {
    errors.push(error(path, 'pattern', `"${value}" is not a strict SemVer (no ranges, no leading-zero prerelease)`))
  }
}

/**
 * Validate an untrusted plugin manifest against the contract. Returns the
 * parsed manifest on success; every detected violation otherwise (the host
 * surfaces them all at once, not one at a time).
 */
export function validateManifest(value: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = []
  if (!isObject(value)) {
    return { valid: false, errors: [error('', 'type', 'manifest must be an object')] }
  }

  const pluginId = checkString(value.pluginId, '/pluginId', errors, true)
  if (pluginId !== undefined && !PLUGIN_ID_PATTERN.test(pluginId)) {
    errors.push(error('/pluginId', 'pattern', `"${pluginId}" is not kebab-case lowercase`))
  }
  checkSemVer(value.version, '/version', errors)
  checkSemVer(value.contractVersion, '/contractVersion', errors)
  checkString(value.name, '/name', errors, true)
  if (value.description !== undefined) checkString(value.description, '/description', errors, true)

  if (!Array.isArray(value.features)) {
    errors.push(error('/features', 'type', 'must be an array'))
  } else {
    value.features.forEach((feature, index) => {
      const base = `/features/${index}`
      if (!isObject(feature)) {
        errors.push(error(base, 'type', 'must be an object'))
        return
      }
      checkString(feature.id, `${base}/id`, errors, true)
      checkString(feature.name, `${base}/name`, errors, true)
      if (!Array.isArray(feature.resources)) {
        errors.push(error(`${base}/resources`, 'type', 'must be an array'))
      } else {
        feature.resources.forEach((resource, resourceIndex) => {
          if (!isObject(resource) || checkString(resource.type, '', [], true) === undefined
            || checkString(resource.id, '', [], true) === undefined) {
            errors.push(error(`${base}/resources/${resourceIndex}`, 'type', 'must declare { type, id }'))
          }
        })
      }
      if (!Array.isArray(feature.capabilities)) {
        errors.push(error(`${base}/capabilities`, 'type', 'must be an array'))
      } else {
        feature.capabilities.forEach((capability, capabilityIndex) => {
          if (typeof capability !== 'string' || !VALID_CAPABILITIES.has(capability)) {
            errors.push(error(`${base}/capabilities/${capabilityIndex}`, 'enum', `unknown capability ${JSON.stringify(capability)}`))
          }
        })
      }
    })
  }

  if (value.data !== undefined) {
    if (!Array.isArray(value.data)) {
      errors.push(error('/data', 'type', 'must be an array'))
    } else {
      value.data.forEach((declaration, index) => {
        const base = `/data/${index}`
        if (!isObject(declaration)) {
          errors.push(error(base, 'type', 'must be an object'))
          return
        }
        checkString(declaration.name, `${base}/name`, errors, true)
        const dataClass = declaration.dataClass
        if (typeof dataClass !== 'string' || !(dataClass in DATA_CLASS_ALLOWED_STRATEGIES)) {
          errors.push(error(`${base}/dataClass`, 'enum', `unknown data class ${JSON.stringify(dataClass)}`))
          return
        }
        const allowed = DATA_CLASS_ALLOWED_STRATEGIES[dataClass as keyof typeof DATA_CLASS_ALLOWED_STRATEGIES]
        if (typeof declaration.strategy !== 'string' || !allowed.includes(declaration.strategy as never)) {
          errors.push(error(`${base}/strategy`, 'enum',
            `strategy ${JSON.stringify(declaration.strategy)} is not allowed for data class "${dataClass}" (allowed: ${allowed.join(', ')})`))
        }
      })
    }
  }

  if (!isObject(value.runtime)) {
    errors.push(error('/runtime', 'type', 'must be an object'))
  } else {
    const transport = value.runtime.transport
    if (!RUNTIME_TRANSPORTS.includes(transport as never)) {
      errors.push(error('/runtime/transport', 'enum', `unknown transport ${JSON.stringify(transport)}`))
    } else if (transport === 'stdio' || transport === 'ipc') {
      checkString(value.runtime.entrypoint, '/runtime/entrypoint', errors, true)
    } else if (value.runtime.entrypoint !== undefined) {
      checkString(value.runtime.entrypoint, '/runtime/entrypoint', errors, true)
    }
  }

  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) {
      errors.push(error('/routes', 'type', 'must be an array'))
    } else {
      value.routes.forEach((route, index) => {
        if (!isObject(route)) {
          errors.push(error(`/routes/${index}`, 'type', 'must be an object'))
          return
        }
        for (const message of validateRouteMount(route as unknown as RouteMountDeclaration)) {
          errors.push(error(`/routes/${index}`, 'pattern', message))
        }
      })
    }
  }

  if (value.credentials !== undefined) {
    if (!Array.isArray(value.credentials)) {
      errors.push(error('/credentials', 'type', 'must be an array'))
    } else {
      value.credentials.forEach((credential, index) => {
        const base = `/credentials/${index}`
        if (!isObject(credential)) {
          errors.push(error(base, 'type', 'must be an object'))
          return
        }
        checkString(credential.id, `${base}/id`, errors, true)
        checkString(credential.provider, `${base}/provider`, errors, true)
        checkString(credential.purpose, `${base}/purpose`, errors, true)
        if (typeof credential.required !== 'boolean') {
          errors.push(error(`${base}/required`, 'type', 'must be a boolean'))
        }
      })
    }
  }

  if (value.lifecycle !== undefined) {
    if (!isObject(value.lifecycle) || !Array.isArray(value.lifecycle.hooks)) {
      errors.push(error('/lifecycle/hooks', 'type', 'must be an array of hook names'))
    } else {
      value.lifecycle.hooks.forEach((hook, index) => {
        if (typeof hook !== 'string' || !APP_HOOK_NAMES.includes(hook as AppLifecycleHookName)) {
          errors.push(error(`/lifecycle/hooks/${index}`, 'enum', `unknown lifecycle hook ${JSON.stringify(hook)} (user-authored hooks are not permitted)`))
        }
      })
    }
  }

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, manifest: value as unknown as PluginManifest, errors: [] }
}

/**
 * Parse and validate a YAML manifest text (R17 assembly format). YAML parse
 * failures surface as a single structural error, then the parsed value runs
 * through the exact same validation as a JSON manifest.
 */
export function loadManifestYaml(text: string): ManifestValidationResult {
  let parsed: unknown
  try {
    parsed = load(text)
  } catch (failure) {
    return {
      valid: false,
      errors: [error('', 'parse', `manifest YAML failed to parse: ${failure instanceof Error ? failure.message : String(failure)}`)],
    }
  }
  return validateManifest(parsed)
}

/** The union of capabilities an installed manifest effectively requests. */
export function manifestCapabilities(manifest: PluginManifest): readonly Capability[] {
  return [...new Set(manifest.features.flatMap(feature => feature.capabilities))]
}
