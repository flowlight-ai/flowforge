/**
 * Dispatcher contract suite (EP0-5 T0.5.5): bidirectional interoperability —
 * scenario 1 dispatches through an injected harness driver; scenario 2
 * degrades to a manual-execution brief with zero harness requirements.
 */

import { describe, expect, it } from 'vitest'
import {
  buildManualBrief,
  createDispatcher,
  NullDispatcher,
  SubagentDispatcher,
  type SubagentDriver,
} from '../src/dispatcher.ts'
import type { DispatchTask } from '../src/dispatcher.ts'

const task: DispatchTask = {
  instanceName: 'ep0',
  phase: 'implement',
  instruction: '执行任务 1：实现 src/example.ts 并配套 tests/example.spec.ts。',
  skillAssets: ['docs/process/skills/executing-plans.md', 'docs/process/skills/test-driven-development.md'],
}

describe('NullDispatcher — 场景 2（外部 AI 工具，无宿主）', () => {
  it('renders a manual brief instead of failing (流程必须处处可执行)', async () => {
    const dispatcher = new NullDispatcher()
    expect(dispatcher.mode).toBe('manual')
    const result = await dispatcher.dispatch(task)
    expect(result.status).toBe('manual-brief')
    expect(result.executor).toBeUndefined()
  })

  it('brief carries the instruction, skill assets, and the advance command', () => {
    const brief = buildManualBrief(task)
    expect(brief).toContain(task.instruction)
    for (const asset of task.skillAssets) expect(brief).toContain(asset)
    expect(brief).toContain('ff_dev advance')
    expect(brief).toContain('门禁未满足会拒绝')
  })
})

describe('SubagentDispatcher — 场景 1（flowforge 宿主注入驱动）', () => {
  it('dispatches through the injected driver and reports the executor', async () => {
    const driver: SubagentDriver = {
      dispatch: async dispatched => ({
        executor: 'trae/glm-5.3',
        output: `已执行：${dispatched.instruction}`,
      }),
    }
    const dispatcher = new SubagentDispatcher(driver)
    expect(dispatcher.mode).toBe('subagent')
    const result = await dispatcher.dispatch(task)
    expect(result.status).toBe('dispatched')
    expect(result.executor).toBe('trae/glm-5.3')
    expect(result.brief).toContain('已执行')
  })

  it('is stateless — swapping the driver between calls is harmless (换体无损)', async () => {
    const first: SubagentDriver = { dispatch: async () => ({ executor: 'claude', output: 'r1' }) }
    const second: SubagentDriver = { dispatch: async () => ({ executor: 'opencode', output: 'r2' }) }
    const one = await new SubagentDispatcher(first).dispatch(task)
    const two = await new SubagentDispatcher(second).dispatch(task)
    expect(one.executor).toBe('claude')
    expect(two.executor).toBe('opencode')
  })
})

describe('createDispatcher — 工厂降级', () => {
  it('degrades to the manual dispatcher when no driver is injected', () => {
    expect(createDispatcher().mode).toBe('manual')
    const driver: SubagentDriver = { dispatch: async () => ({ executor: 'x', output: 'y' }) }
    expect(createDispatcher(driver).mode).toBe('subagent')
  })
})
