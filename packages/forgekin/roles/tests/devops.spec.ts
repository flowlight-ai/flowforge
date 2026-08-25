/**
 * @flowforge/forgekin-roles — T7.28 DevOpsForgekin 契约验证（F042）。
 *
 * 对齐 F042 §2.2/§2.3 + 验收标准 AC-2/AC-3/AC-4/AC-5/AC-6/AC-7：
 *   - observe 采集 4 类信号（AC-2）
 *   - act 5 种动作路由（AC-3）
 *   - 金丝雀发布（AC-4）
 *   - 部署 / 自愈先写 WAL，失败可回滚（AC-5）
 *   - Tier 0 禁止自愈（AC-6）
 *   - 重大变更 operator 批准（AC-7）
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import type { RoleActionResult } from '../src/types.js';
import { DevOpsForgekin, TIER_0 } from '../src/devops.js';

/** 从动作结果提取动作特有字段（result 值域为 unknown，测试断言用）。 */
function pick(res: RoleActionResult, key: string): any {
  return res.result[key];
}

function makeDevOps(): DevOpsForgekin {
  return new DevOpsForgekin({
    forgekinId: 'forgemind:hummingbird',
    name: '闪电',
    businessSystems: ['k8s', 'prometheus'],
  });
}

function act(d: DevOpsForgekin, actionType: string, params: Record<string, unknown> = {}) {
  return d.act({ action_type: actionType, params });
}

describe('DevOpsForgekin（F042 蜂鸟·闪电）', () => {
  it('observe 采集服务健康 / 指标 / 事故 / 容量 4 类信号（AC-2）', async () => {
    const d = makeDevOps();
    const obs = await d.observe({
      ops_signals: {
        service_health: { api: 'up' },
        metrics: { cpu: 0.7 },
        incidents: ['inc-1'],
        capacity: { replicas: 3 },
      },
    });
    expect(obs.service_health).toEqual({ api: 'up' });
    expect(obs.metrics).toEqual({ cpu: 0.7 });
    expect(obs.incidents).toEqual(['inc-1']);
    expect(obs.capacity).toEqual({ replicas: 3 });
    expect(obs.systems_queried).toEqual(['k8s', 'prometheus']);
  });

  it('act 路由：deploy 先写 WAL 再执行（I2 / AC-5），金丝雀放量（I4 / AC-4）', async () => {
    const d = makeDevOps();
    const full = await act(d, 'deploy', { target: 'api-v2' });
    expect(full.executed).toBe(true);
    expect(pick(full, 'wal_entry')).toBeDefined(); // I2 部署前先写 WAL
    expect(pick(full, 'deployment').strategy).toBe('full');

    const canary = await act(d, 'deploy', { target: 'api-v2', canary_percent: 10 });
    expect(canary.executed).toBe(true);
    expect(pick(canary, 'deployment').strategy).toBe('canary');
    expect(pick(canary, 'deployment').canary_percent).toBe(10);
  });

  it('I1：重大变更（deploy / scale / degrade + major_change）降级待批（AC-7）', async () => {
    const d = makeDevOps();
    for (const actionType of ['deploy', 'scale', 'degrade']) {
      const res = await act(d, actionType, { major_change: true });
      expect(res.executed).toBe(false);
      expect(res.decisionRecord).toBe('pending_operator_review');
      expect(pick(res, 'reason')).toBe('major_change_requires_operator_approval');
    }
    // 非重大变更不触发审批
    const minor = await act(d, 'deploy', { target: 'api-v2' });
    expect(minor.executed).toBe(true);
  });

  it('I3：Tier 0 物理副作用禁止自愈 → rejected，必须 operator 介入（AC-6）', async () => {
    const d = makeDevOps();
    const res = await act(d, 'auto_heal', { tier: TIER_0, incident: 'disk-fail' });
    expect(res.executed).toBe(false);
    expect(res.decisionRecord).toBe('rejected');
    expect(pick(res, 'reason')).toBe('tier0_auto_heal_rejected');
  });

  it('act 路由：auto_heal 先写 WAL（I2 / AC-5）', async () => {
    const d = makeDevOps();
    const res = await act(d, 'auto_heal', { tier: 1, incident: 'pod-crashloop' });
    expect(res.executed).toBe(true);
    expect(pick(res, 'wal_entry')).toBeDefined();
    expect(pick(res, 'heal_plan').action).toBe('restart_or_rollback');
  });

  it('act 路由：scale / degrade / tune 三动作', async () => {
    const d = makeDevOps();
    const scale = await act(d, 'scale', { from: 1, to: 3 });
    expect(scale.executed).toBe(true);
    expect(pick(scale, 'scaling').delta).toBe(2);

    const degrade = await act(d, 'degrade', { level: 'graceful' });
    expect(degrade.executed).toBe(true);
    expect(pick(degrade, 'degradation').level).toBe('graceful');

    const tune = await act(d, 'tune', { param: 'max_connections', value: 200 });
    expect(tune.executed).toBe(true);
    expect(pick(tune, 'tuning').param).toBe('max_connections');
  });

  it('verify：部署 / 自愈无 WAL 记录为 false（I2 回滚保障）', async () => {
    const d = makeDevOps();
    const res = await act(d, 'deploy', { target: 'api-v2' });
    expect(await d.verify(res)).toBe(true);

    // 构造无 WAL 的部署结果 → verify false
    const noWal = await d.act({
      action_type: 'deploy',
      params: { target: 'x' },
    });
    const tampered = { ...noWal, result: { deployment: { status: 'ok' } } };
    expect(await d.verify(tampered)).toBe(false);
  });

  it('能力画像缺省含工具集 / 觉醒阶 E4 上限（F042 §2.1）', () => {
    const d = makeDevOps();
    const profile = d.capabilityProfile as Record<string, unknown>;
    expect(profile.tools).toContain('DeploymentOrchestrator');
    expect(profile.tools).toContain('IncidentResponder');
    expect(profile.max_awakening_stage).toBe('E4');
  });

  it('未知 action.type 抛 RangeError', async () => {
    const d = makeDevOps();
    await expect(act(d, 'restart_universe')).rejects.toThrow(RangeError);
  });
});
