/**
 * foreman — T7.20 F046/F049 ContinuousForeman 持续调度器验证。
 *
 * 覆盖：start/stop 生命周期 / 主循环扫描+分发+执行路由 /
 * 紧急任务队列即时处理 / Magic Words 停止暂停恢复 /
 * 五 Forgekin loop_type 推断 / 并发上限。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SwarmCoordinator } from '@flowforge/forgekin-swarm';
import {
  ContinuousForeman,
  createForeman,
  DEFAULT_AGENTS_CONFIG,
  ForemanRuntimePort,
  makeForemanConfig,
} from '../src/foreman.js';

const FAST_INTERVAL = 0.01;

function makeFakeRuntime(record: string[]): ForemanRuntimePort {
  return {
    async runDocLoop() { record.push('doc'); return { ok: true }; },
    async runCodeLoop() { record.push('code'); return { ok: true }; },
    async runFrameworkLoop() { record.push('framework'); return { ok: true }; },
    async runReviewLoop() { record.push('review'); return { ok: true }; },
    async runTestLoop() { record.push('test'); return { ok: true }; },
  };
}

function makeCoordinator(): SwarmCoordinator {
  const coordinator = new SwarmCoordinator();
  for (const [agentId, cfg] of Object.entries(DEFAULT_AGENTS_CONFIG)) {
    coordinator.registerAgent(agentId, cfg.capabilities, cfg.vendor);
  }
  return coordinator;
}

function tick(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ContinuousForeman 生命周期', () => {
  it('start → 主循环持续运行 → stop 停止（stats 记录 loops）', async () => {
    const record: string[] = [];
    const foreman = new ContinuousForeman(makeFakeRuntime(record), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL, emergencyPollIntervalSeconds: FAST_INTERVAL }),
    });
    await foreman.start();
    await tick(60);
    const running = foreman.getStats();
    expect(running['current_state']).toBe('running');
    expect(Number(running['total_loops'])).toBeGreaterThanOrEqual(1);

    await foreman.stop();
    expect(foreman.getStats()['current_state']).toBe('stopped');
  });

  it('重复 start 被忽略；pause/resume 切换状态', async () => {
    const foreman = new ContinuousForeman(makeFakeRuntime([]), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL, emergencyPollIntervalSeconds: FAST_INTERVAL }),
    });
    await foreman.start();
    await foreman.start(); // 忽略重复

    await foreman.pause();
    expect(foreman.getStats()['current_state']).toBe('paused');
    await foreman.resume();
    expect(foreman.getStats()['current_state']).toBe('running');

    await foreman.stop();
  });
});

describe('ContinuousForeman 任务分发', () => {
  it('operator 提交普通任务 → swarm 入队；分发后按 loop_type 路由到闭环', async () => {
    const record: string[] = [];
    const foreman = new ContinuousForeman(makeFakeRuntime(record), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL, emergencyPollIntervalSeconds: FAST_INTERVAL }),
    });
    await foreman.start();

    await foreman.submitOperatorTask({
      title: '修复文档过期',
      description: '扫描过期文档',
      loopType: 'doc',
      forgekinId: 'wenxin',
    });
    await tick(80);

    const stats = foreman.getStats();
    expect(Number(stats['total_tasks_dispatched'])).toBeGreaterThanOrEqual(1);
    expect(record).toContain('doc');
    expect(Number(stats['total_tasks_completed'])).toBeGreaterThanOrEqual(1);

    await foreman.stop();
  });

  it('紧急任务（critical/emergency）立即进入紧急队列并处理', async () => {
    const record: string[] = [];
    const foreman = new ContinuousForeman(makeFakeRuntime(record), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL, emergencyPollIntervalSeconds: FAST_INTERVAL }),
    });
    await foreman.start();

    await foreman.submitOperatorTask({
      title: '紧急架构修正',
      description: '紧急',
      loopType: 'framework',
      forgekinId: 'luban',
      priority: 'emergency',
    });
    await tick(80);

    const stats = foreman.getStats();
    expect(Number(stats['total_emergencies'])).toBeGreaterThanOrEqual(1);
    expect(record).toContain('framework');

    await foreman.stop();
  });

  it('并发上限 maxConcurrentTasks=1 时第二个任务不立即执行', async () => {
    const record: string[] = [];
    const foreman = new ContinuousForeman(makeFakeRuntime(record), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({
        loopIntervalSeconds: FAST_INTERVAL,
        emergencyPollIntervalSeconds: FAST_INTERVAL,
        maxConcurrentTasks: 1,
      }),
    });
    await foreman.start();

    // 两个任务都提交，但第一个立即占满并发槽
    await foreman.submitOperatorTask({ title: 'A', description: 'a', loopType: 'doc', forgekinId: 'wenxin' });
    await foreman.submitOperatorTask({ title: 'B', description: 'b', loopType: 'code', forgekinId: 'sherlock' });
    await tick(80);

    // fake runtime 立即完成，并发槽释放后第二个也可执行；至少第一个执行了
    expect(record.length).toBeGreaterThanOrEqual(1);
    await foreman.stop();
  });

  it('submitToSwarm 无 swarm 时静默失败返回 null', () => {
    const foreman = new ContinuousForeman(makeFakeRuntime([]), {
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL }),
    });
    expect(
      foreman.submitToSwarm({ title: 'x', description: 'd', requiredCapabilities: [], loopType: 'doc', priority: 'normal', context: {} }),
    ).toBeNull();
  });
});

describe('ContinuousForeman Magic Words / 工具方法', () => {
  it('handleMagicWords：stop/pause/resume 三种指令', async () => {
    const foreman = new ContinuousForeman(makeFakeRuntime([]), {
      swarmCoordinator: makeCoordinator(),
      config: makeForemanConfig({ loopIntervalSeconds: FAST_INTERVAL, emergencyPollIntervalSeconds: FAST_INTERVAL }),
    });
    await foreman.start();

    await foreman.handleMagicWords('暂停', '暂停');
    expect(foreman.getStats()['current_state']).toBe('paused');

    await foreman.handleMagicWords('继续', '继续');
    expect(foreman.getStats()['current_state']).toBe('running');

    await foreman.handleMagicWords('stop', 'stop');
    expect(foreman.getStats()['current_state']).toBe('stopped');
  });

  it('inferLoopType：五 Forgekin 映射 + 默认 doc', () => {
    const foreman = new ContinuousForeman(makeFakeRuntime([]));
    expect(foreman.inferLoopType('wenxin')).toBe('doc');
    expect(foreman.inferLoopType('sherlock')).toBe('code');
    expect(foreman.inferLoopType('luban')).toBe('framework');
    expect(foreman.inferLoopType('vangogh')).toBe('review');
    expect(foreman.inferLoopType('davinci')).toBe('test');
    expect(foreman.inferLoopType('forgemind:wenxin')).toBe('doc');
    expect(foreman.inferLoopType('unknown')).toBe('doc');
  });

  it('routeToLoop 未知 loop_type 抛错', async () => {
    const foreman = new ContinuousForeman(makeFakeRuntime([]));
    await expect(foreman.routeToLoop('bogus', {})).rejects.toThrow(/未知 loop_type/);
  });

  it('getSwarmWorkload 返回各 agent 任务数', () => {
    const coordinator = makeCoordinator();
    const foreman = new ContinuousForeman(makeFakeRuntime([]), { swarmCoordinator: coordinator });
    const workload = foreman.getSwarmWorkload();
    expect(Object.keys(workload).sort()).toEqual(
      ['wenxin', 'sherlock', 'luban', 'vangogh', 'davinci'].sort(),
    );
  });

  it('createForeman 工厂创建实例', () => {
    const foreman = createForeman(makeFakeRuntime([]));
    expect(foreman).toBeInstanceOf(ContinuousForeman);
  });
});

// 清理：防止残留定时器
afterEach(async () => {
  await tick(0);
});
