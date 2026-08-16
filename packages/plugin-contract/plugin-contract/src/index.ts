/**
 * @flowforge/plugin-contract
 *
 * The application-layer plugin contract (D22b, T2.15): the single
 * machine-readable truth for FlowForge APPLICATION plugins (cats/chat/limb/
 * forgekin domains, stage 4+), derived from the upstream application
 * plugin-contract reference and extended for the FlowForge
 * fusion plan:
 *
 * - manifest: capability/data/runtime declarations (upstream shape) plus
 *   routes (`/api/v2/*`, R18), credential requirements, lifecycle hooks;
 * - capability: the L0/L1/L2 authorization table (@signed(G-0));
 * - grants: fail-closed effective-grant validation (wire/grants);
 * - validation: untrusted-manifest boundary + YAML assembly entry (R17);
 * - conformance: kernel (R13) + application contract checker for hosts.
 *
 * Same-source with the kernel contract (R13): an application plugin IS a
 * cordis plugin; this package governs what it may declare and do once
 * mounted, never how it mounts.
 *
 * @module @flowforge/plugin-contract
 */

export * from './capability.ts'
export * from './manifest.ts'
export * from './routes.ts'
export * from './lifecycle.ts'
export * from './grants.ts'
export * from './validation.ts'
export * from './conformance.ts'
