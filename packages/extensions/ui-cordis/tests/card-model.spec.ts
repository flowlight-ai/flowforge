// Card view model: what a definition card can and cannot derive from the frozen
// call/result slice (pure-logic port of the dsh card-model.client.spec.ts).

import { describe, expect, it } from 'vitest'
import { cordisActionCard, cordisDefineCard, cordisRunCard } from '../src/card-model.ts'
import type {
  ToolCallViewModelBlockRunning,
  ToolCallViewModelBlockSettled,
} from '../src/block.ts'

const ARGS = '{"name":"clock","purpose":"顶栏时钟","code":{"client":"return {}","host":"harness.handle(\'now\', () => Date.now())"}}'

function running(over: Partial<ToolCallViewModelBlockRunning> = {}): ToolCallViewModelBlockRunning {
  return { argsRaw: ARGS, ...over }
}

function settled(over: Partial<ToolCallViewModelBlockSettled> = {}): ToolCallViewModelBlockSettled {
  return {
    kind: 'tool-result', seq: 2,
    call: { name: 'cordis_define', argsRaw: ARGS },
    content: [{ type: 'text', text: 'defined dyn-1' }], isError: false,
    meta: { pluginId: 'dyn-1', packageId: 'pkg-1' },
    ...over,
  }
}

describe('cordisDefineCard', () => {
  it('reads name, purpose and both code halves off the call arguments', () => {
    const card = cordisDefineCard(running())
    expect(card).toMatchObject({
      name: 'clock', purpose: '顶栏时钟', clientCode: 'return {}', state: 'running', output: null,
    })
    expect(card.hostCode).toContain('harness.handle')
    // The host mints the id during define, so an unsettled call has none and the
    // card renders read-only.
    expect(card.pluginId).toBeNull()
    expect(card.packageId).toBeNull()
  })

  it('takes the minted id from the result presentation meta', () => {
    expect(cordisDefineCard(settled()).pluginId).toBe('dyn-1')
    expect(cordisDefineCard(settled()).packageId).toBe('pkg-1')
    expect(cordisDefineCard(settled()).output).toBe('defined dyn-1')
    expect(cordisDefineCard(settled()).state).toBe('ok')
  })

  it('renders read-only when the meta carries no usable id', () => {
    expect(cordisDefineCard(settled({ meta: undefined })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: 'dyn-1' as unknown as object })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: '' } })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: 7 } })).pluginId).toBeNull()
  })

  it('classifies the define call’s own lifecycle and never operates a failed one', () => {
    const failed = cordisDefineCard(settled({
      isError: true, content: [{ type: 'text', text: 'SyntaxError: unexpected token\n  at line 3' }],
    }))
    expect(failed.state).toBe('error')
    expect(failed.errorSummary).toBe('SyntaxError: unexpected token')
    // A definition that failed to register has nothing to run.
    expect(failed.pluginId).toBeNull()

    expect(cordisDefineCard(settled({ isError: true, error: { name: 'E', code: 'interrupted' } })).state).toBe('stopped')
    expect(cordisDefineCard(settled({ content: [] })).output).toBeNull()
    expect(cordisDefineCard(settled({ content: [], error: { name: 'E', code: 'boom' } })).output).toBe('E: boom')
    // A non-text block has no display text of its own, so the row shows its JSON.
    expect(cordisDefineCard(settled({ content: [{ type: 'reasoning', text: 'weighing it' }] })).output)
      .toContain('"type": "reasoning"')
  })

  it('degrades on a truncated argument stream instead of dropping the row', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).name).toBe('{"name":"clo')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).purpose).toBeNull()
    expect(cordisDefineCard(running({ argsRaw: '"just a string"' })).name).toBe('"just a string"')
  })

  it('keeps the raw first line as the name when the arguments carry none', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"purpose":"顶栏时钟"}' })).name).toBe('{"purpose":"顶栏时钟"}')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"","purpose":"顶栏时钟"}' })).name).toBe('{"name":"","purpose":"顶栏时钟"}')
  })

  it('reports an unknown name when the event window cut the call head', () => {
    const card = cordisDefineCard(settled({ call: undefined }))
    expect(card.name).toBeNull()
    expect(card.purpose).toBeNull()
  })
})

describe('cordisRunCard', () => {
  it('carries the activation identity, mode and log sequence for a settled run', () => {
    const block = settled({
      call: { name: 'cordis_run', argsRaw: '{"pluginId":"dyn-1","packageId":"pkg-1","mode":"run"}' },
      meta: { pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1' },
      content: [{ type: 'text', text: 'started run-1' }],
    })
    expect(cordisRunCard(block)).toEqual({
      pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1', mode: 'run', seq: 2,
      output: 'started run-1', errorSummary: null, state: 'ok',
    })
  })

  it('falls back to the call arguments when the meta is absent', () => {
    const block = settled({
      call: { name: 'cordis_run', argsRaw: '{"pluginId":"dyn-1","packageId":"pkg-1","mode":"update"}' },
      meta: undefined,
    })
    const card = cordisRunCard(block)
    expect(card.pluginId).toBe('dyn-1')
    expect(card.packageId).toBe('pkg-1')
    expect(card.pluginRunId).toBeNull()
    expect(card.mode).toBe('update')
  })

  it('rejects an unknown run mode and reports a streaming run as running', () => {
    const runningBlock = running({ argsRaw: '{"pluginId":"dyn-1","packageId":"pkg-1","mode":"nonsense"}' })
    const card = cordisRunCard(runningBlock)
    expect(card.state).toBe('running')
    expect(card.mode).toBeNull()
    expect(card.output).toBeNull()
    expect(card.seq).toBeNull()
  })
})

describe('cordisActionCard', () => {
  it('keeps the Plugin identity and lifecycle result for Stop and Remove cards', () => {
    const card = cordisActionCard(settled({
      call: { name: 'cordis_stop', argsRaw: '{"pluginId":"clock-1"}' },
      content: [{ type: 'text', text: 'Stopped clock-1.' }],
      meta: undefined,
    }))

    expect(card).toEqual({
      pluginId: 'clock-1',
      output: 'Stopped clock-1.',
      errorSummary: null,
      state: 'ok',
    })
  })

  it('accepts the short `id` alias for the plugin identity', () => {
    const card = cordisActionCard(settled({
      call: { name: 'cordis_undefine', argsRaw: '{"id":"clock-1"}' },
      content: [{ type: 'text', text: 'Removed clock-1.' }],
      meta: undefined,
    }))
    expect(card.pluginId).toBe('clock-1')
  })
})