/**
 * env domain contract: read-only projection of the env-registry
 * (`ctx.envRegistry`, @flowforge/harness-env-registry). Every currentValue has
 * been masked host-side by the registry (sensitive → '***', url → credential
 * stripped), so no secret ever rides a response. Shaped so the web editor's
 * @flowforge/config-schema `toEnvSchemaEntry` populates cleanly. No files /
 * storage state — those are legacy runtime concepts outside this read model.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire projection of one env-registry entry (browser-safe; category key kept as string). */
export interface EnvVariableView {
  /** Env variable name, e.g. 'FF_GLOBAL_CONFIG_ROOT'. */
  name: string
  /** Human-readable description (中文). */
  description?: string
  /** Registry category key (EnvCategory), as plain string for the browser. */
  category: string
  /** True when the value is sensitive and shows masked. */
  sensitive: boolean
  /** Runtime-editability after the fail-closed whitelist (`isEditableEnvVarName`). */
  editable: boolean
  /** Explicit allowed values (cycle-style switch), when declared. */
  allowedValues?: string[]
  /** Current value, already masked ('***' for sensitive, url credentials stripped); null when unset. */
  currentValue: string | null
  /** True when sensitive, so the '***' sentinel is treated as an unchanged secret. */
  masked?: boolean
}

/**
 * Env-domain unary methods (map key env.*). Summary is the domain's only RPC:
 * per-variable writes are refused here — write path belongs to a future
 * `env.set` guarded by the same editable whitelist.
 */
export interface EnvApi {
  /** Returns the registry projection + category labels. */
  summary(request: RpcRequest<{}>): Promise<
    RpcResponse<{ variables: readonly EnvVariableView[]; categories: Record<string, string> }>
  >
}
