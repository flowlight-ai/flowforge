/**
 * @flowforge/forgekin-roles — T7.28 ProductManagerForgekin 契约验证（F041）。
 *
 * 对齐 F041 §2.2/§2.3 + 验收标准 AC-2/AC-3/AC-4/AC-5/AC-6：
 *   - observe 采集 4 类信号（AC-2）
 *   - act 5 种动作路由（AC-3）
 *   - 用户故事 As-a / I-want / So-that 三段式模板（AC-4）
 *   - 优先级 MoSCoW / RICE 双模型（AC-5）
 *   - 愿景级变更必须 operator 批准（AC-6）
 *   - I1 不可直接修改架构师 / 开发者产物
 *   - I3 需求决策写入 EchoStore（echo_store 标记）
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import type { RoleActionResult } from '../src/types.js';
import {
  ProductManagerForgekin,
  USER_STORY_ROLE_VARIANTS,
  USER_STORY_SECTIONS,
} from '../src/product-manager.js';

/** 从动作结果提取动作特有字段（result 值域为 unknown，测试断言用）。 */
function pick(res: RoleActionResult, key: string): any {
  return res.result[key];
}

function makePM(): ProductManagerForgekin {
  return new ProductManagerForgekin({
    forgekinId: 'forgemind:keane',
    name: '凯恩',
    businessSystems: ['crm', 'im:feishu'],
  });
}

function act(pm: ProductManagerForgekin, actionType: string, params: Record<string, unknown> = {}) {
  return pm.act({ action_type: actionType, params });
}

