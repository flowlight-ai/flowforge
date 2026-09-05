/**
 * 批次51 telemetry 纯逻辑层测试：D1 字段分级脱敏、模型名归一化、
 * ToolSpanTracker 生命周期（span 端口注入）、指标属性允许清单。
 */

import { describe, expect, it } from 'vitest'
import {
  isClassA,
  isClassB,
  isClassC,
  redactRecord,
  redactValue,
} from '../src/redactor.ts'
import { normalizeModel } from '../src/model-normalizer.ts'
import {
  isMcpToolName,
  ToolSpanTracker,
  type SpanFactory,
  type TelemetrySpan,
} from '../src/tool-span-tracker.ts'
import { ALLOWED_METRIC_ATTRIBUTES, filterMetricAttributes } from '../src/metric-allowlist.ts'
import { AGENT_ID, THREAD_SYSTEM_KIND } from '../src/semconv.ts'

describe('redactor 字段分级', () => {
  it('Class A 凭据键识别（含 _token/_api_key 后缀）', () => {
    expect(isClassA('Authorization')).toBe(true)
    expect(isClassA('x-api-key')).toBe(true)
    expect(isClassA('GITHUB_TOKEN')).toBe(true)
    expect(isClassA('OPENAI_API_KEY')).toBe(true)
    expect(isClassA('callbackToken')).toBe(true)
    expect(isClassA('model')).toBe(false)
  })

  it('Class B 业务内容键识别；Class C 系统标识符识别', () => {
    expect(isClassB('prompt')).toBe(true)
    expect(isClassB('tool_result')).toBe(true)
    expect(isClassB('userId')).toBe(false)
    expect(isClassC('userId')).toBe(true)
    expect(isClassC('invocationId')).toBe(true)
    expect(isClassC('prompt')).toBe(false)
  })

  it('redactValue：A→[REDACTED]，B→hash+len，C→伪名化，D 透传', () => {
    expect(redactValue('password', 'hunter2')).toBe('[REDACTED]')
    const hashed = redactValue('prompt', 'hello world')
    expect(hashed).toMatch(/^\[hash:[0-9a-f]{16} len:11\]$/)
    const pseudo = redactValue('threadId', 'th-123') as string
    expect(pseudo).not.toBe('th-123')
    expect(pseudo).toHaveLength(32)
    expect(redactValue('model', 'claude-sonnet-4')).toBe('claude-sonnet-4')
  })

  it('redactRecord：attributes + 每个 event 的 attributes 均脱敏（F192 Phase D）', () => {
    const record = {
      attributes: { userId: 'user-1', prompt: 'secret prompt', model: 'gpt-4o' },
      events: [
        { attributes: { messageId: 'm-1', status: 'ok' } },
        { attributes: undefined },
      ],
    }
    redactRecord(record)
    expect(record.attributes.userId).not.toBe('user-1')
    expect(record.attributes.prompt).toMatch(/^\[hash:/)
    expect(record.attributes.model).toBe('gpt-4o')
    const ev = record.events?.[0]?.attributes as Record<string, unknown>
    expect(ev.messageId).not.toBe('m-1')
    expect(ev.status).toBe('ok')
  })
})

describe('model-normalizer', () => {
  it('按 provider+family 分桶，大小写不敏感', () => {
    expect(normalizeModel('claude-opus-4-7')).toBe('claude-opus')
    expect(normalizeModel('Claude-Sonnet-4.5')).toBe('claude-sonnet')
    expect(normalizeModel('gpt-4o-mini-2026')).toBe('gpt-4o')
    expect(normalizeModel('GPT-5.5')).toBe('gpt-5')
  })

  it('未知模型 → other（有界基数）', () => {
    expect(normalizeModel('Doubao-Seed2.0')).toBe('other')
    expect(normalizeModel('')).toBe('other')
  })
})

describe('isMcpToolName', () => {
  it('mcp__/mcp:/cat_cafe_/signal_ 前缀为 MCP 工具', () => {
    expect(isMcpToolName('mcp__github_create_issue')).toBe(true)
    expect(isMcpToolName('cat_cafe_search_evidence')).toBe(true)
    expect(isMcpToolName('signal_fetch')).toBe(true)
    expect(isMcpToolName('bash')).toBe(false)
    expect(isMcpToolName('read_file')).toBe(false)
  })
})

function makeSpan(id: string): TelemetrySpan & { attrs: Record<string, unknown>; ended: boolean } {
  const state = { attrs: {} as Record<string, unknown>, ended: false, status: undefined as unknown }
  const span: TelemetrySpan & { attrs: Record<string, unknown>; ended: boolean } = {
    attrs: state.attrs,
    get ended() { return state.ended },
    setAttribute(key, value) { state.attrs[key] = value },
    setStatus(status) { state.status = status },
    end() { state.ended = true },
    spanContext() { return { traceId: `trace-${id}`, spanId: `span-${id}` } },
  }
  // 简化：用可变对象直接暴露 ended
  Object.defineProperty(span, 'ended', { get: () => state.ended })
  return span
}

describe('ToolSpanTracker 生命周期', () => {
  function makeTracker(catId = 'cat-1'): { tracker: ToolSpanTracker; invocation: ReturnType<typeof makeSpan>; started: Array<{ name: string; attrs: Record<string, unknown> }> } {
    const invocation = makeSpan('inv')
    const started: Array<{ name: string; attrs: Record<string, unknown> }> = []
    const factory: SpanFactory = {
      startSpan(name, attrs) {
        started.push({ name, attrs })
        return makeSpan(String(started.length))
      },
    }
    const tracker = new ToolSpanTracker({ invocationSpan: invocation, catId, factory })
    return { tracker, invocation, started }
  }

  it('MCP 工具创建子 span（含 AGENT_ID/TOOL_NAME/input_keys/类别）；重复 start 幂等', () => {
    const { tracker, started } = makeTracker('cat-9')
    const first = tracker.start('cat_cafe_search_evidence', 'tu-1', { query: 'x', limit: 5 })
    expect(first).toBeDefined()
    expect(started).toHaveLength(1)
    expect(started[0]?.name).toBe('cat_cafe.tool_use cat_cafe_search_evidence')
    expect(started[0]?.attrs[AGENT_ID]).toBe('cat-9')
    expect(started[0]?.attrs['tool.name']).toBe('cat_cafe_search_evidence')
    expect(started[0]?.attrs['tool.input_keys']).toBe('query,limit')
    expect(started[0]?.attrs['tool.category']).toBe('memory')
    const dup = tracker.start('cat_cafe_search_evidence', 'tu-1')
    expect(dup).toBe(first)
    expect(started).toHaveLength(1)
  })

  it('基础工具旁路 span 创建，累加 invocation 的 tool.basic_call_count（KD-40 共享计数）', () => {
    const { tracker, invocation } = makeTracker()
    expect(tracker.start('bash', 'tu-b1')).toBeUndefined()
    expect(tracker.start('read_file', 'tu-b2')).toBeUndefined()
    expect(invocation.attrs['tool.basic_call_count']).toBe(2)
    expect(tracker.size()).toBe(0)
  })

  it('end：写入 result status 并关闭 span；未知 toolUseId no-op', () => {
    const { tracker } = makeTracker()
    const span = tracker.start('mcp__f', 'tu-2')
    tracker.end('tu-2', 'ok')
    expect((span as unknown as { attrs: Record<string, unknown> }).attrs['tool.result.status']).toBe('ok')
    expect((span as unknown as { ended: boolean }).ended).toBe(true)
    expect(tracker.size()).toBe(0)
    expect(() => tracker.end('unknown', 'error')).not.toThrow()
  })

  it('endAllOrphans（AC-J4）：全部关闭并标记 lifecycle；getContext 覆盖前 peek', () => {
    const { tracker } = makeTracker()
    const s1 = tracker.start('mcp__a', 'tu-a')
    const s2 = tracker.start('mcp__b', 'tu-b')
    expect(tracker.getContext('tu-a')).toEqual({ traceId: 'trace-1', spanId: 'span-1' })
    expect(tracker.getContext('nope')).toBeUndefined()
    tracker.endAllOrphans('aborted')
    expect((s1 as unknown as { attrs: Record<string, unknown> }).attrs['tool.lifecycle']).toBe('aborted')
    expect((s2 as unknown as { ended: boolean }).ended).toBe(true)
    expect(tracker.size()).toBe(0)
  })
})

describe('metric-allowlist', () => {
  it('允许清单包含有界属性、排除自由字符串标识符', () => {
    expect(ALLOWED_METRIC_ATTRIBUTES.has(AGENT_ID)).toBe(true)
    expect(ALLOWED_METRIC_ATTRIBUTES.has(THREAD_SYSTEM_KIND)).toBe(true)
    expect(ALLOWED_METRIC_ATTRIBUTES.has('userId')).toBe(false)
    expect(ALLOWED_METRIC_ATTRIBUTES.has('threadId')).toBe(false)
    expect(ALLOWED_METRIC_ATTRIBUTES.has('invocationId')).toBe(false)
  })

  it('filterMetricAttributes 静默丢弃非允许属性', () => {
    const filtered = filterMetricAttributes({
      'agent.id': 'cat',
      'gen_ai.request.model': 'claude-opus',
      threadId: 'th-1',
      prompt: 'leak',
    })
    expect(filtered).toEqual({ 'agent.id': 'cat', 'gen_ai.request.model': 'claude-opus' })
  })
})
