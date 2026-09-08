/**
 * @flowforge/plugin-contract — Messaging domain contract types
 *
 * Ported from the clowder-ai application plugin contract (§3.1 messaging) and
 * made self-contained for FlowForge. This is the machine-readable truth for the
 * chat/messaging domain wire shapes: drafts, envelopes, elements, provenance,
 * addresses/handles, receipts, output events and their admission bounds.
 *
 * Two validation entry points are provided for the untrusted host boundary:
 * - `validateMessagingRowInput`  — drafts and append requests (`send`, `appendElements`);
 * - `validateMessagingRowResult` — host-produced output rows (e.g. `snapshot`).
 * Both are fail-closed structural checks over JSON-scalar trees.
 *
 * @module @flowforge/plugin-contract/messaging
 */

// ── Bounds (§3.1) ──────────────────────────────────────────────────────────

/** Messaging admission bounds, single source of truth for limits. */
export const MESSAGING_BOUNDS = {
  /** Max elements accepted in one operation (send / append). */
  maxElementsPerOperation: 32,
  /** Max JSON payload bytes for a single element. */
  maxElementPayloadBytes: 65536,
  /** Max cumulative JSON payload bytes for one persisted message. */
  maxTotalPayloadBytes: 262144,
  /** Max whisper targets in a whisper audience. */
  maxWhisperTargets: 16,
  /** Max length of an idempotency key / operation id. */
  maxIdempotencyKeyLength: 200,
  /** Max length of an element id. */
  maxElementIdLength: 128,
  /** Max cumulative elements in a persisted message envelope. */
  maxElementsPerMessage: 128,
  /** Max append operations (revisions) retained per message. */
  maxAppendOpsPerMessage: 64,
} as const

// ── Enumerations ───────────────────────────────────────────────────────────

/** Wire actor kinds. */
export type ActorKind = 'user' | 'cat' | 'plugin' | 'device' | 'system'

/** Epistemic status of an element / message. */
export type EpistemicStatus = 'observation' | 'user_intent' | 'inference'

/** Kind discriminator of a message element. */
export type ElementKind = 'text' | 'media_ref' | 'rich_block'

/** Host throw convention error codes (§3.1). */
export type MessagingErrorCode =
  | 'VALIDATION'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RETRYABLE_INFLIGHT'
  | 'STALE_CURSOR'

// ── Small structural primitives ────────────────────────────────────────────

/** A structured reference to the authoring actor. */
export interface ActorRef {
  readonly kind: ActorKind
  readonly id: string
}

// ── Provenance ─────────────────────────────────────────────────────────────

export interface PluginOrigin {
  readonly kind: 'plugin'
  readonly instanceId: string
}

export interface ExternalSourceAddress {
  readonly connectorId: string
  readonly chatId: string
  readonly messageId?: string
}

export interface ExternalOrigin {
  readonly kind: 'external'
  readonly connectorId: string
  readonly sourceAddress: ExternalSourceAddress
}

export interface HostOrigin {
  readonly kind: 'host'
}

/** Origin union for persisted messages. */
export type ProvenanceOrigin = PluginOrigin | ExternalOrigin | HostOrigin

/** Origin union allowed on self-declared drafts (host origin is host-only). */
export type DraftOrigin = PluginOrigin | ExternalOrigin

/** Provenance stamped on a persisted message. */
export interface MessageProvenance {
  readonly origin: ProvenanceOrigin
  readonly epistemicStatus: EpistemicStatus
}

/** Provenance declared on a draft (host origin rejected at admission, D-4). */
export interface DraftProvenance {
  readonly origin: DraftOrigin
  readonly epistemicStatus: EpistemicStatus
}

// ── Audience ───────────────────────────────────────────────────────────────

export interface PublicAudience {
  readonly kind: 'public'
}

export interface WhisperAudience {
  readonly kind: 'whisper'
  readonly targets: readonly string[]
}

export interface SystemAudience {
  readonly kind: 'system'
}

