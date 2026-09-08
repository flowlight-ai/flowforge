/**
 * @flowforge/chat-messaging — Plugin Messaging domain host/kernel core (K-1 / F288).
 *
 * Truth source: clowder-ai `packages/api/src/domains/messaging` (§3.1).
 *
 * This batch (EP1-3) ports the self-contained host/kernel core:
 * - `contract`: input admission (validate/validate-draft/append) + host types;
 * - `envelope`: canonical MessageEnvelope projection + plugin-message parser;
 * - `handles`: host-issued address handles (AC-2);
 * - `ledger`: idempotent settlement ledger (AC-5);
 * - `stores`: store ports + in-memory implementations (ledger/handles/events/
 *   append-lock/cursor+snapshot).
 *
 * The send/append services, event-stream, snapshot assembly, and Redis store
 * adapters are deferred to EP1-4 (they depend on IMessageStore delivery and
 * the injection-style Redis seam). Messaging contract wire types, bounds and
 * validators live in `@flowforge/plugin-contract` (`messaging.ts`).
 */

export type {
  AppendElementsRequest,
  AppendReceipt,
  CanonicalAudience,
  EpistemicStatus,
  MessageAddress,
  MessageDraft,
  MessageElement,
  MessageEnvelope,
  MessageOutputEvent,
  MessagingErrorCode,
  SendReceipt,
} from '@flowforge/plugin-contract'
export type {
  HandleScope,
  PluginCallContext,
  ReadResult,
  SnapshotResult,
  SubscribeResult,
} from './contract/host-types.js'
export { MessagingError } from './contract/host-types.js'
export { projectEnvelope, renderElementsText, parsePluginMessageExtra, readPluginMessageExtra } from './envelope.js'
export type { AppendOpRecord, EnvelopeStoredMessage, PluginMessageExtra } from './envelope.js'
export { HandleService } from './handles.js'
export type { IssueConnectorBindingHandleInput, IssueThreadHandleInput } from './handles.js'
export { MessagingLedger, LEDGER_CLAIM_TTL_MS, LEDGER_RETENTION_MS } from './ledger.js'
export type { TypedClaim } from './ledger.js'
export * from './stores/index.js'