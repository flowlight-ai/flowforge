/**
 * manager — F036 ForgeRelationshipManager 契约验证
 *
 * 覆盖：出生关系初始化 / 垂直层插件注册（自动加入 can_evolve_to）/
 * 进化条件（Eval ≥ 0.85 + 5+ 任务 + operator 审批）/ 回炉协议
 * （仅蒸馏通用能力、垂直能力保留原层）/ 血缘追踪 / 幂等执行。
 *
 * @module @flowforge/forgekin-relationship/tests
 */

import { describe, expect, it } from 'vitest';
import { ForgeRelationshipManager, parseLayers, parseTransitionRules } from '../src/manager.js';
import { loadRelationshipConfig } from '../src/config.js';

function makeManager(): ForgeRelationshipManager {
  const manager = new ForgeRelationshipManager();
  manager.registerLayer({
    layer_id: 'contentforge',
    role: 'vertical',
    vertical_skills: ['article_writing', 'reporting'],
    can_evolve_to: [],
    can_reclaim_to: 'forgemind',
  });
  return manager;
}

function approvedEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eval_score: 0.9,
    task_count: 7,
    operator_approved: true,
    capability_profile: { writing: 0.8, research: 0.6 },
    ...overrides,
  };
}

describe('parseTransitionRules / parseLayers（YAML 宽松解析）', () => {
  it('内置 forge-relationship.yaml 解析出默认规则与 forgemind 通用层', () => {
    const config = loadRelationshipConfig();
    const rel = config['forge_relationship'] as Record<string, unknown>;
    const rules = parseTransitionRules((rel['transition_rules'] as Record<string, unknown>)?.['evolve'] ?? rel['transition_rules']);
    expect(rules.min_eval_score).toBe(0.85);
    expect(rules.min_task_count).toBe(5);
    expect(rules.require_operator_approval).toBe(true);
    const layers = parseLayers((rel['layers'] as Record<string, unknown>)?.['evolve'] ?? rel['layers']);
    const general = layers.get('forgemind');
    expect(general).toBeDefined();
    expect(general!.role).toBe('general');
  });

  it('parseTransitionRules 宽松回落内置默认', () => {
    const rules = parseTransitionRules(undefined);
    expect(rules.min_eval_score).toBe(0.85);
    expect(rules.distill_general_only).toBe(true);
  });
});

describe('ForgeRelationshipManager 层注册与出生关系', () => {
  it('默认注册 forgemind 通用层', () => {
    const manager = new ForgeRelationshipManager();
    expect(manager.getLayer('forgemind').role).toBe('general');
  });

  it('插件注册垂直层后自动加入通用层 can_evolve_to', () => {
    const manager = makeManager();
    const general = manager.getLayer('forgemind');
    expect(general.can_evolve_to).toContain('contentforge');
  });

  it('重复注册同一层抛错', () => {
    const manager = makeManager();
    expect(() =>
      manager.registerLayer({
        layer_id: 'contentforge',
        role: 'vertical',
        vertical_skills: ['x'],
        can_evolve_to: [],
        can_reclaim_to: 'forgemind',
      }),
    ).toThrow(/已注册/);
  });

  it('initRelationship 建立出生记录（origin=current=默认层）', () => {
    const manager = makeManager();
    const relation = manager.initRelationship('fk-1', { writing: 0.5 });
    expect(relation.origin_layer_id).toBe('forgemind');
    expect(relation.current_layer_id).toBe('forgemind');
    expect(relation.evolution_history).toHaveLength(0);
    expect(relation.capability_snapshot_per_layer['forgemind']).toEqual({ writing: 0.5 });
  });

  it('重复初始化同一 Forgekin 抛错', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() => manager.initRelationship('fk-1', {})).toThrow(/已有关系记录/);
  });

  it('查询未初始化 Forgekin 抛错', () => {
    const manager = makeManager();
    expect(() => manager.getRelationship('ghost')).toThrow(/没有跨层关系记录/);
  });
});

