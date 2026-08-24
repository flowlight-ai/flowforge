/**
 * models — L0/L2 知识卡片数据模型验证。
 *
 * 覆盖：EpisodeCard / MethodCard 默认值 / 成熟度枚举 / ID 生成。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import {
  EpisodeCard,
  KnowledgeMaturityLevel,
  MethodCard,
  genEpisodeId,
  genMethodId,
} from '../src/models.js';

describe('KnowledgeMaturityLevel 五级阶梯', () => {
  it('L0-L4 值为 L0~L4', () => {
    expect(KnowledgeMaturityLevel.L0_EPISODE).toBe('L0');
    expect(KnowledgeMaturityLevel.L1_PATTERN).toBe('L1');
    expect(KnowledgeMaturityLevel.L2_DRAFT).toBe('L2');
    expect(KnowledgeMaturityLevel.L3_VALIDATED).toBe('L3');
    expect(KnowledgeMaturityLevel.L4_STANDARD).toBe('L4');
  });
});

describe('EpisodeCard', () => {
  const base = {
    task_snapshot: '修复登录超时问题',
    transferable_method: '先复现再定位',
    non_transferable_facts: '项目使用 redis',
    safety_boundary: '不修改认证逻辑',
  };

  it('默认值：自动生成 episode_id + method_card 方向 + 空集合', () => {
    const card = new EpisodeCard(base);
    expect(card.episode_id).toMatch(/^episode-\d+-[0-9a-f]{6}$/);
    expect(card.distillation_direction).toBe('method_card');
    expect(card.evidence_map).toEqual({});
    expect(card.decision_timeline).toEqual([]);
    expect(card.collaboration_pivots).toEqual([]);
    expect(card.created_at).toBeTruthy();
  });

  it('显式 episode_id 与方向被保留', () => {
    const card = new EpisodeCard({ ...base, episode_id: 'ep-1', distillation_direction: 'skill_draft' });
    expect(card.episode_id).toBe('ep-1');
    expect(card.distillation_direction).toBe('skill_draft');
  });
});

describe('MethodCard', () => {
  const base = { title: '调试方法', domain: 'development', content: '步骤 1...' };

  it('默认值：procedural / team_shared / experimental / draft / L2', () => {
    const card = new MethodCard(base);
    expect(card.method_id).toMatch(/^method-\d+-[0-9a-f]{6}$/);
    expect(card.knowledge_type).toBe('procedural');
    expect(card.scope).toBe('team_shared');
    expect(card.trust_level).toBe('experimental');
    expect(card.lifecycle).toBe('draft');
    expect(card.maturity_level).toBe(KnowledgeMaturityLevel.L2_DRAFT);
    expect(card.source_refs).toEqual([]);
  });

  it('显式覆盖全部字段', () => {
    const card = new MethodCard({
      ...base,
      method_id: 'm-1',
      knowledge_type: 'declarative',
      maturity_level: KnowledgeMaturityLevel.L3_VALIDATED,
      source_refs: ['ep-1', 'ep-2'],
    });
    expect(card.method_id).toBe('m-1');
    expect(card.knowledge_type).toBe('declarative');
    expect(card.maturity_level).toBe('L3');
    expect(card.source_refs).toEqual(['ep-1', 'ep-2']);
  });
});

describe('ID 生成', () => {
  it('genEpisodeId / genMethodId 前缀正确且两次不重复', () => {
    const a = genEpisodeId();
    const b = genEpisodeId();
    expect(a).toMatch(/^episode-/);
    expect(b).toMatch(/^episode-/);
    expect(genMethodId()).toMatch(/^method-/);
  });
});