/** Audience a plugin may declare on a draft. */
export type DraftAudience = PublicAudience | WhisperAudience

/** Canonical audience of a persisted message (system is host-only). */
export type CanonicalAudience = PublicAudience | WhisperAudience | SystemAudience

// ── Elements ───────────────────────────────────────────────────────────────

export interface TextElementPayload {
  readonly text: string
}

export interface MediaRefElementPayload {
  readonly [key: string]: unknown
}

export interface RichBlockElementPayload {
  readonly [key: string]: unknown
}

interface MessageElementBase {
  readonly elementId: string
  readonly derivedFromElementId?: string
  readonly epistemicStatus?: EpistemicStatus
}

export interface TextMessageElement extends MessageElementBase {
  readonly kind: 'text'
  readonly payload: TextElementPayload
}

export interface MediaRefMessageElement extends MessageElementBase {
  readonly kind: 'media_ref'
  readonly payload: MediaRefElementPayload
}

export interface RichBlockMessageElement extends MessageElementBase {
  readonly kind: 'rich_block'
  readonly payload: RichBlockElementPayload
}

/** A single message element (text / media_ref / rich_block). */
export type MessageElement = TextMessageElement | MediaRefMessageElement | RichBlockMessageElement

// ── Payload ────────────────────────────────────────────────────────────────

/** Canonical payload of a persisted message envelope. */
export interface MessagePayload {
  readonly provenance: MessageProvenance
  readonly elements: readonly MessageElement[]
  readonly correlationId?: string
  readonly causationId?: string
}

/** Payload carried by a draft (more open provenance; capped at operation bounds). */
export interface DraftPayload {
  readonly provenance: DraftProvenance
  readonly elements: readonly MessageElement[]
  readonly correlationId?: string
  readonly causationId?: string
}

// ── Addresses & handles ────────────────────────────────────────────────────

export interface ThreadHandleAddress {
  readonly kind: 'thread_handle'
  readonly handle: string
}

export interface ConnectorBindingAddress {
  readonly kind: 'connector_binding'
  readonly handle: string
}

/** Draft addressing channel — there is no bare-threadId path (§3.1). */
export type MessageAddress = ThreadHandleAddress | ConnectorBindingAddress

/** Host-opaque message capability minted on send. */
export interface MessageHandle {
  readonly kind: 'message'
  readonly token: string
}

// ── Drafts ─────────────────────────────────────────────────────────────────

export interface MessageDraft {
  readonly address: MessageAddress
  readonly draftAudience?: DraftAudience
  readonly idempotencyKey: string
  readonly sourceEventId?: string
  readonly replyTo?: string
  readonly payload: DraftPayload
}

// ── Append ─────────────────────────────────────────────────────────────────

export interface AppendElementsRequest {
  readonly handle: MessageHandle
  readonly operationId: string
  readonly baseRevision?: number
  readonly elements: readonly MessageElement[]
}

// ── Envelopes ──────────────────────────────────────────────────────────────

/** Canonical projection of a stored message. */
export interface MessageEnvelope {
  readonly messageId: string
  readonly revision: number
  readonly threadId: string
  readonly replyTo?: string
  readonly actor: ActorRef
  readonly audience: CanonicalAudience
  readonly occurredAt: string
  readonly payload: MessagePayload
}

// ── Output events ──────────────────────────────────────────────────────────

export interface MessagePublishEvent {
  readonly eventId: string
  readonly sequence: number
  readonly type: 'message.publish'
  readonly envelope: MessageEnvelope
}

export interface MessageElementsAppendEvent {
  readonly eventId: string
  readonly sequence: number
  readonly type: 'message.elements.append'
  readonly messageId: string
  readonly threadId: string
  readonly operationId: string
  readonly baseRevision?: number
  readonly revision: number
  readonly elements: readonly MessageElement[]
}

/** Discriminated output event of the per-thread publish log. */
export type MessageOutputEvent = MessagePublishEvent | MessageElementsAppendEvent