describe('进化协议（通用 → 垂直）', () => {
  it('Eval < 0.85 拒绝', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() =>
      manager.requestEvolveToVertical('fk-1', 'contentforge', '领域深耕', approvedEvidence({ eval_score: 0.8 }) as never),
    ).toThrow(/Eval 0.8 < min_eval_score 0.85/);
  });

  it('任务数 < 5 拒绝', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() =>
      manager.requestEvolveToVertical('fk-1', 'contentforge', '领域深耕', approvedEvidence({ task_count: 3 }) as never),
    ).toThrow(/任务数 3 < min_task_count 5/);
  });

  it('未获 operator 批准拒绝', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() =>
      manager.requestEvolveToVertical('fk-1', 'contentforge', '领域深耕', approvedEvidence({ operator_approved: false }) as never),
    ).toThrow(/operator 批准/);
  });

  it('未注册目标层 / 非垂直层拒绝', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() =>
      manager.requestEvolveToVertical('fk-1', 'ghostforge', 'x', approvedEvidence() as never),
    ).toThrow(/未注册/);
  });

  it('拓扑不允许的目标层拒绝', () => {
    const manager = makeManager();
    manager.registerLayer({
      layer_id: 'novelforge',
      role: 'vertical',
      vertical_skills: ['fiction'],
      can_evolve_to: [],
      can_reclaim_to: 'forgemind',
    });
    // 手动收紧通用层拓扑（模拟 operator 显式声明：novelforge 不在可进化列表）
    manager.layers.set('forgemind', {
      layer_id: 'forgemind',
      role: 'general',
      vertical_skills: [],
      can_evolve_to: ['contentforge'],
    });
    manager.initRelationship('fk-1', {});
    expect(() =>
      manager.requestEvolveToVertical('fk-1', 'novelforge', 'x', approvedEvidence() as never),
    ).toThrow(/can_evolve_to/);
  });

  it('满足条件后 executeTransition：能力复制 + 垂直技能注入 + 血缘记录', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', { writing: 0.8, research: 0.6 });
    const transitionId = manager.requestEvolveToVertical(
      'fk-1',
      'contentforge',
      '内容领域深耕',
      approvedEvidence() as never,
    );
    const executed = manager.executeTransition(transitionId);
    expect(executed.transition_type).toBe('evolve');
    expect(executed.operator_approved).toBe(true);
    expect(executed.capability_delta['vertical_skills']).toEqual(['article_writing', 'reporting']);
    const relation = manager.getRelationship('fk-1');
    expect(relation.current_layer_id).toBe('contentforge');
    expect(relation.evolution_history).toHaveLength(1);
    const snapshot = relation.capability_snapshot_per_layer['contentforge']!;
    expect(snapshot['writing']).toBe(0.8);
    expect(snapshot['vertical_skills']).toEqual(['article_writing', 'reporting']);
  });

  it('executeTransition 幂等（重复执行返回既有记录）', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    const transitionId = manager.requestEvolveToVertical('fk-1', 'contentforge', 'x', approvedEvidence() as never);
    const first = manager.executeTransition(transitionId);
    const second = manager.executeTransition(transitionId);
    expect(second).toBe(first);
  });

  it('迁移记录过期（当前层已变）抛错', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    const transitionId = manager.requestEvolveToVertical('fk-1', 'contentforge', 'x', approvedEvidence() as never);
    manager.executeTransition(transitionId);
    // 第二次迁移后再尝试执行第一条过期记录
    const secondId = manager.requestReclaimToForgemind('fk-1', '回炉', approvedEvidence() as never);
    manager.executeTransition(secondId);
    expect(() => manager.executeTransition(transitionId)).toThrow(/已过期/);
  });
});

describe('回炉协议（垂直 → 通用）', () => {
  it('通用层 Forgekin 无法回炉', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    expect(() => manager.requestReclaimToForgemind('fk-1', 'x', approvedEvidence() as never)).toThrow(
      /不是垂直承载层/,
    );
  });

  it('未获 operator 批准拒绝回炉', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', {});
    const transitionId = manager.requestEvolveToVertical('fk-1', 'contentforge', 'x', approvedEvidence() as never);
    manager.executeTransition(transitionId);
    expect(() =>
      manager.requestReclaimToForgemind('fk-1', 'x', approvedEvidence({ operator_approved: false }) as never),
    ).toThrow(/operator 批准/);
  });

  it('回炉仅蒸馏通用能力，垂直技能留在原层快照', () => {
    const manager = makeManager();
    manager.initRelationship('fk-1', { writing: 0.8 });
    const evolveId = manager.requestEvolveToVertical('fk-1', 'contentforge', 'x', approvedEvidence() as never);
    manager.executeTransition(evolveId);
    const reclaimId = manager.requestReclaimToForgemind('fk-1', '能力沉淀', approvedEvidence() as never);
    const reclaimed = manager.executeTransition(reclaimId);
    expect(reclaimed.transition_type).toBe('reclaim');
    expect(reclaimed.capability_delta['distilled_general_only']).toBe(true);
    const relation = manager.getRelationship('fk-1');
    expect(relation.current_layer_id).toBe('forgemind');
    // 通用层快照含蒸馏标记但无垂直技能
    const generalSnapshot = relation.capability_snapshot_per_layer['forgemind']!;
    expect(generalSnapshot['vertical_skills']).toBeUndefined();
    expect(generalSnapshot['distilled_general_only']).toBe(true);
    // 垂直能力保留原层快照
    const verticalSnapshot = relation.capability_snapshot_per_layer['contentforge']!;
    expect(verticalSnapshot['vertical_skills']).toEqual(['article_writing', 'reporting']);
    // 血缘追踪：两次迁移均在历史中
    expect(relation.evolution_history.map((t) => t.transition_type)).toEqual(['evolve', 'reclaim']);
    expect(manager.listTransitions('fk-1')).toHaveLength(2);
  });
});
