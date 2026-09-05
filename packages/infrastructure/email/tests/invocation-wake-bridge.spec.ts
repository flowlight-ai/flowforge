/**
 * Invocation Wake Bridge 端到端验证（批次51 C33 收尾）：
 * 真 MemoryInvocationQueueService（cats-invocation）→ createInvocationWakePort →
 * createConnectorInvokeTrigger → TaskSpec 触发链，覆盖 created/deduped/full 三语义。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { MemoryInvocationQueueService } from '@flowforge/cats-invocation/queue'
import { createConnectorInvokeTrigger } from '../src/connector-invoke-trigger.ts'
import { createInvocationWakePort } from '../src/invocation-wake-bridge.ts'

async function makeQueue() {
  const ctx = new Context()
  await ctx.plugin(MemoryInvocationQueueService)
  return ctx.catsInvocationQueue
}

describe('createInvocationWakePort（宿主接线桥）', () => {
  it('created → enqueued：真队列入队，peek 可见 entry，幂等键回放 deduped', async () => {
    const queue = await makeQueue()
    const wake = createInvocationWakePort(queue)
    const trigger = createConnectorInvokeTrigger({ wake })

    const first = await trigger.trigger('th-1', 'cat-1', 'user-1', '请检查 PR', 'msg-1')
    expect(first).toBe('enqueued')

    const entries = queue.peek('th-1' as never, 'user-1' as never)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.source).toBe('connector')
    expect(entries[0]?.sourceCategory).toBe('conflict')
    expect(entries[0]?.targetCatIds).toEqual(['cat-1'])
    expect(entries[0]?.userMessageId).toBe('msg-1')
    expect(entries[0]?.idempotencyKey).toBe('connector-callback:msg-1')

    // 同 messageId 回放 → 幂等去重，仍视为已入队
    const replay = await trigger.trigger('th-1', 'cat-1', 'user-1', '请检查 PR', 'msg-1')
    expect(replay).toBe('enqueued')
    expect(queue.peek('th-1' as never, 'user-1' as never)).toHaveLength(1)
  })

  it('policy 透传：sourceCategory/suggestedSkill 进入入队投影', async () => {
    const queue = await makeQueue()
    const wake = createInvocationWakePort(queue)
    const trigger = createConnectorInvokeTrigger({ wake })
    await trigger.trigger('th-2', 'cat-2', 'user-2', 'msg', 'msg-2', undefined, {
      sourceCategory: 'review',
      suggestedSkill: 'pr-review',
    })
    const entries = queue.peek('th-2' as never, 'user-2' as never)
    expect(entries[0]?.sourceCategory).toBe('review')
    expect(entries[0]?.suggestedSkill).toBe('pr-review')
  })

  it('队列满 → full，onFull=drop 语义由 trigger 层保持', async () => {
    // 容量上限仅对 user 来源生效（memory 队列语义），用结构化桩直接模拟 full
    const stubQueue = {
      enqueue(): { outcome: 'full'; entry?: undefined; dedupedEntryId?: undefined } {
        return { outcome: 'full' }
      },
    }
    const onFullCalls: Array<Record<string, string>> = []
    const wake = createInvocationWakePort(stubQueue)
    const trigger = createConnectorInvokeTrigger({
      wake,
      onFull: (input) => {
        onFullCalls.push(input)
        return 'drop'
      },
    })
    const outcome = await trigger.trigger('th-3', 'cat-3', 'user-3', 'msg', 'msg-3')
    expect(outcome).toBe('full')
    expect(onFullCalls).toEqual([{ threadId: 'th-3', catId: 'cat-3' }])
  })

  it('端到端：TaskSpec execute 经 InvokeTrigger 唤醒真队列（C33 闭环）', async () => {
    const queue = await makeQueue()
    const wake = createInvocationWakePort(queue)
    const trigger = createConnectorInvokeTrigger({ wake })
    // 模拟 email TaskSpec 的 execute：deliver 消息后触发唤醒
    const execute = async (): Promise<void> => {
      const outcome = await trigger.trigger('th-4', 'cat-4', 'user-4', 'conflict auto-resolve', 'msg-4')
      if (outcome === 'full') throw new Error('queue full')
    }
    await execute()
    const entries = queue.peek('th-4' as never, 'user-4' as never)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.idempotencyKey).toBe('connector-callback:msg-4')
  })
})
