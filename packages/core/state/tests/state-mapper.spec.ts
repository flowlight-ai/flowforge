/**
 * state-mapper — StateMapper / VariableResolver / StateUpdateMapper 单元测试。
 *
 * 对齐 Python `core/state_mapper.py` / `core/variable_resolver.py` /
 * `core/state_updates.py` 语义。
 *
 * @module @flowforge/core-state/tests
 */

import { describe, expect, it } from 'vitest';
import { MISSING, StateMapper } from '../src/state-mapper.js';
import { createResolverFromState } from '../src/variable-resolver.js';
import { StateUpdateMapper } from '../src/state-updates.js';

describe('StateMapper（core/state_mapper.py）', () => {
  it('fromConfig 简单映射：state 字段 → 参数', () => {
    const mapper = StateMapper.fromConfig({ topic: 'state.topic_list[0]' });
    const params = mapper.apply({ topic_list: ['修仙', '科幻'] });
    expect(params['topic']).toBe('修仙');
  });

  it('嵌套路径 + 列表索引解析', () => {
    const mapper = new StateMapper([
      {
        paramName: 'name',
        source: 'state.outline.chapters[1].title',
        required: false,
        default: null,
      },
    ]);
    const state = {
      outline: { chapters: [{ title: '序章' }, { title: '第一章' }] },
    };
    const params = mapper.apply(state);
    expect(params['name']).toBe('第一章');
  });

  it('auto.persona / auto.soul 快捷路径', () => {
    const mapper = new StateMapper([
      { paramName: 'persona', source: 'auto.persona', required: false, default: null },
      { paramName: 'soul', source: 'auto.soul', required: false, default: null },
    ]);
    const state = {
      persona: '严谨型',
      style_profile: { soul: '冷峻风格' },
    };
    const params = mapper.apply(state);
    expect(params['persona']).toBe('严谨型');
    expect(params['soul']).toBe('冷峻风格');
  });

  it('input. 前缀从 extra 提取', () => {
    const mapper = new StateMapper([
      { paramName: 'task', source: 'input.task', required: true, default: null },
    ]);
    const params = mapper.apply({}, { task: '写一章' });
    expect(params['task']).toBe('写一章');
  });

  it('required 缺失 → 跳过；非 required 缺失 → 默认值', () => {
    const mapper = new StateMapper([
      { paramName: 'must', source: 'state.nope', required: true, default: null },
      { paramName: 'opt', source: 'state.nope', required: false, default: 'fallback' },
    ]);
    const params = mapper.apply({});
    expect(params['must']).toBeUndefined();
    expect(params['opt']).toBe('fallback');
  });

  it('transform 8 种操作', () => {
    expect(StateMapper.applyTransform('{"a":1}', 'json_parse')).toEqual({ a: 1 });
    expect(StateMapper.applyTransform(['x', 'y'], 'str_join')).toBe('x\ny');
    expect(StateMapper.applyTransform(['a', 'b'], 'first')).toBe('a');
    expect(StateMapper.applyTransform(['a', 'b'], 'last')).toBe('b');
    expect(StateMapper.applyTransform([1, 2, 3], 'len')).toBe(3);
    expect(StateMapper.applyTransform(42, 'str')).toBe('42');
    expect(StateMapper.applyTransform('AbC', 'lower')).toBe('abc');
    expect(StateMapper.applyTransform('AbC', 'upper')).toBe('ABC');
  });

  it('resolveSource 未知前缀兜底从 state 取；缺失返回 MISSING', () => {
    const mapper = new StateMapper([]);
    expect(mapper.resolveSource('anything', { anything: 1 }, {})).toBe(1);
    expect(mapper.resolveSource('missing.path', {}, {})).toBe(MISSING);
  });
});

describe('VariableResolver（core/variable_resolver.py）', () => {
  const resolver = createResolverFromState(
    { persona: '幽默', novel: { chapters: [{ title: '第一章' }] } },
    { input: 'hello' },
    { score: 85, list: ['a', 'b'] },
    { draft: '草稿' },
    { max_len: 500 },
  );

  it('规范格式 ${prefix.path} 解析', () => {
    expect(resolver.resolve('你的身份是${state.persona}')).toBe('你的身份是幽默');
    expect(resolver.resolve('${params.input}')).toBe('hello');
    expect(resolver.resolve('${result.score}')).toBe('85');
    expect(resolver.resolve('${outputs.draft}')).toBe('草稿');
    expect(resolver.resolve('${config.max_len}')).toBe('500');
  });

  it('嵌套路径 + 列表索引', () => {
    expect(resolver.resolve('${state.novel.chapters[0].title}')).toBe('第一章');
  });

  it('旧格式兼容：{{}} / $ / 单花括号', () => {
    expect(resolver.resolve('{{state.persona}}')).toBe('幽默');
    expect(resolver.resolve('$outputs.draft')).toBe('草稿');
    expect(resolver.resolve('{state.persona}')).toBe('幽默');
  });

  it('别名：auto → state，output → outputs', () => {
    expect(resolver.resolve('${auto.persona}')).toBe('幽默');
    expect(resolver.resolve('${output.draft}')).toBe('草稿');
  });

  it('未匹配引用保持原样', () => {
    expect(resolver.resolve('${state.unknown_key}')).toBe('${state.unknown_key}');
  });

  it('resolveValue 单引用保留原始类型', () => {
    expect(resolver.resolveValue('${result.score}')).toBe(85);
    expect(resolver.resolveValue('前缀${result.score}')).toBe('前缀85');
  });

  it('resolveExpression 比较表达式（与 Python 一致：${} 包裹时保持原样）', () => {
    // 对齐 Python core/variable_resolver.py：split 后左侧缺 } 无法解析 → 保持原样
    expect(resolver.resolveExpression('${result.score < 70}')).toBe(
      '${result.score < 70}',
    );
    expect(resolver.resolveExpression('${result.score >= 85}')).toBe(
      '${result.score >= 85}',
    );
    // 单变量引用正常解析
    expect(resolver.resolveExpression('${result.score}')).toBe(85);
  });
});

describe('StateUpdateMapper（core/state_updates.py）', () => {
  it('apply 简单键直接设置', () => {
    const state: Record<string, unknown> = { stage: 'coding' };
    StateUpdateMapper.apply(state, { stage: 'review' });
    expect(state['stage']).toBe('review');
  });

  it('apply 嵌套点分路径创建中间对象', () => {
    const state: Record<string, unknown> = { artifacts: {} };
    StateUpdateMapper.apply(state, { 'artifacts.code': 'main.py' });
    expect(state['artifacts']).toEqual({ code: 'main.py' });
  });

  it('setNested 覆盖已存在的标量中间值', () => {
    const state: Record<string, unknown> = { a: 1 };
    StateUpdateMapper.setNested(state, 'a.b.c', 'x');
    expect(state['a']).toEqual({ b: { c: 'x' } });
  });

  it('extractOutputs 新格式 state_updates', () => {
    const updates = StateUpdateMapper.extractOutputs({
      state_updates: { score: 90 },
      content: 'ignored',
    });
    expect(updates).toEqual({ score: 90 });
  });

  it('extractOutputs 旧格式 output + output_mapping', () => {
    const updates = StateUpdateMapper.extractOutputs({
      output: 'final text',
      output_mapping: { topic: 'output' },
    });
    expect(updates).toEqual({ output: 'final text', topic: 'final text' });
  });

  it('extractOutputs 无任何格式 → 空对象', () => {
    expect(StateUpdateMapper.extractOutputs({ content: 'x' })).toEqual({});
  });
});
