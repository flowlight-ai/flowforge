/**
 * service — StateService 挂载（ctx.forgeState）+ ContextLayerManager +
 * ToolChainExecutor ReAct 循环测试。
 *
 * 对齐 Python `core/context_layer_manager.py` / `core/tool_chain_executor.py` 语义。
 *
 * @module @flowforge/core-state/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  StateService,
  type StateServiceOptions,
} from '../src/index.js';
import {
  ContextLayer,
  ContextLayerManager,
  type ContextMemoryLike,
  type TaskContextLike,
} from '../src/context-layer-manager.js';
import {
  ToolChainExecutor,
  type EventBusLike,
  type LlmClientLike,
  type ToolRegistryLike,
} from '../src/tool-chain-executor.js';

function mount(options: StateServiceOptions = {}): Context {
  const ctx = new Context();
  Plugin(ctx, options);
  return ctx;
}

describe('StateService 挂载（ctx.forgeState）', () => {
  it('Plugin(ctx) 同步挂载 ctx.forgeState', () => {
    const ctx = mount();
    expect(ctx.forgeState).toBeInstanceOf(StateService);
  });

  it('子模块实例可用：handoff / stateUpdates / fieldConditionGate', () => {
    const ctx = mount({ gates: { g1: { checks: [] } } });
    expect(ctx.forgeState.handoff).toBeDefined();
    expect(ctx.forgeState.stateUpdates).toBeDefined();
    expect(ctx.forgeState.fieldConditionGate.size).toBe(1);
    // 未注入 memory → contextLayerManager 未创建
    expect(ctx.forgeState.contextLayerManager).toBeUndefined();
  });

  it('注入 memory → contextLayerManager 创建', () => {
    const ctx = mount({
      memory: { working: { get: () => null, save: async () => {} } },
    });
    expect(ctx.forgeState.contextLayerManager).toBeInstanceOf(ContextLayerManager);
  });

  it('createStateMapper 支持 Record 与数组两种配置', () => {
    const ctx = mount();
    const m1 = ctx.forgeState.createStateMapper({ topic: 'state.topic' });
    expect(m1.apply({ topic: '修仙' })['topic']).toBe('修仙');
    const m2 = ctx.forgeState.createStateMapper([
      { paramName: 't', source: 'state.topic', required: false, default: null },
    ]);
    expect(m2.apply({ topic: '科幻' })['t']).toBe('科幻');
  });

  it('createVariableResolver 工厂', () => {
    const ctx = mount();
    const resolver = ctx.forgeState.createVariableResolver({
      state: { persona: '严谨' },
    });
    expect(resolver.resolve('${state.persona}')).toBe('严谨');
  });

  it('createToolChainExecutor 缺依赖 → 抛错', () => {
    const ctx = mount();
    expect(() => ctx.forgeState.createToolChainExecutor()).toThrow(
      'llmClient 与 toolRegistry',
    );
  });

  it('createToolChainExecutor 注入依赖后可用', () => {
    const ctx = mount({
      llmClient: { execute: async () => ({ result: {} }) },
      toolRegistry: { list_tools: () => [], get_tool: () => ({ name: 'x' }), execute: async () => ({}) },
    });
    const executor = ctx.forgeState.createToolChainExecutor({ maxIterations: 1 });
    expect(executor).toBeInstanceOf(ToolChainExecutor);
  });

  it('static gateFromYaml', () => {
    const gate = StateService.gateFromYaml(
      'gates:\n  g1:\n    checks:\n      - field: a.b\n        condition: not_empty\n',
    );
    expect(gate.size).toBe(1);
  });
});

describe('ContextLayerManager（core/context_layer_manager.py）', () => {
  function makeMemory(seed: Record<string, unknown>): ContextMemoryLike & {
    data: Map<string, unknown>;
  } {
    const data = new Map(Object.entries(seed));
    return {
      data,
      working: {
        get: (key) => data.get(key),
        save: async (key, value) => {
          data.set(key, value);
        },
      },
      semantic: {
        search: async () => [{ text: '语义命中' }],
      },
    };
  }

  it('determineLayer 按阈值分层', () => {
    const memory = makeMemory({});
    const manager = new ContextLayerManager(memory);
    expect(manager.determineLayer(1, 1)).toBe(ContextLayer.L1);
    expect(manager.determineLayer(5, 5)).toBe(ContextLayer.L2);
    expect(manager.determineLayer(20, 20)).toBe(ContextLayer.L3);
    expect(manager.determineLayer(100, 100)).toBe(ContextLayer.L4);
  });

  it('collectChapters L1 全文 / 其他摘要 + 截断', async () => {
    const memory = makeMemory({});
    const manager = new ContextLayerManager(memory);
    const chapters = [
      { chapter_number: 1, content: '第一章内容', summary: '第一章摘要' },
      { chapter_number: 2, content: 'x'.repeat(600), summary: '' },
      { chapter_number: 3, content: '当前章', summary: '' },
    ];
    const l1 = await manager.collectChapters(chapters, 3, ContextLayer.L1);
    expect(l1).toHaveLength(2);
    expect(l1[0]!['content']).toBe('第一章内容');
    const l2 = await manager.collectChapters(chapters, 3, ContextLayer.L2);
    expect(l2[0]!['summary']).toBe('第一章摘要');
    expect(String(l2[1]!['summary'])).toContain('[摘要截断]');
  });

  it('buildContext 写入 context_layer/previous_chapters/world_state/soul', async () => {
    const memory = makeMemory({
      'novel:n1:chapters': [
        { chapter_number: 1, content: '第一章', summary: '摘要一' },
      ],
      'novel:n1:meta': {
        summary: '全书摘要',
        style_profile: JSON.stringify({ soul: '冷峻' }),
        concept_package: JSON.stringify({ logline: '少年修仙' }),
      },
      'novel:n1:world_state': {
        '2': { characters: { 张三: '主角' } },
      },
    });
    const manager = new ContextLayerManager(memory);
    const context: TaskContextLike = {
      state: { novel_id: 'n1', current_chapter: 2 },
      input_data: { task: '写第二章' },
    };
    await manager.buildContext(context);
    expect(context.state['context_layer']).toBe(ContextLayer.L1);
    expect(context.state['previous_chapters']).toHaveLength(1);
    expect(context.state['world_state']).toEqual({
      characters: { 张三: '主角' },
      timeline: {},
      geography: {},
      power_system: {},
      foreshadowing: [],
    });
    expect(context.state['full_book_summary']).toBe('全书摘要');
    expect(context.state['soul']).toEqual({
      style_profile: { soul: '冷峻' },
      concept_package: { logline: '少年修仙' },
    });
    expect(context.state['semantic_results']).toEqual([{ text: '语义命中' }]);
  });

  it('writeChapterContext 两阶段：章节摘要 + 世界状态 + 卷/全书摘要', async () => {
    const memory = makeMemory({
      'novel:n1:chapters': [
        { chapter_number: 1, content: '第一章内容', summary: '摘要一' },
        { chapter_number: 2, content: '第二章内容'.repeat(50), summary: '' },
      ],
      'novel:n1:meta': { state_json: JSON.stringify({ volume_summaries: {} }) },
    });
    const llmClient = {
      execute: async () => ({
        result: { content: '{"characters":{"张三":"主角"}}' },
      }),
    };
    const manager = new ContextLayerManager(memory, llmClient, {
      volume_size: 2,
      full_summary_interval: 1,
    });
    await manager.writeChapterContext('n1', 2, '第二章内容'.repeat(50));
    const chapters = memory.data.get('novel:n1:chapters') as Array<Record<string, unknown>>;
    const ch2 = chapters.find((c) => c['chapter_number'] === 2);
    expect(ch2).toBeDefined();
    expect(String(ch2!['summary'])).toContain('characters');
    const ws = memory.data.get('novel:n1:world_state') as Record<string, unknown>;
    expect((ws['2'] as Record<string, unknown>)['characters']).toEqual({ 张三: '主角' });
  });

  it('generateSummary 短内容直接返回；LLM 失败回退截断', async () => {
    const memory = makeMemory({});
    const manager = new ContextLayerManager(memory, {
      execute: async () => {
        throw new Error('llm down');
      },
    });
    expect(await manager.generateSummary('短内容', 100)).toBe('短内容');
    const long = 'x'.repeat(1000);
    const fallback = await manager.generateSummary(long, 50);
    expect(fallback.length).toBeLessThan(1000);
    expect(fallback).toContain('[摘要截断]');
  });
});

describe('ToolChainExecutor（core/tool_chain_executor.py）', () => {
  const makeLlm = (
    responses: Array<Record<string, unknown> | Error>,
  ): LlmClientLike & { calls: number } => {
    let idx = 0;
    return {
      calls: 0,
      async execute() {
        const response = responses[Math.min(idx, responses.length - 1)]!;
        idx += 1;
        this.calls = idx;
        if (response instanceof Error) {
          return { error: response.message };
        }
        return { result: response };
      },
    };
  };

  const registry: ToolRegistryLike = {
    list_tools: () => ['search', 'llm'],
    get_tool: (name) =>
      name === 'search'
        ? { name: 'search', description: '搜索工具', parameters_schema: { type: 'object' } }
        : { name, description: '', parameters_schema: null },
    async execute(_name, input) {
      return { result: { echoed: input.params } };
    },
  };

  it('一轮无 tool_calls → 直接返回最终答案', async () => {
    const llm = makeLlm([{ content: '最终回答', model: 'm1', provider: 'p1', tokens: 10 }]);
    const executor = new ToolChainExecutor(llm, registry);
    const result = await executor.execute({
      taskId: 't1',
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(result.content).toBe('最终回答');
    expect(result.iterations).toBe(1);
    expect(result.total_tokens).toBe(10);
    expect(result.model).toBe('m1');
    expect(result.provider).toBe('p1');
    expect(result.execution_trace).toEqual([]);
  });

  it('ReAct 循环：tool_call 执行 → 结果回填 → 最终答案', async () => {
    const llm = makeLlm([
      {
        content: '',
        tool_calls: [
          { id: 'c1', function: { name: 'search', arguments: '{"q":"修仙"}' } },
        ],
        tokens: 5,
      },
      { content: '查询完成', tokens: 3 },
    ]);
    const executor = new ToolChainExecutor(llm, registry);
    const result = await executor.execute({
      taskId: 't1',
      messages: [{ role: 'user', content: '查一下' }],
      tools: ['search'],
    });
    expect(result.iterations).toBe(2);
    expect(result.execution_trace).toHaveLength(1);
    expect(result.execution_trace[0]!.tool).toBe('search');
    expect(result.execution_trace[0]!.result['success']).toBe(true);
    expect(result.total_tokens).toBe(8);
  });

  it('循环检测：同工具连续 3 次 → skipped 且不再执行', async () => {
    const llm = makeLlm([
      {
        content: '',
        tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{}' } }],
      },
      {
        content: '',
        tool_calls: [{ id: 'c2', function: { name: 'search', arguments: '{}' } }],
      },
      {
        content: '',
        tool_calls: [{ id: 'c3', function: { name: 'search', arguments: '{}' } }],
      },
      { content: '好了', tokens: 1 },
    ]);
    const executor = new ToolChainExecutor(llm, registry, undefined, 4);
    const result = await executor.execute({
      taskId: 't1',
      messages: [{ role: 'user', content: 'x' }],
    });
    const skipped = result.execution_trace.filter(
      (t) => t.result['skipped'] === true,
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.result['reason']).toBe('loop_detected');
  });

  it('LLM 失败 → error 返回 + iterations 记录', async () => {
    const llm = makeLlm([new Error('network down')]);
    const executor = new ToolChainExecutor(llm, registry);
    const result = await executor.execute({
      taskId: 't1',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.error).toBe('network down');
    expect(result.content).toContain('LLM call failed');
    expect(result.iterations).toBe(1);
  });

  it('达到 max_iterations 仍无答案 → 兜底内容', async () => {
    const llm = makeLlm([
      { content: '', tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{}' } }] },
      { content: '', tool_calls: [{ id: 'c2', function: { name: 'search', arguments: '{}' } }] },
      { content: '', tool_calls: [{ id: 'c3', function: { name: 'search', arguments: '{}' } }] },
      { content: '', tool_calls: [{ id: 'c4', function: { name: 'search', arguments: '{}' } }] },
    ]);
    const executor = new ToolChainExecutor(llm, registry, undefined, 3);
    const result = await executor.execute({
      taskId: 't1',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.iterations).toBe(3);
    expect(result.content).toContain('Max iterations reached');
  });

  it('buildToolSchemas：跳过 llm、描述截断、最多 10 个', () => {
    const executor = new ToolChainExecutor(
      { execute: async () => ({ result: {} }) },
      {
        list_tools: () => Array.from({ length: 15 }, (_, i) => `t${i}`),
        get_tool: (name) => ({ name, description: 'd'.repeat(300) }),
        execute: async () => ({ result: {} }),
      },
    );
    const schemas = executor.buildToolSchemas();
    expect(schemas).toHaveLength(10);
    const func0 = schemas[0]!['function'] as Record<string, unknown>;
    expect(String(func0['description']).length).toBe(200);
  });

  it('事件总线收到 iteration/complete 事件', async () => {
    const llm = makeLlm([{ content: 'done', tokens: 1 }]);
    const events: Array<[string, string]> = [];
    const bus: EventBusLike = {
      emit: (taskId, eventType) => {
        events.push([taskId, eventType]);
      },
    };
    const executor = new ToolChainExecutor(llm, registry, bus);
    await executor.execute({ taskId: 't1', messages: [{ role: 'user', content: 'x' }] });
    expect(events).toContainEqual(['t1', 'tool_chain.iteration']);
    expect(events).toContainEqual(['t1', 'tool_chain.complete']);
  });

  it('parseToolCalls 解析 arguments JSON', () => {
    const executor = new ToolChainExecutor(
      { execute: async () => ({ result: {} }) },
      registry,
    );
    const parsed = executor.parseToolCalls({
      tool_calls: [
        { id: 'c1', function: { name: 'search', arguments: '{"q":"a"}' } },
        { id: 'c2', function: { name: 'bad', arguments: 'not-json' } },
      ],
    });
    expect(parsed[0]).toEqual({ name: 'search', arguments: { q: 'a' }, id: 'c1' });
    expect(parsed[1]!.arguments).toEqual({});
  });
});
