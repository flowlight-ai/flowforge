/**
 * WorkflowCompilerService — T7.8 工作流编译器域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeWorkflowCompiler 挂载
 * - compile / compileFile / compileLegacy 委托
 * - snapshot 快照（三阶段 + 九种步骤类型）
 *
 * @module @flowforge/forgekin-workflow-compiler/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { WorkflowCompilerService } from '../src/index.js';

const WF = `
id: wf
name: w
steps:
  - id: s1
    type: agent
    agent: a
`;

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeWorkflowCompiler', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeWorkflowCompiler).toBeInstanceOf(WorkflowCompilerService);
  });

  it('compile 委托三阶段编译', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const { sopSteps, ir } = ctx.forgeWorkflowCompiler.compile(WF);
    expect(ir.id).toBe('wf');
    expect(sopSteps).toEqual([{ type: 'agent', agent: 'a', name: 'Step 0' }]);
  });

  it('compileLegacy 返回向后兼容对象', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const cw = ctx.forgeWorkflowCompiler.compileLegacy(WF);
    expect(cw.entryPoint).toBe('s1');
    expect(cw.nodes.s1).toMatchObject({ type: 'agent', agent: 'a' });
  });

  it('snapshot 返回三阶段与九种步骤类型', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const snap = ctx.forgeWorkflowCompiler.snapshot();
    expect(snap.stages).toEqual(['parser', 'validator', 'codegen']);
    expect(snap.stepTypes).toContain('conditional');
    expect(snap.stepTypes).toContain('loop');
  });
});
