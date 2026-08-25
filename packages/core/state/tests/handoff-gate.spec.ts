/**
 * handoff-gate — HandoffManager / FieldConditionGate / namespace / StateQueryTool 测试。
 *
 * 对齐 Python `core/handoff.py` / `core/field_condition_gate.py` /
 * `core/namespace.py` / `core/state_query_tool.py` 语义。
 *
 * @module @flowforge/core-state/tests
 */

import { describe, expect, it } from 'vitest';
import { HandoffManager, type AgentRegistryLike, type HandoffAgent } from '../src/handoff.js';
import { FieldConditionGate, evaluate, resolveField } from '../src/field-condition-gate.js';
import {
  getAllNamespaces,
  getNamespaceMap,
  registerNamespace,
  resolveAgentName,
  toNamespaceName,
} from '../src/namespace.js';
import { StateQueryTool, type QueryMemoryLike, type WebSearchLike } from '../src/state-query-tool.js';

describe('HandoffManager（core/handoff.py）', () => {
  const makeAgent = (name: string): HandoffAgent => ({
    async execute(input) {
      return { result: { handled_by: name, task: input.params['task'] } };
    },
  });

  const registry: AgentRegistryLike = {
    get: (name) =>
      name === 'editor' || name === 'reviewer' ? makeAgent(name) : undefined,
    list: () => ['editor', 'reviewer'],
  };

  it('registerHandoffs 注册并按 target 去重', () => {
    const manager = new HandoffManager(registry);
    manager.registerHandoffs('writer', [
      { target: 'editor', condition: '需要润色' },
    ]);
    manager.registerHandoffs('writer', [
      { target: 'editor', condition: '重复目标忽略' },
      { target: 'reviewer', condition: '需要审校' },
    ]);
    expect(manager.getHandoffs('writer')).toHaveLength(2);
    expect(manager.getHandoffs('writer').map((h) => h.target)).toEqual([
      'editor',
      'reviewer',
    ]);
  });

  it('executeHandoff 成功委派', async () => {
    const manager = new HandoffManager(registry);
    manager.registerHandoffs('writer', [
      { target: 'editor', condition: '需要润色' },
    ]);
    const output = await manager.executeHandoff('writer', 'editor', '润色第三章');
    expect(output.result['handled_by']).toBe('editor');
    expect(output.result['task']).toBe('润色第三章');
  });

  it('executeHandoff 未配置交接 → 抛错', async () => {
    const manager = new HandoffManager(registry);
    await expect(
      manager.executeHandoff('writer', 'editor', 'task'),
    ).rejects.toThrow('No handoff configured');
  });

  it('executeHandoff 目标不存在 → 抛错', async () => {
    const manager = new HandoffManager(registry);
    manager.registerHandoffs('writer', [
      { target: 'ghost', condition: '不存在' },
    ]);
    await expect(
      manager.executeHandoff('writer', 'ghost', 'task'),
    ).rejects.toThrow('not found in registry');
  });

  it('executeHandoff 目标抛异常 → 返回错误结果', async () => {
    const failingRegistry: AgentRegistryLike = {
      get: () => ({
        async execute() {
          throw new Error('boom');
        },
      }),
      list: () => ['editor'],
    };
    const manager = new HandoffManager(failingRegistry);
    manager.registerHandoffs('writer', [{ target: 'editor', condition: 'c' }]);
    const output = await manager.executeHandoff('writer', 'editor', 'task');
    expect(output.result['error']).toBe('boom');
    expect(output.result['handoff_from']).toBe('writer');
  });

  it('getHandoffPrompt 生成 LLM 提示词；无配置返回空串', () => {
    const manager = new HandoffManager(registry);
    expect(manager.getHandoffPrompt('writer')).toBe('');
    manager.registerHandoffs('writer', [
      { target: 'editor', condition: '需要润色', description: '负责文笔打磨' },
    ]);
    const prompt = manager.getHandoffPrompt('writer');
    expect(prompt).toContain('editor');
    expect(prompt).toContain('需要润色');
  });
});

