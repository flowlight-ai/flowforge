/**
 * Wire-safe JSON value vocabulary for `@flowforge/cordis-client-runner`. Stands
 * in for the dsh `dsh-util-values` `JsonValue` the inspect providers and the
 * `host.call` contract carried; defined here so the package needs no external
 * utility dependency.
 *
 * @module @flowforge/cordis-client-runner/values
 */

/** A JSON-serializable value, as the wire contract accepts and returns it. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export default JsonValue