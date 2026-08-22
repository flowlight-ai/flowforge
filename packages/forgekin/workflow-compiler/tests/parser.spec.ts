/**
 * WorkflowParser — T7.8 工作流 YAML 解析器验证。
 *
 * 覆盖：
 * - SEQUENCE 顺序步骤 + 默认值（id/name/type/max_iterations）
 * - MVP2 condition 自动提升为 conditional
 * - MVP3 parallel/fallback/loop 递归子步骤解析
 * - 非法 type / 非 mapping / 非法 YAML → WorkflowCompileError(PARSE_ERROR)
 * - parseFile 存在/不存在
 *
 * @module @flowforge/forgekin-workflow-compiler/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowCompileError } from '../src/errors.js';
import { WorkflowParser } from '../src/parser.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffwc-parser-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const parser = new WorkflowParser();

describe('SEQUENCE 顺序解析', () => {
  it('解析三步 agent/tool/gate，保留字段与顺序', () => {
    const ir = parser.parse(`
id: wf-1
name: 示例流程
version: "2.0"
description: 演示
steps:
  - id: s1
    name: 写作
    type: agent
    agent: writer
    input_mapping: { topic: "输入主题" }
  - id: s2
    name: 校验
    type: tool
    tool: spell_check
    output_key: check_result
  - id: s3
    name: 门控
    type: gate
`);
    expect(ir.id).toBe('wf-1');
    expect(ir.name).toBe('示例流程');
    expect(ir.version).toBe('2.0');
    expect(ir.steps).toHaveLength(3);
    const [s1, s2, s3] = ir.steps;
    expect(s1?.type).toBe('agent');
    expect(s1?.agent).toBe('writer');
    expect(s1?.inputMapping).toEqual({ topic: '输入主题' });
    expect(s2?.type).toBe('tool');
    expect(s2?.tool).toBe('spell_check');
    expect(s2?.outputKey).toBe('check_result');
    expect(s3?.type).toBe('gate');
  });

  it('缺省字段回退：id=step_<i> / name=Step <i> / type=agent / max_iterations=1', () => {
    const ir = parser.parse(`
id: wf
name: w
steps:
  - {}
`);
    const step = ir.steps[0];
    expect(step?.id).toBe('step_0');
    expect(step?.name).toBe('Step 0');
    expect(step?.type).toBe('agent');
    expect(step?.maxIterations).toBe(1);
  });

  it('state_schema / execution_policy / checkpoint 透传', () => {
    const ir = parser.parse(`
id: wf
name: w
state_schema: { score: number }
execution_policy: { max_steps: 10 }
steps:
  - id: s1
`);
    expect(ir.stateSchema).toEqual({ score: 'number' });
    expect(ir.executionPolicy).toEqual({ max_steps: 10 });
  });
});

describe('MVP2 条件分支', () => {
  it('带 condition 且未指定 type → 自动提升为 conditional', () => {
    const ir = parser.parse(`
id: wf
name: w
steps:
  - id: check
    condition: "\${state.score >= 70}"
    on_true: pass
    on_false: retry
  - id: pass
  - id: retry
`);
    const check = ir.steps[0];
    expect(check?.type).toBe('conditional');
    expect(check?.condition).toBe('${state.score >= 70}');
    expect(check?.onTrue).toBe('pass');
    expect(check?.onFalse).toBe('retry');
  });
});

describe('MVP3 递归子步骤', () => {
  it('parallel 解析 parallel_steps', () => {
    const ir = parser.parse(`
id: wf
name: w
steps:
  - id: p
    type: parallel
    parallel_steps:
      - id: p1
        type: agent
        agent: a
      - id: p2
        type: tool
        tool: t
`);
    const p = ir.steps[0];
    expect(p?.type).toBe('parallel');
    expect(p?.parallelSteps).toHaveLength(2);
    expect(p?.parallelSteps[0]?.agent).toBe('a');
    expect(p?.parallelSteps[1]?.tool).toBe('t');
  });

  it('fallback 解析 primary / fallback', () => {
    const ir = parser.parse(`
id: wf
name: w
steps:
  - id: f
    type: fallback
    primary:
      - id: main
        type: agent
        agent: primary_agent
    fallback:
      - id: alt
        type: agent
        agent: fallback_agent
`);
    const f = ir.steps[0];
    expect(f?.primary[0]?.agent).toBe('primary_agent');
    expect(f?.fallback[0]?.agent).toBe('fallback_agent');
  });

  it('loop 解析 loop_steps + max_iterations + exit_condition', () => {
    const ir = parser.parse(`
id: wf
name: w
steps:
  - id: lp
    type: loop
    max_iterations: 3
    exit_condition: "\${state.done}"
    loop_steps:
      - id: body
        type: agent
        agent: worker
`);
    const lp = ir.steps[0];
    expect(lp?.type).toBe('loop');
    expect(lp?.maxIterations).toBe(3);
    expect(lp?.exitCondition).toBe('${state.done}');
    expect(lp?.loopSteps[0]?.agent).toBe('worker');
  });
});

describe('P-97 结构化错误', () => {
  it('非法 YAML → PARSE_ERROR', () => {
    try {
      parser.parse('steps: [unclosed');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowCompileError);
      expect((e as WorkflowCompileError).errorCode).toBe('PARSE_ERROR');
    }
  });

  it('顶层非 mapping（列表/标量）→ PARSE_ERROR', () => {
    expect(() => parser.parse('- a\n- b')).toThrow(/expected mapping, got list/);
    expect(() => parser.parse('42')).toThrow(/expected mapping/);
  });

  it('非法 step type → PARSE_ERROR（P-97 结构化）', () => {
    try {
      parser.parse(`
id: wf
name: w
steps:
  - id: s1
    type: rocket
`);
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowCompileError);
      const err = e as WorkflowCompileError;
      expect(err.errorCode).toBe('PARSE_ERROR');
      expect(err.errors[0]).toContain('invalid type');
    }
  });
});

describe('parseFile', () => {
  it('读取 YAML 文件成功', async () => {
    const file = path.join(root, 'wf.yaml');
    await fs.writeFile(file, 'id: f1\nname: 文件流程\nsteps:\n  - id: s1\n', 'utf-8');
    const ir = await parser.parseFile(file);
    expect(ir.id).toBe('f1');
    expect(ir.steps[0]?.id).toBe('s1');
  });

  it('文件不存在 → 抛 FileNotFound 风格错误', async () => {
    await expect(parser.parseFile(path.join(root, 'nope.yaml'))).rejects.toThrow(/not found/);
  });
});
