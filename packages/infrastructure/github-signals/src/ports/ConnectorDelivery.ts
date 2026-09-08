/**
 * @flowforge/infrastructure-github-signals — Connector delivery port + memory impl
 *
 * Self-contained port of the clowder-ai `infrastructure/email/deliver-connector-message.ts`
 * delivery seam. The lifecycle publishes wait outcomes through an injectable
 * delivery function returning `{ messageId, content }`. The in-memory implementation
 * records the deliveries and returns a deterministic messageId (real contract impl).
 */

import type {
  GitHubWaitMatchedDelta,
  WaitContinuationCarrierV1,
} from '../contract/predicate.ts'

export interface ConnectorSource {
  readonly connector: string
  readonly label: string
  readonly icon: string
  readonly url?: string
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface ConnectorDeliveryInput {
  readonly threadId: string
  readonly userId: string
  readonly catId: string
  readonly content: string
  readonly idempotencyKey?: string
  readonly source: ConnectorSource
  readonly extra?: Readonly<Record<string, unknown>>
}

/** Extra metadata a caller can attach to an observation (propagated to delivery). */
export interface GitHubWaitDeliveryExtra {
  readonly matched?: readonly GitHubWaitMatchedDelta[]
}

export interface ConnectorDeliveryResult {
  readonly messageId: string
  readonly content: string
}

/** Delivery capability injected into the lifecycle service. */
export interface ConnectorDeliveryDeps {
  deliver(input: ConnectorDeliveryInput): Promise<ConnectorDeliveryResult>
}

/** Carries a delivered outcome's continuation carrier (source.meta). */
export function waitContinuationCarrierMeta(
  carrier: WaitContinuationCarrierV1,
): { waitContinuationCarrier: WaitContinuationCarrierV1 } {
  return { waitContinuationCarrier: carrier }
}

/** In-memory delivery implementation — the real contract for tests. */
export class MemoryConnectorDelivery implements ConnectorDeliveryDeps {
  readonly delivered: ConnectorDeliveryInput[] = []

  async deliver(input: ConnectorDeliveryInput): Promise<ConnectorDeliveryResult> {
    this.delivered.push(input)
    const messageId = `msg:${this.delivered.length}`
    return { messageId, content: input.content }
  }
}