// ── Receipts ───────────────────────────────────────────────────────────────

export interface SendReceipt {
  readonly messageId: string
  readonly threadId: string
  readonly revision: number
  readonly handle?: MessageHandle
  readonly publishSequence?: number
}

export interface AppendReceipt {
  readonly messageId: string
  readonly revision: number
  readonly appendSequence?: number
  readonly appliedElementIds: readonly string[]
}

// ── Subscription & snapshot surface (contract shapes consumed by host responses) ──

/** Opaque, subscription-local acknowledgement token. */
export type SubscriptionCursor = string

export type SubscriptionReadResponse = {
  readonly events: readonly MessageOutputEvent[]
  readonly ackToken: SubscriptionCursor | null
  readonly stale: boolean
}

/**
 * Snapshot response row. Follows the beta.11 host shape consumed by the
 * envelope historical validation path: a page of envelopes plus cursor tokens.
 */
export interface SnapshotResponse {
  readonly items: readonly MessageEnvelope[]
  readonly nextPageToken: string | null
  readonly snapshotAckToken: string | null
}

export type SnapshotUnavailableReason =
  | 'no_snapshot'
  | 'snapshot_expired'
  | 'replay_floor'
  | 'unauthorized'

// Host-internal read/subscribe aliases (kept as opaque shapes; expanded by the
// event-stream service in EP1-4).

/** Host-side result of a subscription read. */
export interface M0CReadResult {
  readonly data: SubscriptionReadResponse
}

/** Host-side result of a subscribe call. */
export interface M0CSubscribeResult {
  readonly subscriptionId: string
}

// ── Validation ─────────────────────────────────────────────────────────────

/** A single structural validation finding on the messaging row tree. */
export interface MessagingRowValidationError {
  readonly instancePath?: string
  readonly keyword?: string
  readonly message?: string
}

/** Result of a messaging row validation. */
export interface MessagingRowValidationResult {
  readonly valid: boolean
  readonly value?: unknown
  readonly errors?: readonly MessagingRowValidationError[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unicodeScalarLength(value: string): number | null {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null
    }
    count += 1
  }
  return count
}

/** Fail-closed scalar string admission (bounded, non-empty, valid UTF-16). */
function isBoundedScalarString(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false
  const length = unicodeScalarLength(value)
  return length !== null && length > 0 && length <= maxLength
}

function isOptionalBoundedScalarString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedScalarString(value, maxLength)
}

function isUInt53(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

/** Fail-closed admission for an unsigned integer on the wire (min-inclusive). */
export function isWireUInt53(value: number, min = 0): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= Number.MAX_SAFE_INTEGER
}

/** Fail-closed admission for a single element tree. */
function isElement(value: unknown): value is MessageElement {
  if (
    !isRecord(value) ||
    !isBoundedScalarString(value.elementId, MESSAGING_BOUNDS.maxElementIdLength) ||
    (value.kind !== 'text' && value.kind !== 'media_ref' && value.kind !== 'rich_block') ||
    !isRecord(value.payload) ||
    !isOptionalBoundedScalarString(value.derivedFromElementId, MESSAGING_BOUNDS.maxElementIdLength)
  ) {
    return false
  }
  if (value.epistemicStatus !== undefined &&
    value.epistemicStatus !== 'observation' &&
    value.epistemicStatus !== 'user_intent' &&
    value.epistemicStatus !== 'inference') {
    return false
  }
  if (value.kind === 'text') {
    if (typeof value.payload.text !== 'string') return false
  }
  let bytes = 0
  try {
    bytes = Buffer.byteLength(JSON.stringify(value.payload), 'utf8')
  } catch {
    return false
  }
  return bytes <= MESSAGING_BOUNDS.maxElementPayloadBytes
}

