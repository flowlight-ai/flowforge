/**
 * ASR 人物记忆队列载体：把服务端书写的 ASR 场景绑定到已持久化的队列消息。
 * 忠实移植 clowder-ai `domains/signal-intake/AsrPersonMemoryQueueCarrier.ts`。
 * 载体是 data-only；它既不授予转写真值，也不授予人物记忆权限。
 * 队列消息经本地 `MeetingArtifactCarrierRecord` 端口注入（宿主 EP4 适配消息 store）。
 *
 * @flowforge/cats-signal-intake
 */

import type {
  AsrPersonMemoryDynamicSceneEntryV1,
  BoundAsrPersonMemoryScene,
} from './contract/asr-person-memory-scene.ts'

/** 队列消息投影（本地端口）：flowforge `StoredMessage` 缺 extra/source/catId 等字段。 */
export interface AsrQueueCarrierMessage {
  readonly id: string
  readonly userId: string
  readonly threadId: string
  readonly catId: string | null
  readonly deletedAt?: number
  readonly _tombstone?: boolean
  readonly extra?: {
    readonly dynamicSceneEntries?: readonly AsrPersonMemoryDynamicSceneEntryV1[]
    readonly meetingArtifact?: {
      readonly trust?: string
      readonly instructionPolicy?: string
    }
  }
}

export function bindAsrPersonMemoryScenesFromQueueMessage(
  message: AsrQueueCarrierMessage,
  scope: { readonly ownerUserId: string; readonly threadId: string },
): readonly BoundAsrPersonMemoryScene[] {
  if (
    message.userId !== scope.ownerUserId ||
    message.threadId !== scope.threadId ||
    message.catId !== null ||
    message.deletedAt !== undefined ||
    message._tombstone ||
    message.extra?.meetingArtifact?.trust !== 'untrusted_external' ||
    message.extra.meetingArtifact.instructionPolicy !== 'data_only'
  ) {
    return []
  }
  return (message.extra.dynamicSceneEntries ?? []).map((scene) => ({
    scene,
    source: {
      kind: 'message',
      threadId: message.threadId,
      sourceMessageId: message.id,
      authorUserId: message.userId,
      authorRole: 'owner',
      visibility: 'verified_live_owner_message',
    },
  }))
}