describe('ProductManagerForgekin（F041 鹰·凯恩）', () => {
  it('observe 采集用户反馈 / 市场动态 / 竞品分析 / 内部指标 4 类信号（AC-2）', async () => {
    const pm = makePM();
    const obs = await pm.observe({
      product_signals: {
        user_feedback: ['反馈1'],
        market_signals: ['市场1'],
        competitive_analysis: ['竞品1'],
        internal_metrics: { retention: 0.8 },
      },
    });
    expect(obs.user_feedback).toEqual(['反馈1']);
    expect(obs.market_signals).toEqual(['市场1']);
    expect(obs.competitive_analysis).toEqual(['竞品1']);
    expect(obs.internal_metrics).toEqual({ retention: 0.8 });
    expect(obs.systems_queried).toEqual(['crm', 'im:feishu']);
  });

  it('act 路由：requirements_analysis 产出结构化需求 + echo_store 标记（I3）', async () => {
    const pm = makePM();
    const res = await act(pm, 'requirements_analysis', { input: '用户访谈：希望导出报表' });
    expect(res.executed).toBe(true);
    expect(res.decisionRecord).toBe('applied');
    expect(pick(res, 'requirements')).toHaveLength(1);
    expect(pick(res, 'tool')).toBe('RequirementsTraceabilityMatrix');
    expect(pick(res, 'echo_store')).toBe(true); // I3 决策写入 EchoStore
  });

  it('act 路由：roadmap_update 普通更新 applied；愿景级变更降级待批（AC-6）', async () => {
    const pm = makePM();
    const normal = await act(pm, 'roadmap_update', { horizon: 'quarterly', items: ['Q3 目标'] });
    expect(normal.executed).toBe(true);
    expect(pick(normal, 'roadmap').horizon).toBe('quarterly');

    const vision = await act(pm, 'roadmap_update', {
      items: [],
      vision_change: true, // 价值锚点 / 红线变更
    });
    expect(vision.executed).toBe(false);
    expect(vision.decisionRecord).toBe('pending_operator_review');
    expect(pick(vision, 'reason')).toBe('vision_change_requires_operator_approval');
  });

  it('act 路由：user_story 三段式合规 applied；缺段 rejected（AC-4）', async () => {
    const pm = makePM();
    const ok = await act(pm, 'user_story', {
      story: {
        'As a': '运营',
        'I want': '导出报表',
        'So that': '追踪转化率',
      },
    });
    expect(ok.executed).toBe(true);
    expect(pick(ok, 'story').as_a).toBe('运营');
    expect(pick(ok, 'validation').valid).toBe(true);

    const bad = await act(pm, 'user_story', {
      story: { 'As a': '运营' }, // 缺 I want / So that
    });
    expect(bad.executed).toBe(false);
    expect(bad.decisionRecord).toBe('rejected');
    expect(pick(bad, 'validation').missing).toEqual(['I want', 'So that']);
  });

  it('USER_STORY_SECTIONS 导出三段式模板（As-a / I-want / So-that）', () => {
    expect(USER_STORY_SECTIONS).toEqual(['As a', 'I want', 'So that']);
    expect(USER_STORY_ROLE_VARIANTS).toEqual(['As a', 'As an']);
  });

  it('act 路由：prioritize 支持 MoSCoW 与 RICE 双模型（AC-5）', async () => {
    const pm = makePM();
    const backlog = [
      { id: 'A', moscow: 'should' },
      { id: 'B', moscow: 'must' },
      { id: 'C', moscow: 'could' },
    ];
    const moscow = await act(pm, 'prioritize', { model: 'moscow', backlog });
    expect(moscow.executed).toBe(true);
    expect((pick(moscow, 'ordered') as unknown[]).map((x) => (x as { id: string }).id)).toEqual([
      'B',
      'A',
      'C',
    ]);

    const riceBacklog = [
      { id: 'X', reach: 100, impact: 3, confidence: 0.8, effort: 1 }, // score 240
      { id: 'Y', reach: 50, impact: 3, confidence: 0.8, effort: 1 }, // score 120
    ];
    const rice = await act(pm, 'prioritize', { model: 'rice', backlog: riceBacklog });
    expect(rice.executed).toBe(true);
    expect((pick(rice, 'ordered') as unknown[]).map((x) => (x as { id: string }).id)).toEqual([
      'X',
      'Y',
    ]);
  });

  it('act 路由：stakeholder_sync 汇总利益相关者沟通', async () => {
    const pm = makePM();
    const res = await act(pm, 'stakeholder_sync', {
      topic: 'Q3 路线图',
      stakeholders: ['架构师', '开发者'],
    });
    expect(res.executed).toBe(true);
    expect(pick(res, 'summary')).toContain('2 位利益相关者');
    expect(pick(res, 'tool')).toBe('StakeholderCommunicator');
  });

  it('I1：不可直接修改架构师 / 开发者产物（必须 MindCouncil 协调）', async () => {
    const pm = makePM();
    const arch = await act(pm, 'requirements_analysis', {
      input: 'x',
      target_artifact: 'architect:design_doc',
    });
    expect(arch.executed).toBe(false);
    expect(pick(arch, 'reason')).toBe('cross_domain_artifact_rejected');
    const dev = await act(pm, 'user_story', {
      story: { 'As a': 'a', 'I want': 'b', 'So that': 'c' },
      target_artifact: 'developer:code',
    });
    expect(dev.executed).toBe(false);
    expect(pick(dev, 'reason')).toBe('cross_domain_artifact_rejected');
  });

  it('verify：未执行（降级建议）为 false；user_story 模板无效为 false', async () => {
    const pm = makePM();
    const pending = await act(pm, 'roadmap_update', { vision_change: true });
    expect(await pm.verify(pending)).toBe(false);

    const bad = await act(pm, 'user_story', { story: {} });
    expect(await pm.verify(bad)).toBe(false);
  });

  it('能力画像缺省含盲点 / 工具集（F041 §2.1）', () => {
    const pm = makePM();
    const profile = pm.capabilityProfile as Record<string, unknown>;
    expect(profile.blind_spots).toContain('过度承诺');
    expect(profile.tools).toContain('UserStoryMapper');
    expect(profile.max_awakening_stage).toBe('E3'); // 觉醒阶 E3 上限
  });

  it('未知 action.type 抛 RangeError', async () => {
    const pm = makePM();
    await expect(act(pm, 'fly_to_moon')).rejects.toThrow(RangeError);
  });
});