function validateElements(elements: unknown): elements is readonly MessageElement[] {
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > MESSAGING_BOUNDS.maxElementsPerOperation) {
    return false
  }
  if (!elements.every(isElement)) return false
  const seen = new Set<string>()
  let total = 0
  for (const element of elements as unknown as Array<Record<string, unknown>>) {
    const id = element.elementId as string
    if (seen.has(id)) return false
    seen.add(id)
    const derived = element.derivedFromElementId as string | undefined
    if (derived !== undefined && !seen.has(derived)) return false
    try {
      total += Buffer.byteLength(JSON.stringify(element.payload), 'utf8')
    } catch {
      return false
    }
  }
  return total <= MESSAGING_BOUNDS.maxTotalPayloadBytes
}

/** Shared structural validation for a MessageHandle. */
function isMessageHandle(value: unknown): value is MessageHandle {
  return isRecord(value) && value.kind === 'message' && isBoundedScalarString(value.token, 256)
}

type OperationKey = 'messaging.send' | 'messaging.appendElements' | 'messaging.snapshot'

function failFirst(_operation: OperationKey, input: unknown): MessagingRowValidationResult {
  return { valid: false, value: input }
}

/** Validate an untrusted messaging input row (send / appendElements). */
export function validateMessagingRowInput(
  operation: OperationKey,
  input: unknown,
): MessagingRowValidationResult {
  if (operation === 'messaging.send') return validateSendInput(input)
  if (operation === 'messaging.appendElements') return validateAppendInput(input)
  return failFirst(operation, input)
}

/** Validate a host-produced messaging output row (e.g. snapshot). */
export function validateMessagingRowResult(
  operation: OperationKey,
  input: unknown,
): MessagingRowValidationResult {
  if (operation === 'messaging.snapshot') return validateSnapshotResult(input)
  return failFirst(operation, input)
}

function validateSendInput(input: unknown): MessagingRowValidationResult {
  if (!isRecord(input)) return failFirst('messaging.send', input)
  if (!isMessageAddress(input.address)) return failFirst('messaging.send', input)
  if (!isBoundedScalarString(input.idempotencyKey, MESSAGING_BOUNDS.maxIdempotencyKeyLength)) {
    return failFirst('messaging.send', input)
  }
  if (input.draftAudience !== undefined && !isDraftAudience(input.draftAudience)) {
    return failFirst('messaging.send', input)
  }
  if (!isOptionalBoundedScalarString(input.sourceEventId, 512)) return failFirst('messaging.send', input)
  if (!isOptionalBoundedScalarString(input.replyTo, 256)) return failFirst('messaging.send', input)
  if (!isRecord(input.payload) || !isDraftPayload(input.payload)) return failFirst('messaging.send', input)
  return { valid: true, value: input }
}

function validateAppendInput(input: unknown): MessagingRowValidationResult {
  if (!isRecord(input)) return failFirst('messaging.appendElements', input)
  if (!isMessageHandle(input.handle)) return failFirst('messaging.appendElements', input)
  if (!isBoundedScalarString(input.operationId, MESSAGING_BOUNDS.maxIdempotencyKeyLength)) {
    return failFirst('messaging.appendElements', input)
  }
  if (input.baseRevision !== undefined && !isUInt53(input.baseRevision, 1)) {
    return failFirst('messaging.appendElements', input)
  }
  if (!validateElements(input.elements)) return failFirst('messaging.appendElements', input)
  return { valid: true, value: input }
}

function validateSnapshotResult(input: unknown): MessagingRowValidationResult {
  if (!isRecord(input)) return failFirst('messaging.snapshot', input)
  if (!Array.isArray(input.items) || !input.items.every(isEnvelope)) return failFirst('messaging.snapshot', input)
  if (input.nextPageToken !== null && !isBoundedScalarString(input.nextPageToken, 512)) {
    return failFirst('messaging.snapshot', input)
  }
  if (input.snapshotAckToken !== null && !isBoundedScalarString(input.snapshotAckToken, 512)) {
    return failFirst('messaging.snapshot', input)
  }
  return { valid: true, value: input }
}

