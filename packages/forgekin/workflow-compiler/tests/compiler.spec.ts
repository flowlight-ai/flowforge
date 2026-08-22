/**
 * WorkflowCompiler — T7.8 三阶段编译器主入口验证。
 *
 * 覆盖：
 * - compile：YAML → (sopSteps, ir) 成功路径
 * - 校验失败 → WorkflowCompileError(VALIDATION_ERROR) + toDict 结构化
 * - compileFile 文件不存在 → 抛错
 * - compileLegacy：CompiledWorkflow 向后兼容对象（nodes/edges/entry_point/adjacency）
 *
 * @module @flowforge/forgekin-workflow-compiler/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowCompiler } from '../src/compiler.js';
import { WorkflowCompileError } from '../src/errors.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffwc-compiler-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const compiler = new WorkflowCompiler();

const SIMPLE_WF = `
id: wf-demo
name: 演示流程
version: "1.0"
steps:
  - id: write
    name: 写作
    type: agent
    agent: writer
    output_key: draft
  - id: review
    name: 审查
    type: agent
    agent: reviewer
`;

const CONDITIONAL_WF = `
id: wf-cond
name: 条件流程
steps:
  - id: check
    name: 质量检查
    condition: "\${state.score >= 70}"
    on_true: publish
    on_false: rewrite
  - id: publish
    name: 发布
    type: agent
    agent: publisher
  - id: rewrite
    name: 重写
    type: agent
    agent: writer
`;

describe('compile 三阶段编译', () => {
  it('成功：返回 sopSteps + ir', () => {
    const { sopSteps, ir } = compiler.compile(SIMPLE_WF);
    expect(ir.id).toBe('wf-demo');
    expect(ir.steps).toHaveLength(2);
    expect(sopSteps).toEqual([
      { type: 'agent', agent: 'writer', name: '写作', output_key: 'draft' },
      { type: 'agent', agent: 'reviewer', name: '审查' },
    ]);
  });

  it('条件路由编译（sop_steps 逐条对比验收 4）', () => {
    const { sopSteps } = compiler.compile(CONDITIONAL_WF);
    expect(sopSteps[0]).toMatchObject({
      type: 'conditional',
      condition: '${state.score >= 70}',
      on_true: 'publish',
      on_false: 'rewrite',
    });
    expect(sopSteps[1]).toMatchObject({ type: 'agent', agent: 'publisher' });
    expect(sopSteps[2]).toMatchObject({ type: 'agent', agent: 'writer' });
  });

  it('验证失败 → VALIDATION_ERROR 结构化（errorCode/errors/toDict）', () => {
    try {
      compiler.compile('id: wf\nname: w\nsteps:\n  - id: s1\n    type: agent\n');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowCompileError);
      const err = e as WorkflowCompileError;
      expect(err.errorCode).toBe('VALIDATION_ERROR');
      expect(err.errors.some((m) => m.includes("agent type requires 'agent'"))).toBe(true);
      const dict = err.toDict();
      expect(dict.error).toBe('VALIDATION_ERROR');
      expect(Array.isArray(dict.details)).toBe(true);
    }
  });

  it('解析失败（非法 YAML）→ PARSE_ERROR', () => {
    try {
      compiler.compile('steps: [');
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as WorkflowCompileError).errorCode).toBe('PARSE_ERROR');
    }
  });
});

describe('compileFile', () => {
  it('文件编译成功', async () => {
    const file = path.join(root, 'wf.yaml');
    await fs.writeFile(file, SIMPLE_WF, 'utf-8');
    const { sopSteps } = await compiler.compileFile(file);
    expect(sopSteps).toHaveLength(2);
  });

  it('文件不存在 → 抛 not found', async () => {
    await expect(compiler.compileFile(path.join(root, 'nope.yaml'))).rejects.toThrow(/not found/);
  });
});

describe('compileLegacy 向后兼容', () => {
  it('CompiledWorkflow：nodes/edges/entry_point/adjacency/sop_steps', () => {
    const cw = compiler.compileLegacy(CONDITIONAL_WF);
    expect(cw.name).toBe('条件流程');
    expect(cw.entryPoint).toBe('check');
    expect(Object.keys(cw.nodes)).toEqual(['check', 'publish', 'rewrite']);
    expect(cw.nodes.check).toMatchObject({ type: 'conditional', condition: '${state.score >= 70}' });
    expect(cw.edges).toContainEqual({ from: 'check', to: 'publish', label: 'true' });
    expect(cw.edges).toContainEqual({ from: 'check', to: 'rewrite', label: 'false' });
    expect(cw.adjacency.check).toEqual(['publish', 'rewrite']);
    expect(cw.sopSteps).toHaveLength(3);
    expect(cw.stateConfig).toEqual({});
  });

  it('顺序流程生成 next 边', () => {
    const cw = compiler.compileLegacy(SIMPLE_WF);
    expect(cw.edges).toContainEqual({ from: 'write', to: 'review', label: 'next' });
    expect(cw.entryPoint).toBe('write');
  });
});
