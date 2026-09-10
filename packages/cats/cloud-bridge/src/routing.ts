import type { CloudInvokeRequest } from './cloud-bridge-types.ts'

/**
 * Pure capability routing: decide whether an invocation can be answered by the
 * local cat (all required capabilities are advertised) or must be dispatched
 * to the cloud bridge.
 */
export type RoutingDecision =
  | { outcome: 'local'; missingCapabilities: [] }
  | { outcome: 'cloud'; missingCapabilities: string[] }

export function resolveRouting(request: CloudInvokeRequest, advertisedCapabilities: Iterable<string>): RoutingDecision {
  const available = new Set(advertisedCapabilities)
  const missing = request.requiredCapabilities.filter((cap) => !available.has(cap))
  if (missing.length === 0) return { outcome: 'local', missingCapabilities: [] }
  return { outcome: 'cloud', missingCapabilities: missing }
}