function isMessageAddress(value: unknown): value is MessageAddress {
  if (!isRecord(value)) return false
  if (value.kind === 'thread_handle' || value.kind === 'connector_binding') {
    return isBoundedScalarString(value.handle, 256)
  }
  return false
}

function isDraftAudience(value: unknown): value is DraftAudience {
  if (!isRecord(value)) return false
  if (value.kind === 'public') return true
  if (value.kind !== 'whisper') return false
  return (
    Array.isArray(value.targets) &&
    value.targets.length >= 1 &&
    value.targets.length <= MESSAGING_BOUNDS.maxWhisperTargets &&
    new Set(value.targets).size === value.targets.length &&
    value.targets.every((target) => isBoundedScalarString(target, 256))
  )
}

function isDraftOrigin(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'plugin') return isBoundedScalarString(value.instanceId, 256)
  if (value.kind !== 'external') return false
  if (!isBoundedScalarString(value.connectorId, 256)) return false
  if (value.sourceAddress === undefined) return true
  if (!isRecord(value.sourceAddress)) return false
  return (
    isBoundedScalarString(value.sourceAddress.connectorId, 256) &&
    isBoundedScalarString(value.sourceAddress.chatId, 512) &&
    isOptionalBoundedScalarString(value.sourceAddress.messageId, 512)
  )
}

function isDraftProvenance(value: unknown): value is DraftProvenance {
  if (!isRecord(value)) return false
  if (value.epistemicStatus !== 'observation' &&
    value.epistemicStatus !== 'user_intent' &&
    value.epistemicStatus !== 'inference') {
    return false
  }
  return isDraftOrigin(value.origin)
}

function isDraftPayload(value: unknown): value is DraftPayload {
  if (!isRecord(value)) return false
  if (!isDraftProvenance(value.provenance)) return false
  if (!validateElements(value.elements)) return false
  if (!isOptionalBoundedScalarString(value.correlationId, 256)) return false
  if (!isOptionalBoundedScalarString(value.causationId, 256)) return false
  return true
}

function isProvenance(value: unknown): value is MessageProvenance {
  if (!isRecord(value)) return false
  if (value.epistemicStatus !== 'observation' &&
    value.epistemicStatus !== 'user_intent' &&
    value.epistemicStatus !== 'inference') {
    return false
  }
  if (!isRecord(value.origin)) return false
  if (value.origin.kind === 'host') return true
  if (value.origin.kind === 'plugin') return isBoundedScalarString(value.origin.instanceId, 256)
  return isDraftOrigin(value.origin)
}

function isAudience(value: unknown): value is CanonicalAudience {
  if (!isRecord(value)) return false
  if (value.kind === 'public' || value.kind === 'system') return true
  if (value.kind !== 'whisper') return false
  return (
    Array.isArray(value.targets) &&
    value.targets.length >= 1 &&
    value.targets.length <= MESSAGING_BOUNDS.maxWhisperTargets &&
    new Set(value.targets).size === value.targets.length &&
    value.targets.every((target) => isBoundedScalarString(target, 256))
  )
}

function isEnvelope(value: unknown): value is MessageEnvelope {
  if (
    !isRecord(value) ||
    !isBoundedScalarString(value.messageId, 512) ||
    !isUInt53(value.revision, 1) ||
    !isBoundedScalarString(value.threadId, 512) ||
    !isRecord(value.actor) ||
    typeof value.actor.kind !== 'string' ||
    !isBoundedScalarString(value.actor.id, 512) ||
    !isAudience(value.audience) ||
    typeof value.occurredAt !== 'string' ||
    !value.occurredAt.endsWith('Z') ||
    !isRecord(value.payload) ||
    !isProvenance(value.payload.provenance) ||
    !validateElements(value.payload.elements)
  ) {
    return false
  }
  if (value.replyTo !== undefined && !isBoundedScalarString(value.replyTo, 256)) return false
  if (!isOptionalBoundedScalarString(value.payload.correlationId, 256)) return false
  if (!isOptionalBoundedScalarString(value.payload.causationId, 256)) return false
  return true
}