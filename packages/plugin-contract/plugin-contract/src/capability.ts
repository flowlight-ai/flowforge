/**
 * Application-layer capability table, derived from the upstream application
 * plugin-contract reference (`CAPABILITY_TABLE`,
 * `@signed(G-0 2026-07-15)`): every host service a plugin may reach is a
 * named capability in one of three authorization layers.
 *
 * - L0: intrinsic plugin self-service (config read, private state) — granted
 *   by installation, never asked.
 * - L1: host-mediated side effects the user can anticipate (send messages,
 *   register schedules, publish events).
 * - L2: user-data access and inbound triggers — explicit approval territory.
 *
 * The FlowForge kernel contract (R13) governs HOW a package plugs into
 * `ctx`; this table governs WHAT an application plugin may do once plugged
 * in. The two are same-source by design: capability names mirror the `ctx.*`
 * service they gate.
 *
 * @module @flowforge/plugin-contract/capability
 */

/** L0: plugin self-service capabilities, granted by installation. */
export const L0_CAPABILITIES = ['plugin.config.read', 'plugin.state.get', 'plugin.state.set'] as const

/** L1: host-mediated side-effect capabilities. */
export const L1_CAPABILITIES = ['messaging.send', 'schedule.register', 'events.publish', 'messaging.appendElements'] as const

/** L2: user-data access and inbound-trigger capabilities. */
export const L2_CAPABILITIES = [
  'onMessage',
  'message.event.subscribe',
  'secret.read',
  'thread.listMetadata',
  'thread.readContent',
  'memory.query',
  'memory.append',
  'memory.retrieve',
  'windows.create',
  'whisper.extend',
] as const

export type L0Capability = (typeof L0_CAPABILITIES)[number]
export type L1Capability = (typeof L1_CAPABILITIES)[number]
export type L2Capability = (typeof L2_CAPABILITIES)[number]

/** The closed capability table, keyed by authorization layer. */
export const CAPABILITY_TABLE = {
  L0: L0_CAPABILITIES,
  L1: L1_CAPABILITIES,
  L2: L2_CAPABILITIES,
} as const

/** One authorization layer of the capability table. */
export type AuthorizationLayer = keyof typeof CAPABILITY_TABLE

/** Every capability name the contract recognizes (closed enum). */
export type Capability = L0Capability | L1Capability | L2Capability

/** Frozen set of all valid capability values, for closed-enum membership. */
export const VALID_CAPABILITIES: ReadonlySet<string> = new Set([
  ...L0_CAPABILITIES,
  ...L1_CAPABILITIES,
  ...L2_CAPABILITIES,
])

/** Return the schema-owned authorization layer for a capability identifier. */
export function getCapabilityLayer(capability: string): AuthorizationLayer | undefined {
  for (const layer of Object.keys(CAPABILITY_TABLE) as AuthorizationLayer[]) {
    if ((CAPABILITY_TABLE[layer] as readonly string[]).includes(capability)) return layer
  }
  return undefined
}
