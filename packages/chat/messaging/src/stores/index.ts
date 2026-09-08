/**
 * Plugin Messaging — store surface.
 *
 * Ports (interfaces) plus the in-memory implementations for dev/test.
 * Redis implementations are deferred to EP1-4 alongside the event-stream,
 * send/append services and their redis-* store adapters.
 */

export * from './ports.js'
export * from './memory.js'
export { MemoryCursorStore } from './memory-cursor.js'