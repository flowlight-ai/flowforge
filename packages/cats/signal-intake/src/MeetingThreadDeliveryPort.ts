/**
 * 会议线程交付端口：deliver/retryPresentation 面向发布载体的编排边界。
 * 忠实移植 clowder-ai `domains/signal-intake/ThreadMeetingArtifactDispatcher.ts`
 * 面向 cats-invocation + 消息 store 的真实接线；本包仅交付**注入式端口**，
 * 真实队列/消息持久化接线为 EP2/EP4 下游（见 design §6）。
 *
 * @flowforge/cats-signal-intake — MeetingThreadDeliveryPort
 */

import type { MeetingArtifactDescriptor } from './contract/signals.ts'
import type { AsrPersonMemoryDynamicSceneEntryV1 } from './contract/asr-person-memory-scene.ts'

export interface MeetingCarrierSource {
  readonly connector: string
  readonly label: string
  readonly icon: string
}

/** 一次会议动态载体的完整交付信息（由调度器编排后交给端口落地）。 */
export interface MeetingDynamicCarrier {
  readonly threadId: string
  readonly ownerId: string
  readonly catId: string
  readonly idempotencyKey: string
  readonly content: string
  readonly source: MeetingCarrierSource
  readonly sourceRevision: string
  readonly meetingArtifact: MeetingArtifactDescriptor
  readonly dynamicSceneEntries: readonly AsrPersonMemoryDynamicSceneEntryV1[]
  readonly timestamp: number
}

export interface MeetingDynamicCarrierReceipt {
  readonly sourceMessageId: string
  readonly queueEntryId: string
  readonly deduped: boolean
}

export interface MeetingPresentationRetryCarrier {
  readonly threadId: string
  readonly ownerId: string
  readonly catId: string
  readonly sourceMessageId: string
  readonly sourceOpportunityId: string
  readonly content: string
  readonly idempotencyKey: string
  readonly timestamp: number
}

export interface MeetingTriggerReceipt {
  readonly triggerMessageId: string
  readonly queueEntryId: string
  readonly deduped: boolean
}

/** 已持久化载体的只读投影（供调度器核验 source receipt）。 */
export interface MeetingCarrierResolved {
  readonly messageId: string
  readonly userId: string
  readonly threadId: string
  readonly catId: string | null
  readonly source?: MeetingCarrierSource
  readonly sourceRevision?: string
  readonly content: string
  readonly dynamicSceneEntries?: readonly AsrPersonMemoryDynamicSceneEntryV1[]
}

export interface MeetingThreadDeliveryPort {
  /** 幂等落地动态载体；返回持久化后 source receipt。 */
  deliverDynamicCarrier(carrier: MeetingDynamicCarrier): Promise<MeetingDynamicCarrierReceipt>
  /** 回查已持久化载体（按幂等键）以核验 source receipt。 */
  getCarrierByIdempotencyKey(
    ownerId: string,
    threadId: string,
    idempotencyKey: string,
  ): Promise<MeetingCarrierResolved | null>
  /** 该 cat 是否支持写机会连续呈现（presentation continuity）。 */
  supportsPresentationRetry(catId: string): boolean
  /** 幂等落地 presentation-retry 触发器载体。 */
  deliverPresentationRetry(carrier: MeetingPresentationRetryCarrier): Promise<MeetingTriggerReceipt>
  /** 回查已持久化触发器载体（按幂等键）。 */
  getTriggerByIdempotencyKey(
    threadId: string,
    idempotencyKey: string,
  ): Promise<MeetingCarrierResolved | null>
}

// ── 内存实现（契约测试用）──────────────────────────────────────────────

export class MemoryMeetingThreadDeliveryPort implements MeetingThreadDeliveryPort {
  private readonly carriers = new Map<string, MeetingCarrierResolved>()
  private readonly triggers = new Map<string, MeetingCarrierResolved>()

  constructor(
    private readonly options: {
      readonly supportsPresentationRetry: (catId: string) => boolean
    } = { supportsPresentationRetry: () => true },
  ) {}

  async deliverDynamicCarrier(carrier: MeetingDynamicCarrier): Promise<MeetingDynamicCarrierReceipt> {
    const key = this.carrierKey(carrier.ownerId, carrier.threadId, carrier.idempotencyKey)
    const existing = this.carriers.get(key)
    if (existing) return { sourceMessageId: existing.messageId, queueEntryId: `entry-${existing.messageId}`, deduped: true }
    const messageId = `msg-${carrier.threadId}-${carrier.idempotencyKey}`
    this.carriers.set(key, {
      messageId,
      userId: carrier.ownerId,
      threadId: carrier.threadId,
      catId: null,
      source: carrier.source,
      sourceRevision: carrier.sourceRevision,
      content: carrier.content,
      dynamicSceneEntries: [...carrier.dynamicSceneEntries],
    })
    return { sourceMessageId: messageId, queueEntryId: `entry-${messageId}`, deduped: false }
  }

  async getCarrierByIdempotencyKey(
    ownerId: string,
    threadId: string,
    idempotencyKey: string,
  ): Promise<MeetingCarrierResolved | null> {
    const record = this.carriers.get(this.carrierKey(ownerId, threadId, idempotencyKey))
    return record ? structuredClone(record) : null
  }

  supportsPresentationRetry(catId: string): boolean {
    return this.options.supportsPresentationRetry(catId)
  }

  async deliverPresentationRetry(carrier: MeetingPresentationRetryCarrier): Promise<MeetingTriggerReceipt> {
    const key = this.triggerKey(carrier.threadId, carrier.idempotencyKey)
    const existing = this.triggers.get(key)
    if (existing) return { triggerMessageId: existing.messageId, queueEntryId: `entry-${existing.messageId}`, deduped: true }
    const triggerMessageId = `trigger-${carrier.threadId}-${carrier.idempotencyKey}`
    this.triggers.set(key, {
      messageId: triggerMessageId,
      userId: 'scheduler',
      threadId: carrier.threadId,
      catId: null,
      content: carrier.content,
    })
    return { triggerMessageId, queueEntryId: `entry-${triggerMessageId}`, deduped: false }
  }

  async getTriggerByIdempotencyKey(
    threadId: string,
    idempotencyKey: string,
  ): Promise<MeetingCarrierResolved | null> {
    const record = this.triggers.get(this.triggerKey(threadId, idempotencyKey))
    return record ? structuredClone(record) : null
  }

  private carrierKey(ownerId: string, threadId: string, idempotencyKey: string): string {
    return `${ownerId}\u0000${threadId}\u0000${idempotencyKey}`
  }

  private triggerKey(threadId: string, idempotencyKey: string): string {
    return `${threadId}\u0000${idempotencyKey}`
  }
}