/**
 * models — T7.20 进化引擎数据模型验证。
 *
 * 覆盖：ScopeGuardLog 工厂 / EvolutionProposal 五槽契约 /
 * KnowledgeObject CL-005 七字段 + 成熟度→置信度映射。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import {
  confidenceFromMaturity,
  makeEvolutionProposal,
  makeKnowledgeObject,
  makeScopeGuardLog,
  MATURITY_CONFIDENCE_MAPPING,
  SCOPE_GUARD_SIGNALS,
} from '../src/models.js';

describe('models: ScopeGuardLog', () => {
  it('makeScopeGuardLog 填充默认日期并保留五字段', () => {
    const log = makeScopeGuardLog({
      featureId: 'feat-1',
      signalType: 'new_journey',
      actionTaken: 'remind',
      outcome: 'reminder text',
      agent: 'scope_guard',
    });
    expect(log.featureId).toBe('feat-1');
    expect(log.actionTaken).toBe('remind');
    expect(log.agent).toBe('scope_guard');
    expect(log.date).toBeTruthy();
    expect(Date.parse(log.date)).not.toBeNaN();
  });

  it('SCOPE_GUARD_SIGNALS 含 4 种信号（2 普通规则依赖）', () => {
    expect(SCOPE_GUARD_SIGNALS).toContain('not_serving_vision');
    expect(SCOPE_GUARD_SIGNALS).toContain('new_journey');
    expect(SCOPE_GUARD_SIGNALS).toContain('new_dependency');
    expect(SCOPE_GUARD_SIGNALS).toContain('unclear_verification');
  });
});

describe('models: EvolutionProposal', () => {
  it('makeEvolutionProposal 默认 proposed 状态 + 空 commit_ref', () => {
    const p = makeEvolutionProposal({
      proposalId: 'pe-abc',
      triggerType: 'repeated_error',
      target: 'sop',
      trigger: 'error repeated twice',
      evidence: ['log-1', 'log-2'],
      rootCause: 'missing guideline',
      lever: 'sop',
      verify: 'replay 30 days',
    });
    expect(p.status).toBe('proposed');
    expect(p.commitRef).toBe('');
    expect(p.acceptedAt).toBeNull();
    expect(p.replayCheckDue).toBeNull();
    expect(p.evidence).toEqual(['log-1', 'log-2']);
    expect(p.createdAt).toBeTruthy();
  });

  it('evidence 数组拷贝（外部修改不影响提案）', () => {
    const evidence = ['a'];
    const p = makeEvolutionProposal({
      proposalId: 'pe-x',
      triggerType: 'sop_gap',
      target: 'sop',
      trigger: 't',
      evidence,
      rootCause: 'r',
      lever: 'memory',
      verify: 'v',
    });
    evidence.push('b');
    expect(p.evidence).toEqual(['a']);
  });
});

describe('models: KnowledgeObject CL-005', () => {
  it('makeKnowledgeObject 默认 maturityLevel=L0 且 confidence=0.2', () => {
    const obj = makeKnowledgeObject({
      artifactType: 'episode',
      domain: 'development',
      knowledgeType: 'procedural',
      scope: 'agent_local',
      trustLevel: 'experimental',
    });
    expect(obj.maturityLevel).toBe('L0');
    expect(obj.confidence).toBe(0.2);
    expect(obj.trigger).toBe('');
    expect(obj.procedure).toBe('');
    expect(obj.precondition).toBe('');
    expect(obj.postcondition).toBe('');
    expect(obj.antiPattern).toBe('');
    expect(obj.lifecycle).toBe('draft');
  });

  it('confidenceFromMaturity 五级映射 L0..L4', () => {
    expect(MATURITY_CONFIDENCE_MAPPING).toEqual({
      L0: 0.2,
      L1: 0.4,
      L2: 0.6,
      L3: 0.8,
      L4: 1.0,
    });
    expect(confidenceFromMaturity('L0')).toBe(0.2);
    expect(confidenceFromMaturity('L2')).toBe(0.6);
    expect(confidenceFromMaturity('L4')).toBe(1.0);
  });

  it('maturityLevel 提供时同步计算 confidence', () => {
    const obj = makeKnowledgeObject({
      artifactType: 'method',
      domain: 'development',
      knowledgeType: 'analytical',
      scope: 'team_shared',
      trustLevel: 'validated',
      maturityLevel: 'L3',
      trigger: '用户询问代码审查时',
    });
    expect(obj.confidence).toBe(0.8);
    expect(obj.trigger).toBe('用户询问代码审查时');
  });
});
