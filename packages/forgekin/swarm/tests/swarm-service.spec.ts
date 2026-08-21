/**
 * SwarmService — T7.15 Swarm 域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeSwarm 挂载 / 门面方法 / 调度循环 startLoop-stopLoop / snapshot。
 *
 * @module @flowforge/forgekin-swarm/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { SwarmService } from '../src/index.js';
import { SwarmTaskStatus, makeSwarmTask } from '../src/models.js';

const testOptions = {
  archiveFn: () => {},
  sleepFn: async () => {},
} as const;

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeSwarm', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { ...testOptions });
    expect(ctx.forgeSwarm).toBeInstanceOf(SwarmService);
    expect(ctx.forgeSwarm.snapshot()).toEqual({
      agents: 0,
      tasks: 0,
      byStatus: {},
      running: false,
    });
  });

  it('options.config agents 自动注册', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      ...testOptions,
      config: {
        agents: { wenxin: { capabilities: ['doc_generation'], vendor: 'trae' } },
      },
    });
    expect(ctx.forgeSwarm.listAgents().map((a) => a.agentId)).toEqual(['forgemind:wenxin']);
  });
});

describe('门面方法', () => {
  async function makeService() {
    const ctx = new Context();
    await ctx.plugin(Plugin, { ...testOptions });
    return ctx.forgeSwarm;
  }

  it('registerAgent + submitTask + dispatch 全链路', async () => {
    const svc = await makeService();
    svc.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = makeSwarmTask({
      title: '实现功能',
      description: 'desc',
      requiredCapabilities: ['code_generation'],
    });
    const taskId = svc.submitTask(task);
    expect(svc.getTaskStatus(taskId)).toBe(SwarmTaskStatus.PENDING);

    expect(await svc.dispatch()).toEqual([taskId]);
    expect(svc.getTaskStatus(taskId)).toBe(SwarmTaskStatus.ASSIGNED);
    expect(svc.getTask(taskId)!.assignedAgentId).toBe('forgemind:sherlock');
    expect(svc.getAgentWorkload()).toEqual({ 'forgemind:sherlock': 1 });
    expect(svc.listTasks(SwarmTaskStatus.ASSIGNED)).toHaveLength(1);
  });

  it('heartbeat 推进 RUNNING → COMPLETED', async () => {
    const svc = await makeService();
    svc.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = makeSwarmTask({
      title: 't',
      description: 'd',
      requiredCapabilities: ['code_generation'],
    });
    svc.submitTask(task);
    await svc.dispatch();

    await svc.heartbeat('forgemind:sherlock', task.taskId, 0.4);
    expect(svc.getTaskStatus(task.taskId)).toBe(SwarmTaskStatus.RUNNING);
    await svc.heartbeat('forgemind:sherlock', task.taskId, 1.0);
    expect(svc.getTaskStatus(task.taskId)).toBe(SwarmTaskStatus.COMPLETED);
  });

  it('cancelTask / failTask 门面', async () => {
    const svc = await makeService();
    const task = makeSwarmTask({
      title: 't',
      description: 'd',
      requiredCapabilities: ['x'],
    });
    svc.submitTask(task);
    expect(svc.cancelTask(task.taskId, 'abort')).toBe(true);
    expect(svc.getTaskStatus(task.taskId)).toBe(SwarmTaskStatus.CANCELLED);

    const task2 = makeSwarmTask({
      title: 't2',
      description: 'd2',
      requiredCapabilities: ['x'],
    });
    svc.submitTask(task2);
    expect(svc.failTask(task2.taskId, 'bad output')).toBe(true);
    expect(svc.getTaskStatus(task2.taskId)).toBe(SwarmTaskStatus.FAILED);
  });
});

describe('调度循环 startLoop / stopLoop', () => {
  it('startLoop 分发任务；stopLoop 软停止；幂等', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      archiveFn: () => {},
      config: { dispatch_interval_seconds: 0.001 },
      sleepFn: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1))),
    });
    const svc = ctx.forgeSwarm;
    svc.registerAgent('a:x', ['code_generation'], 'trae');
    const task = makeSwarmTask({
      title: 't',
      description: 'd',
      requiredCapabilities: ['code_generation'],
    });
    svc.submitTask(task);

    const p1 = svc.startLoop();
    const p2 = svc.startLoop();
    expect(p2).toBe(p1); // 幂等
    await new Promise((r) => setTimeout(r, 10));
    expect(task.status).toBe(SwarmTaskStatus.ASSIGNED);
    expect(svc.snapshot().running).toBe(true);

    await svc.stopLoop();
    expect(svc.snapshot().running).toBe(false);
    expect(svc.snapshot().byStatus[SwarmTaskStatus.ASSIGNED]).toBe(1);
  });
});