describe('FieldConditionGate（core/field_condition_gate.py）', () => {
  const gateYaml = `
gates:
  concept_approved:
    type: field_condition
    next_status: concept_approved
    next_phase: outline
    checks:
      - field: concept_package.logline
        condition: not_empty
        message: 缺少一句话梗概
      - field: outline.outline_score
        condition: ">= 60"
        allow_missing: true
`;

  it('fromYaml 加载 + to_phase → next_phase 规范化', () => {
    const gate = FieldConditionGate.fromYaml(gateYaml);
    expect(gate.size).toBe(1);
    expect(gate.listGates()).toEqual(['concept_approved']);
  });

  it('check 通过 → passed + next_status/next_phase', () => {
    const gate = FieldConditionGate.fromYaml(gateYaml);
    const result = gate.check('concept_approved', {
      concept_package: { logline: '少年修仙' },
      outline: { outline_score: 75 },
    });
    expect(result.passed).toBe(true);
    expect(result.next_status).toBe('concept_approved');
    expect(result.next_phase).toBe('outline');
    expect(result.failures).toEqual([]);
  });

  it('check 失败 → failures 列表 + next_status null', () => {
    const gate = FieldConditionGate.fromYaml(gateYaml);
    const result = gate.check('concept_approved', {
      concept_package: { logline: '' },
      outline: { outline_score: 40 },
    });
    expect(result.passed).toBe(false);
    expect(result.next_status).toBeNull();
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]!.message).toBe('缺少一句话梗概');
  });

  it('未知门禁 → passed false + reason', () => {
    const gate = FieldConditionGate.fromYaml(gateYaml);
    const result = gate.check('nope', {});
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Unknown gate');
  });

  it('evaluate 各类条件', () => {
    expect(evaluate(null, 'not_empty', true)).toBe(true);
    expect(evaluate(undefined, 'not_empty')).toBe(false);
    expect(evaluate('abc', 'not_empty')).toBe(true);
    expect(evaluate(true, '== true')).toBe(true);
    expect(evaluate(false, '== true')).toBe(false);
    expect(evaluate([1, 2, 3], 'length >= 3')).toBe(true);
    expect(evaluate('hello', 'length == 5')).toBe(true);
    expect(evaluate(70, '>= 60')).toBe(true);
    expect(evaluate(50, '>= 60')).toBe(false);
    expect(evaluate('x', 'unknown_condition')).toBe(false);
  });

  it('resolveField 点分路径 + 数组索引', () => {
    const state = { a: { list: [{ v: 1 }, { v: 2 }] } };
    expect(resolveField(state, 'a.list[1].v')).toBe(2);
    expect(resolveField(state, 'missing')).toBeNull();
  });
});

describe('namespace（core/namespace.py）', () => {
  it('registerNamespace + getNamespaceMap / getAllNamespaces', () => {
    registerNamespace('devforge', { 'devforge:coder': 'coder' });
    expect(getNamespaceMap('devforge')).toEqual({ 'devforge:coder': 'coder' });
    expect(getAllNamespaces()['devforge']).toEqual({ 'devforge:coder': 'coder' });
  });

  it('resolveAgentName 带/不带命名空间', () => {
    expect(resolveAgentName('coder')).toBe('coder');
    expect(resolveAgentName('devforge:coder')).toBe('coder');
    expect(resolveAgentName('unknown:agent')).toBe('agent');
  });

  it('toNamespaceName 默认/指定项目前缀', () => {
    expect(toNamespaceName('coder')).toBe('flowforge:coder');
    expect(toNamespaceName('coder', 'devforge')).toBe('devforge:coder');
  });
});

describe('StateQueryTool（core/state_query_tool.py）', () => {
  const memory: QueryMemoryLike = {
    working: {
      get: () => ({
        '1': { characters: { 张三: '主角' }, foreshadowing: ['伏笔A'] },
        '2': { characters: { 李四: '配角' } },
      }),
    },
  };

  it('有状态 → doSearch 关键词命中', async () => {
    const tool = new StateQueryTool({
      name: 'novel_state_query',
      description: '查询小说状态',
      memory,
      stateKeyTemplate: 'novel:{entity_id}:world_state',
      stateMergeFields: ['characters'],
      stateListFields: ['foreshadowing'],
      stateScopeField: 'chapter_number',
    });
    const output = await tool.execute({
      query: '张三',
      novel_id: 'n1',
      chapter_number: 1,
    });
    expect(output.result['state_query']).toBe(true);
    expect(output.result['results']).toHaveLength(1);
  });

  it('scope 过滤超出章节的状态', async () => {
    const tool = new StateQueryTool({
      memory,
      stateKeyTemplate: 'novel:{entity_id}:world_state',
      stateMergeFields: ['characters'],
      stateScopeField: 'chapter_number',
    });
    const output = await tool.execute({ query: '李四', novel_id: 'n1', scope: 1 });
    expect(output.result['results']).toEqual([]);
  });

  it('无状态 → web_search 降级并标注 state_empty/hint', async () => {
    const webSearch: WebSearchLike = {
      async execute() {
        return { result: { results: [{ title: 'wiki', url: 'http://x' }] } };
      },
    };
    const tool = new StateQueryTool({
      memory: { working: { get: () => null } },
      webSearch,
      stateKeyTemplate: 'novel:{entity_id}:world_state',
    });
    const output = await tool.execute({ query: '修仙设定', novel_id: 'n9' });
    expect(output.result['source']).toBe('web_search_fallback');
  });

  it('无状态且无 web_search → source unavailable', async () => {
    const tool = new StateQueryTool({
      memory: { working: { get: () => null } },
      stateKeyTemplate: 'novel:{entity_id}:world_state',
    });
    const output = await tool.execute({ query: 'x', novel_id: 'n9' });
    expect(output.result['source']).toBe('unavailable');
  });

  it('query 缺失 → error', async () => {
    const tool = new StateQueryTool({});
    const output = await tool.execute({});
    expect(output.error).toBe('query is required');
  });
});
