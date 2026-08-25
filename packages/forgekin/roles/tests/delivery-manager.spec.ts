/**
 * @flowforge/forgekin-roles — T7.28 DeliveryManagerForgekin 契约验证（F044）。
 *
 * 对齐 F044 §2.2/§2.3 + 验收标准 AC-2/AC-3/AC-4/AC-5：
 *   - observe 采集 4 类信号（AC-2）
 *   - act 5 种动作路由（AC-3）
 *   - 资源重新分配必须 operator 批准（AC-4）
 *   - 质量门禁不可绕过（DoD 未满足禁止放行，AC-5）
 *   - 阻塞级风险上报不静默（I3）
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import type { RoleActionResult } from '../src/types.js';
import { DeliveryManagerForgekin } from '../src/delivery-manager.js';

/** 从动作结果提取动作特有字段（result 值域为 unknown，测试断言用）。 */
function pick(res: RoleActionResult, key: string): any {
  return res.result[key];
}

function makeDM(): DeliveryManagerForgekin {
  return new DeliveryManagerForgekin({
    forgekinId: 'forgemind:newton',
    name: '牛顿',
    businessSystems: ['jira', 'ci'],
  });
}

function act(d: DeliveryManagerForgekin, actionType: string, params: Record<string, unknown> = {}) {
  return d.act({ action_type: actionType, params });
}

describe('DeliveryManagerForgekin（F044 象·牛顿）', () => {
  it('observe 采集项目状态 / 里程碑 / 风险 / 资源 4 类信号（AC-2）', async () => {
    const d = makeDM();
    const obs = await d.observe({
      delivery_signals: {
        project_status: { phase: 'dev' },
        milestones: ['M1'],
        risks: [{ id: 'R1', severity: 'high' }],
        resources: { dev: 3 },
      },
    });
    expect(obs.project_status).toEqual({ phase: 'dev' });
    expect(obs.milestones).toEqual(['M1']);
    expect(obs.risks).toHaveLength(1);
    expect(obs.resources).toEqual({ dev: 3 });
  });

  it('act 路由：plan_project 产出 WBS / 里程碑（AC-3）', async () => {
    const d = makeDM();
    const res = await act(d, 'plan_project', { scope: 'v7.2', milestones: ['M1', 'M2'] });
    expect(res.executed).toBe(true);
    expect(pick(res, 'plan').wbs).toBe('WBS-forgemind:newton');
    expect(pick(res, 'plan').milestones).toEqual(['M1', 'M2']);
    expect(pick(res, 'tool')).toBe('ProjectPlanner');
  });

  it('act 路由：track_progress 里程碑进度', async () => {
    const d = makeDM();
    const done = await act(d, 'track_progress', { milestone: 'M1', progress: 100 });
    expect(done.executed).toBe(true);
    expect(pick(done, 'progress').status).toBe('done');

    const ongoing = await act(d, 'track_progress', { milestone: 'M2', progress: 40 });
    expect(pick(ongoing, 'progress').status).toBe('in_progress');
  });

  it('act 路由：mitigate_risk 普通风险缓解；blocker 风险上报 operator（I3）', async () => {
    const d = makeDM();
    const normal = await act(d, 'mitigate_risk', { risk: '依赖升级延迟', severity: 'medium' });
    expect(normal.executed).toBe(true);
    expect(pick(normal, 'mitigation').status).toBe('mitigated');

    const blocker = await act(d, 'mitigate_risk', { risk: '核心服务下线', severity: 'blocker' });
    expect(blocker.executed).toBe(true);
    expect(pick(blocker, 'mitigation').status).toBe('escalated_to_operator'); // 不静默
  });

  it('act 路由：coordinate_resources 普通分配 applied；reallocate 降级待批（I1 / AC-4）', async () => {
    const d = makeDM();
    const normal = await act(d, 'coordinate_resources', { resource: 'dev-1', from: 'A', to: 'B' });
    expect(normal.executed).toBe(true);
    expect(pick(normal, 'allocation').status).toBe('applied');

    const reallocate = await act(d, 'coordinate_resources', {
      resource: 'dev-1',
      reallocate: true,
    });
    expect(reallocate.executed).toBe(false);
    expect(reallocate.decisionRecord).toBe('pending_operator_review');
    expect(pick(reallocate, 'reason')).toBe('resource_reallocation_requires_operator_approval');
  });

  it('I2：质量门禁不可绕过 — DoD 全过放行；未满足 rejected（AC-5）', async () => {
    const d = makeDM();
    const pass = await act(d, 'quality_gate', {
      stage: 'release',
      dod: { tests: true, review: true, docs: true },
    });
    expect(pass.executed).toBe(true);
    expect(pick(pass, 'gate').passed).toBe(true);

    const fail = await act(d, 'quality_gate', {
      stage: 'release',
      dod: { tests: true, review: false, docs: true },
    });
    expect(fail.executed).toBe(false);
    expect(fail.decisionRecord).toBe('rejected');
    expect(pick(fail, 'gate').unmet).toEqual(['review']);
  });

  it('verify：质量门禁未通过恒 false；通过为 true', async () => {
    const d = makeDM();
    const pass = await act(d, 'quality_gate', { stage: 'release', dod: { tests: true } });
    expect(await d.verify(pass)).toBe(true);

    const fail = await act(d, 'quality_gate', {
      stage: 'release',
      dod: { tests: false },
    });
    expect(await d.verify(fail)).toBe(false);
  });

  it('能力画像缺省含工具集 / 觉醒阶 E3 上限（F044 §2.1）', () => {
    const d = makeDM();
    const profile = d.capabilityProfile as Record<string, unknown>;
    expect(profile.tools).toContain('QualityGate');
    expect(profile.tools).toContain('ResourceCoordinator');
    expect(profile.max_awakening_stage).toBe('E3');
  });

  it('未知 action.type 抛 RangeError', async () => {
    const d = makeDM();
    await expect(act(d, 'invent_time_machine')).rejects.toThrow(RangeError);
  });
});
