/**
 * SwarmCoordinator — 协同调度核心语义验证（对齐 forgemind/swarm.py）。
 *
 * 覆盖：registerAgent / submitTask(I2) / dispatch(I3+I5+I6) / heartbeat(I4) /
 * checkTimeouts(I4 回收) / 能力互补 / 查询 / cancel/fail / runContinuously / 单例。
 * 注入 archiveFn（免落盘）+ nowFn（控制超时判定）。
 *
 * @module @flowforge/forgekin-swarm/tests
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SwarmCoordinator,
  createSwarmCoordinator,
  defaultArchiveFn,
  resetSwarmCoordinatorSingleton,
} from '../src/coordinator.js';
import { SwarmDispatchRecord, SwarmTaskStatus, makeSwarmTask } from '../src/models.js';

const BASE_TIME = Date.parse('2026-08-20T00:00:00Z');

let nowMs: number;
let records: SwarmDispatchRecord[];

function nowFn(): string {
  return new Date(nowMs).toISOString();
}

function mkCoordinator(config: Record<string, unknown> = {}): SwarmCoordinator {
  return new SwarmCoordinator({
    config,
    archiveFn: (rec) => records.push(rec),
    nowFn,
    sleepFn: async () => {},
  });
}

function simpleTask(overrides: Record<string, unknown> = {}) {
  return makeSwarmTask({
    title: 't',
    description: 'd',
    requiredCapabilities: ['code_generation'],
    ...overrides,
  });
}

beforeEach(() => {
  nowMs = BASE_TIME;
  records = [];
});

describe('registerAgent', () => {
  it('空 agentId 抛错', () => {
    const coord = mkCoordinator();
    expect(() => coord.registerAgent('', ['x'])).toThrow('agent_id 不能为空');
  });

  it('覆盖式注册（热更新能力画像）+ 初始化 idle 心跳', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    coord.registerAgent('forgemind:wenxin', ['doc_review'], 'claude');
    expect(coord.agents.get('forgemind:wenxin')!.capabilities).toEqual(['doc_review']);
    expect(coord.agents.get('forgemind:wenxin')!.vendor).toBe('claude');
    const hb = coord.heartbeats.get('forgemind:wenxin')!;
    expect(hb.status).toBe('idle');
    expect(hb.taskId).toBeNull();
  });

  it('config agents 自动注册：短名补 forgemind: 前缀，含冒号保留', () => {
    const coord = mkCoordinator({
      agents: {
        wenxin: { capabilities: ['doc_generation'], vendor: 'trae' },
        'other:vangogh': { capabilities: ['code_review'], vendor: 'claude' },
      },
    });
    expect(coord.agents.has('forgemind:wenxin')).toBe(true);
    expect(coord.agents.has('other:vangogh')).toBe(true);
    expect(coord.agents.size).toBe(2);
  });
});

describe('submitTask（I2 提交必有 trace）', () => {
  it('title/description/required_capabilities 校验', () => {
    const coord = mkCoordinator();
    expect(() => coord.submitTask(simpleTask({ title: '' }))).toThrow('不能为空');
    expect(() => coord.submitTask(simpleTask({ description: '' }))).toThrow('不能为空');
    expect(() => coord.submitTask(simpleTask({ requiredCapabilities: [] }))).toThrow('不能为空');
  });

  it('提交写入 tasks + 落盘 submit 记录', () => {
    const coord = mkCoordinator();
    const task = simpleTask();
    const taskId = coord.submitTask(task);
    expect(taskId).toBe(task.taskId);
    expect(coord.tasks.get(taskId)).toBe(task);
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe('submit');
    expect(records[0]!.agentId).toBe('');
    expect(records[0]!.taskId).toBe(taskId);
  });

  it('archive 失败不阻断 submit（I2 弱保证）', () => {
    const coord = new SwarmCoordinator({
      archiveFn: () => {
        throw new Error('disk full');
      },
      nowFn,
    });
    const taskId = coord.submitTask(simpleTask());
    expect(coord.tasks.has(taskId)).toBe(true);
  });
});

describe('dispatch（I3 capability-based routing）', () => {
  it('无待分发任务返回空列表', async () => {
    const coord = mkCoordinator();
    expect(await coord.dispatch()).toEqual([]);
  });

  it('能力匹配路由：ASSIGNED + assignedAt + 清空 heartbeatAt/startedAt + dispatch trace', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask();
    coord.submitTask(task);

    const dispatched = await coord.dispatch();
    expect(dispatched).toEqual([task.taskId]);
    expect(task.status).toBe(SwarmTaskStatus.ASSIGNED);
    expect(task.assignedAgentId).toBe('forgemind:sherlock');
    expect(task.assignedAt).toBe(nowFn());
    expect(task.heartbeatAt).toBeNull();
    expect(task.startedAt).toBeNull();
    const rec = records.find((r) => r.action === 'dispatch')!;
    expect(rec.agentId).toBe('forgemind:sherlock');
    expect(rec.reassignedFrom).toBeNull();
  });

  it('priority 倒序：critical 先于 low 分发', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:one', ['code_generation'], 'trae');
    const lowTask = simpleTask({ priority: 'low' });
    const criticalTask = simpleTask({ priority: 'critical' });
    coord.submitTask(lowTask);
    coord.submitTask(criticalTask);

    const dispatched = await coord.dispatch();
    expect(dispatched).toEqual([criticalTask.taskId, lowTask.taskId]);
  });

  it('无匹配 agent：保持 PENDING + complement_agents 推荐写入 context', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    // 需要两种能力，无单一 agent 覆盖
    const task = simpleTask({ requiredCapabilities: ['doc_generation', 'code_generation'] });
    coord.submitTask(task);

    const dispatched = await coord.dispatch();
    expect(dispatched).toEqual([]);
    expect(task.status).toBe(SwarmTaskStatus.PENDING);
    const complement = task.context['complement_agents'] as Record<string, string>;
    // primary 覆盖度并列时取先注册者 wenxin，缺口 code_generation 由 sherlock 补齐
    expect(complement['code_generation']).toBe('forgemind:sherlock');
  });

  it('完全无人覆盖任何能力：无 complement 推荐', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    const task = simpleTask({ requiredCapabilities: ['teleportation'] });
    coord.submitTask(task);

    await coord.dispatch();
    expect(task.status).toBe(SwarmTaskStatus.PENDING);
    expect(task.context['complement_agents']).toBeUndefined();
  });

  it('REASSIGNED → ASSIGNED 保留 retryCount + trace 带 reassigned_from', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask({
      status: SwarmTaskStatus.REASSIGNED,
      retryCount: 2,
      assignedAgentId: 'old:agent',
    });
    coord.submitTask(task);

    await coord.dispatch();
    expect(task.status).toBe(SwarmTaskStatus.ASSIGNED);
    expect(task.retryCount).toBe(2);
    const rec = records.find((r) => r.action === 'dispatch')!;
    expect(rec.reassignedFrom).toBe('old:agent');
  });
});

describe('heartbeat（I4 心跳监控）', () => {
  it('空 agentId 抛错', async () => {
    const coord = mkCoordinator();
    await expect(coord.heartbeat('')).rejects.toThrow('agent_id 不能为空');
  });

  it('未注册 agent 自动注册（vendor=unknown）', async () => {
    const coord = mkCoordinator();
    await coord.heartbeat('ghost:agent');
    expect(coord.agents.get('ghost:agent')!.vendor).toBe('unknown');
    expect(coord.agents.get('ghost:agent')!.capabilities).toEqual([]);
  });

  it('progress 截断到 [0,1]', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:x', ['c'], 'trae');
    await coord.heartbeat('a:x', null, 2.5);
    expect(coord.heartbeats.get('a:x')!.progress).toBe(1.0);
    await coord.heartbeat('a:x', null, -3);
    expect(coord.heartbeats.get('a:x')!.progress).toBe(0.0);
  });

  it('ASSIGNED → RUNNING（startedAt）+ heartbeatAt 更新', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask();
    coord.submitTask(task);
    await coord.dispatch();

    nowMs = BASE_TIME + 5_000;
    await coord.heartbeat('forgemind:sherlock', task.taskId, 0.5);
    expect(task.status).toBe(SwarmTaskStatus.RUNNING);
    expect(task.startedAt).toBe(nowFn());
    expect(task.heartbeatAt).toBe(nowFn());
    expect(task.completedAt).toBeNull();
  });

  it('progress>=1.0 → COMPLETED + result 兜底 + complete trace', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask();
    coord.submitTask(task);
    await coord.dispatch();
    await coord.heartbeat('forgemind:sherlock', task.taskId, 0.5);

    await coord.heartbeat('forgemind:sherlock', task.taskId, 1.0);
    expect(task.status).toBe(SwarmTaskStatus.COMPLETED);
    expect(task.completedAt).toBe(nowFn());
    expect(task.result).toEqual({ progress: 1.0 });
    const rec = records.find((r) => r.action === 'complete')!;
    expect(rec.agentId).toBe('forgemind:sherlock');
  });

  it('已有 result 不被兜底覆盖', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask({ result: { output: 'ok' } });
    coord.submitTask(task);
    await coord.dispatch();
    await coord.heartbeat('forgemind:sherlock', task.taskId, 1.0);
    expect(task.result).toEqual({ output: 'ok' });
  });
});

describe('checkTimeouts（I4 心跳超时回收）', () => {
  async function dispatchedTask(coord: SwarmCoordinator) {
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask();
    coord.submitTask(task);
    await coord.dispatch();
    return task;
  }

  it('未超时不动作', async () => {
    const coord = mkCoordinator();
    const task = await dispatchedTask(coord);
    nowMs = BASE_TIME + 10_000; // 10s < 30s
    expect(await coord.checkTimeouts()).toEqual([]);
    expect(task.status).toBe(SwarmTaskStatus.ASSIGNED);
  });

  it('从未心跳 + assigned_at 超时 → REASSIGNED + retryCount+1 + 清空分配字段', async () => {
    const coord = mkCoordinator();
    const task = await dispatchedTask(coord);
    nowMs = BASE_TIME + 31_000; // 31s > 30s
    const reassigned = await coord.checkTimeouts();
    expect(reassigned).toEqual([task.taskId]);
    expect(task.status).toBe(SwarmTaskStatus.REASSIGNED);
    expect(task.retryCount).toBe(1);
    expect(task.assignedAgentId).toBeNull();
    expect(task.heartbeatAt).toBeNull();
    const rec = records.find((r) => r.action === 'reassign')!;
    expect(rec.reassignedFrom).toBe('forgemind:sherlock');
    expect(rec.reason).toContain('no_heartbeat_since_assigned');
  });

  it('有心跳则以 heartbeat_at 判定', async () => {
    const coord = mkCoordinator();
    const task = await dispatchedTask(coord);
    nowMs = BASE_TIME + 20_000;
    await coord.heartbeat('forgemind:sherlock', task.taskId, 0.3);
    // 距 assigned 40s 但距心跳仅 20s → 不超时
    nowMs = BASE_TIME + 40_000;
    expect(await coord.checkTimeouts()).toEqual([]);
    // 距心跳 31s → 超时
    nowMs = BASE_TIME + 51_000;
    expect(await coord.checkTimeouts()).toEqual([task.taskId]);
  });

  it('超过 max_retries → FAILED + max_retries_exceeded', async () => {
    const coord = mkCoordinator();
    const task = await dispatchedTask(coord);
    task.retryCount = 3; // 已达 max
    nowMs = BASE_TIME + 31_000;
    const reassigned = await coord.checkTimeouts();
    expect(reassigned).toEqual([]);
    expect(task.status).toBe(SwarmTaskStatus.FAILED);
    expect(task.retryCount).toBe(4);
    expect(task.failureReason).toContain('max_retries_exceeded');
    expect(task.assignedAgentId).toBeNull();
    const rec = records.find((r) => r.action === 'fail')!;
    expect(rec.reason).toContain('max_retries_exceeded');
  });

  it('config heartbeat_timeout_seconds 覆盖默认值', async () => {
    const coord = mkCoordinator({ heartbeat_timeout_seconds: 200 });
    const task = await dispatchedTask(coord);
    nowMs = BASE_TIME + 100_000; // 100s < 200s
    expect(await coord.checkTimeouts()).toEqual([]);
    nowMs = BASE_TIME + 201_000;
    expect(await coord.checkTimeouts()).toEqual([task.taskId]);
  });

  it('PENDING / 终态任务不参与超时判定', async () => {
    const coord = mkCoordinator();
    const pending = simpleTask();
    coord.submitTask(pending);
    const completed = simpleTask({
      status: SwarmTaskStatus.COMPLETED,
      assignedAgentId: 'a:x',
      assignedAt: new Date(BASE_TIME).toISOString(),
    });
    coord.submitTask(completed);
    nowMs = BASE_TIME + 999_000;
    expect(await coord.checkTimeouts()).toEqual([]);
  });
});

describe('findCapableAgent（I3+I5+I6 4 步过滤）', () => {
  it('无 agent 或无需求能力返回 null', () => {
    const coord = mkCoordinator();
    expect(coord.findCapableAgent(simpleTask())).toBeNull();
    coord.registerAgent('a:x', ['c'], 'trae');
    expect(coord.findCapableAgent(simpleTask({ requiredCapabilities: [] }))).toBeNull();
  });

  it('Step1 能力包含过滤', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    expect(coord.findCapableAgent(simpleTask())).toBeNull();
    expect(
      coord.findCapableAgent(simpleTask({ requiredCapabilities: ['doc_generation'] })),
    ).toBe('forgemind:wenxin');
  });

  it('Step2 I5 跨厂商：code_review 路由到非 author 厂商', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:vangogh', ['code_review'], 'claude');
    coord.registerAgent('forgemind:sherlock', ['code_review'], 'trae');
    const task = simpleTask({
      requiredCapabilities: ['code_review'],
      context: { author_agent_id: 'forgemind:other', author_vendor: 'trae' },
    });
    expect(coord.findCapableAgent(task)).toBe('forgemind:vangogh');
  });

  it('Step2 I5 跨厂商过滤后无候选返回 null', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_review'], 'trae');
    const task = simpleTask({
      requiredCapabilities: ['code_review'],
      context: { author_vendor: 'trae' },
    });
    expect(coord.findCapableAgent(task)).toBeNull();
  });

  it('Step3 I6 no-self-review：排除 author 自身；无其他候选返回 null', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:sherlock', ['code_review'], 'trae');
    coord.registerAgent('forgemind:vangogh', ['code_review'], 'claude');
    const task = simpleTask({
      requiredCapabilities: ['code_review'],
      context: { author_agent_id: 'forgemind:sherlock' },
    });
    expect(coord.findCapableAgent(task)).toBe('forgemind:vangogh');

    const soloTask = simpleTask({
      requiredCapabilities: ['code_review'],
      context: { author_agent_id: 'forgemind:vangogh', author_vendor: 'claude' },
    });
    // vangogh 被 I6 排除，sherlock 被 I5 排除（同 author_vendor=claude？sherlock 是 trae，保留）
    expect(coord.findCapableAgent(soloTask)).toBe('forgemind:sherlock');
  });

  it('preferred_agent_id 在候选集中优先', () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:one', ['code_generation'], 'trae');
    coord.registerAgent('a:two', ['code_generation'], 'trae');
    const task = simpleTask({ preferredAgentId: 'a:two' });
    expect(coord.findCapableAgent(task)).toBe('a:two');
  });

  it('Step4 load balancing：workload 最小优先，同 workload 字典序', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('b:zeta', ['code_generation'], 'trae');
    coord.registerAgent('b:alpha', ['code_generation'], 'trae');
    // 同 workload=0 → 字典序 alpha
    expect(coord.findCapableAgent(simpleTask())).toBe('b:alpha');

    // 给 alpha 派一单 → zeta workload 更小
    const first = simpleTask();
    coord.submitTask(first);
    await coord.dispatch();
    expect(first.assignedAgentId).toBe('b:alpha');
    expect(coord.findCapableAgent(simpleTask())).toBe('b:zeta');
  });
});

describe('findComplementAgent / tryFindComplements（能力互补）', () => {
  it('排除自身 + 无能力者返回 null', () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:x', ['code_generation'], 'trae');
    expect(coord.findComplementAgent('a:x', 'code_generation')).toBeNull();
    expect(coord.findComplementAgent('a:x', '')).toBeNull();
    coord.registerAgent('a:y', ['code_generation'], 'trae');
    expect(coord.findComplementAgent('a:x', 'code_generation')).toBe('a:y');
  });

  it('I5 跨厂商过滤：missing 在 cross_vendor_required 中', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    coord.registerAgent('forgemind:trae-reviewer', ['code_review'], 'trae');
    coord.registerAgent('forgemind:vangogh', ['code_review'], 'claude');
    // wenxin(trae) 找 code_review 搭档 → 必须跨厂商 → vangogh
    expect(coord.findComplementAgent('forgemind:wenxin', 'code_review')).toBe('forgemind:vangogh');
    // 无跨厂商候选 → null
    const onlyTrae = mkCoordinator();
    onlyTrae.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    onlyTrae.registerAgent('forgemind:trae-reviewer', ['code_review'], 'trae');
    expect(onlyTrae.findComplementAgent('forgemind:wenxin', 'code_review')).toBeNull();
  });

  it('tryFindComplements：覆盖最多者为 primary + 缺口找搭档', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation', 'doc_review'], 'trae');
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask({
      requiredCapabilities: ['doc_generation', 'code_generation'],
    });
    const complements = coord.tryFindComplements(task);
    // wenxin 覆盖 2 项中的 1 项与 sherlock 并列，取先注册者 wenxin 为 primary
    expect(complements).toEqual({ code_generation: 'forgemind:sherlock' });
  });

  it('tryFindComplements：preferred_agent_id 优先为 primary', () => {
    const coord = mkCoordinator();
    coord.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    coord.registerAgent('forgemind:sherlock', ['code_generation'], 'trae');
    const task = simpleTask({
      requiredCapabilities: ['doc_generation', 'code_generation'],
      preferredAgentId: 'forgemind:sherlock',
    });
    expect(coord.tryFindComplements(task)).toEqual({ doc_generation: 'forgemind:wenxin' });
  });

  it('tryFindComplements：无 agent / 无需求返回空', () => {
    const coord = mkCoordinator();
    expect(coord.tryFindComplements(simpleTask())).toEqual({});
  });
});

describe('状态查询', () => {
  it('getTaskStatus / getTask 不存在返回 null', () => {
    const coord = mkCoordinator();
    expect(coord.getTaskStatus('nope')).toBeNull();
    expect(coord.getTask('nope')).toBeNull();
  });

  it('getAgentWorkload 仅统计 ASSIGNED+RUNNING，所有注册 agent 初始 0', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:x', ['code_generation'], 'trae');
    coord.registerAgent('a:y', ['doc_generation'], 'trae');
    expect(coord.getAgentWorkload()).toEqual({ 'a:x': 0, 'a:y': 0 });

    const task = simpleTask();
    coord.submitTask(task);
    await coord.dispatch();
    expect(coord.getAgentWorkload()).toEqual({ 'a:x': 1, 'a:y': 0 });

    // COMPLETED 不计数
    task.status = SwarmTaskStatus.COMPLETED;
    expect(coord.getAgentWorkload()).toEqual({ 'a:x': 0, 'a:y': 0 });
  });

  it('listTasks 状态过滤 + createdAt 升序', () => {
    const coord = mkCoordinator();
    const older = simpleTask({ createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = simpleTask({
      createdAt: '2026-08-10T00:00:00.000Z',
      status: SwarmTaskStatus.COMPLETED,
    });
    coord.submitTask(newer);
    coord.submitTask(older);
    expect(coord.listTasks().map((t) => t.taskId)).toEqual([older.taskId, newer.taskId]);
    expect(coord.listTasks(SwarmTaskStatus.PENDING).map((t) => t.taskId)).toEqual([older.taskId]);
  });

  it('listAgents 返回画像摘要', async () => {
    const coord = mkCoordinator();
    coord.registerAgent('a:x', ['code_generation'], 'trae');
    const task = simpleTask();
    coord.submitTask(task);
    await coord.dispatch();
    const agents = coord.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.agentId).toBe('a:x');
    expect(agents[0]!.capabilities).toEqual(['code_generation']);
    expect(agents[0]!.vendor).toBe('trae');
    expect(agents[0]!.workload).toBe(1);
    expect(agents[0]!.lastStatus).toBe('idle');
    expect(agents[0]!.lastHeartbeat).not.toBeNull();
  });
});

describe('cancelTask / failTask', () => {
  it('不存在或终态返回 false', () => {
    const coord = mkCoordinator();
    expect(coord.cancelTask('nope')).toBe(false);
    expect(coord.failTask('nope')).toBe(false);
    const done = simpleTask({ status: SwarmTaskStatus.COMPLETED });
    coord.submitTask(done);
    expect(coord.cancelTask(done.taskId)).toBe(false);
    expect(coord.failTask(done.taskId)).toBe(false);
  });

  it('cancel：CANCELLED + 默认原因 cancelled_by_operator + trace', () => {
    const coord = mkCoordinator();
    const task = simpleTask({ assignedAgentId: 'a:x' });
    coord.submitTask(task);
    expect(coord.cancelTask(task.taskId)).toBe(true);
    expect(task.status).toBe(SwarmTaskStatus.CANCELLED);
    expect(task.assignedAgentId).toBeNull();
    expect(task.failureReason).toBe('cancelled_by_operator');
    const rec = records.find((r) => r.action === 'cancel')!;
    expect(rec.agentId).toBe('a:x');
    // 自定义原因
    const task2 = simpleTask();
    coord.submitTask(task2);
    coord.cancelTask(task2.taskId, 'user steer');
    expect(task2.failureReason).toBe('user steer');
  });

  it('fail：FAILED + 默认原因 task_failed + trace', () => {
    const coord = mkCoordinator();
    const task = simpleTask();
    coord.submitTask(task);
    expect(coord.failTask(task.taskId)).toBe(true);
    expect(task.status).toBe(SwarmTaskStatus.FAILED);
    expect(task.failureReason).toBe('task_failed');
    expect(records.some((r) => r.action === 'fail')).toBe(true);
  });
});

describe('runContinuously 调度循环', () => {
  it('软停止 + config dispatch_interval_seconds 生效', async () => {
    const sleeps: number[] = [];
    const coord = new SwarmCoordinator({
      config: { dispatch_interval_seconds: 2 },
      archiveFn: (rec) => records.push(rec),
      nowFn,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 3) {
          coord.stop();
        }
      },
    });
    await coord.runContinuously();
    expect(sleeps).toEqual([2000, 2000, 2000]);
    expect(coord.running).toBe(false);
  });

  it('显式 interval 覆盖 config 默认', async () => {
    const sleeps: number[] = [];
    const coord = new SwarmCoordinator({
      config: { dispatch_interval_seconds: 2 },
      archiveFn: (rec) => records.push(rec),
      nowFn,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        coord.stop();
      },
    });
    await coord.runContinuously(0.5);
    expect(sleeps).toEqual([500]);
  });

  it('循环内异常不退出（健壮性）', async () => {
    let rounds = 0;
    const coord = new SwarmCoordinator({
      archiveFn: (rec) => records.push(rec),
      nowFn,
      sleepFn: async () => {
        rounds += 1;
        if (rounds >= 3) {
          coord.stop();
        }
      },
    });
    coord.registerAgent('a:x', ['code_generation'], 'trae');
    let calls = 0;
    const original = coord.dispatch.bind(coord);
    coord.dispatch = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('boom');
      }
      return original();
    };
    const task = simpleTask();
    coord.submitTask(task);
    await coord.runContinuously(0.01);
    // 第 1 轮异常后继续，后续轮成功分发
    expect(rounds).toBe(3);
    expect(task.status).toBe(SwarmTaskStatus.ASSIGNED);
  });
});

describe('defaultArchiveFn（JSONL append）', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'swarm-archive-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('snake_case JSON 行追加 + 自动建目录', async () => {
    const path = join(tmp, 'nested', 'trace.jsonl');
    const archive = defaultArchiveFn(path);
    archive({
      recordId: 'swarm-rec-1',
      taskId: 'swarm-t1',
      agentId: 'a:x',
      action: 'dispatch',
      dispatchedAt: '2026-08-20T00:00:00.000Z',
      reassignedFrom: null,
      reason: 'capabilities_match',
    });
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['record_id']).toBe('swarm-rec-1');
    expect(parsed['task_id']).toBe('swarm-t1');
    expect(parsed['reassigned_from']).toBeNull();
  });
});

describe('单例工厂（I1 单一调度器）', () => {
  afterEach(() => {
    resetSwarmCoordinatorSingleton();
  });

  it('多次调用返回同一实例；forceNew 创建新实例', async () => {
    const a = await createSwarmCoordinator({ archiveFn: () => {}, nowFn });
    const b = await createSwarmCoordinator({ archiveFn: () => {}, nowFn });
    expect(b).toBe(a);
    const c = await createSwarmCoordinator({ archiveFn: () => {}, nowFn }, true);
    expect(c).not.toBe(a);
  });

  it('reset 后重建为新实例', async () => {
    const a = await createSwarmCoordinator({ archiveFn: () => {}, nowFn });
    resetSwarmCoordinatorSingleton();
    const b = await createSwarmCoordinator({ archiveFn: () => {}, nowFn });
    expect(b).not.toBe(a);
  });
});
