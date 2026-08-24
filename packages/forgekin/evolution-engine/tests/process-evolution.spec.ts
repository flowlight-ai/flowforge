/**
 * process-evolution — T7.20 Mode B Process Evolution 提案管理验证。
 *
 * 覆盖：触发检测优先级 / 五槽提案创建与硬护栏校验 /
 * 最小杠杆排序 / accepted 落地闭环（commit_ref 必填）/ 30 天 replay check。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import { LEVERAGE_ORDER, MIN_EVIDENCE_SOURCES, ProcessEvolution } from '../src/process-evolution.js';

function validProposal(pe: ProcessEvolution, overrides: Record<string, unknown> = {}) {
  return pe.createProposal({
    triggerType: 'repeated_error',
    trigger: '相同错误出现两次',
    evidence: ['trace-1', 'trace-2'],
    rootCause: '缺少流程指引',
    lever: 'sop',
    verify: '30 天 replay 验证',
    ...overrides,
  });
}

describe('ProcessEvolution.detectTrigger', () => {
  it('同类错误 ≥2 次 → repeated_error（最高优先级）', () => {
    const pe = new ProcessEvolution();
    const result = pe.detectTrigger({
      errorHistory: [{ code: 'E1' }, { code: 'E1' }],
      userCorrections: [{ generalizable: true }],
      sopGaps: ['gap'],
      reviewFindings: [],
    });
    expect(result).toBe('repeated_error');
  });

  it('可泛化用户纠正 → user_correction', () => {
    const pe = new ProcessEvolution();
    const result = pe.detectTrigger({
      errorHistory: [],
      userCorrections: [{ generalizable: true }, { generalizable: false }],
      sopGaps: [],
      reviewFindings: [],
    });
    expect(result).toBe('user_correction');
  });

  it('SOP 缺口 → sop_gap；系统性 review → review_systemic', () => {
    const pe = new ProcessEvolution();
    expect(
      pe.detectTrigger({ errorHistory: [], userCorrections: [], sopGaps: ['无指引'], reviewFindings: [] }),
    ).toBe('sop_gap');
    expect(
      pe.detectTrigger({
        errorHistory: [],
        userCorrections: [],
        sopGaps: [],
        reviewFindings: [{ systemic: true }],
      }),
    ).toBe('review_systemic');
  });

  it('无任何触发 → null', () => {
    const pe = new ProcessEvolution();
    expect(
      pe.detectTrigger({
        errorHistory: [{ code: 'E1' }],
        userCorrections: [{ generalizable: false }],
        sopGaps: [],
        reviewFindings: [{ systemic: false }],
      }),
    ).toBeNull();
  });
});

describe('ProcessEvolution.createProposal / validateProposal', () => {
  it('非法 trigger_type 抛错', () => {
    const pe = new ProcessEvolution();
    expect(() =>
      pe.createProposal({
        triggerType: 'bogus',
        trigger: 't',
        evidence: ['a', 'b'],
        rootCause: 'r',
        lever: 'memory',
        verify: 'v',
      }),
    ).toThrow(/Invalid trigger_type/);
  });

  it('证据 ≥2 源硬护栏：1 源校验失败', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe, { evidence: ['trace-1'] });
    const { valid, errors } = pe.validateProposal(p);
    expect(valid).toBe(false);
    expect(errors.join(' ')).toContain(`evidence sources 1 < minimum ${MIN_EVIDENCE_SOURCES}`);
  });

  it('五槽非空：trigger 为空校验失败', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe, { trigger: '   ' });
    const { errors } = pe.validateProposal(p);
    expect(errors.join(' ')).toContain("slot 'trigger' is empty");
  });

  it('lever 不在最小杠杆排序中校验失败', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe, { lever: 'huge_refactor' });
    const { errors } = pe.validateProposal(p);
    expect(errors.join(' ')).toContain('not in leverage order');
  });

  it('完整合法提案校验通过', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe);
    const { valid, errors } = pe.validateProposal(p);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('ProcessEvolution 最小杠杆 / 生命周期', () => {
  it('getMinimalLeverage 返回索引最小的杠杆，空输入返回最重 l0', () => {
    const pe = new ProcessEvolution();
    expect(pe.getMinimalLeverage(['l0', 'memory', 'sop'])).toBe('memory');
    expect(pe.getMinimalLeverage(['system_prompt', 'skill'])).toBe('skill');
    expect(pe.getMinimalLeverage([])).toBe('l0');
  });

  it('LEVERAGE_ORDER 从轻到重：recite_scope 最轻 l0 最重', () => {
    expect(LEVERAGE_ORDER[0]).toBe('recite_scope');
    expect(LEVERAGE_ORDER.at(-1)).toBe('l0');
  });

  it('acceptProposal 无 commit_ref 抛错（落地闭环硬护栏）', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe);
    expect(() => pe.acceptProposal(p.proposalId, '  ')).toThrow(/commit_ref is required/);
  });

  it('acceptProposal 仅 accepted 从 proposed 状态，并关联 commit', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe);
    const accepted = pe.acceptProposal(p.proposalId, 'abc123');
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.commitRef).toBe('abc123');
    expect(accepted?.acceptedAt).toBeTruthy();

    // 已 accepted 再次接受失败
    expect(pe.acceptProposal(p.proposalId, 'def456')).toBeNull();
    // 未知 id 失败
    expect(pe.acceptProposal('pe-nope', 'abc123')).toBeNull();
  });

  it('scheduleReplayCheck 30 天后到期，getDueReplayChecks 筛选', () => {
    const pe = new ProcessEvolution();
    const p = validProposal(pe);
    const due = pe.scheduleReplayCheck(p.proposalId, 30);
    expect(due).toBeTruthy();

    // 未 accepted 不出现在到期清单（Python 语义：仅 accepted 计入）
    expect(pe.getDueReplayChecks()).toHaveLength(0);

    pe.acceptProposal(p.proposalId, 'abc123');
    // 未来 1 天：未到期
    expect(pe.getDueReplayChecks(new Date(Date.now() + 1 * 24 * 3600 * 1000))).toHaveLength(0);
    // 31 天后：已到期
    expect(pe.getDueReplayChecks(new Date(Date.now() + 31 * 24 * 3600 * 1000))).toHaveLength(1);
  });

  it('getProposals 可按状态过滤', () => {
    const pe = new ProcessEvolution();
    validProposal(pe);
    const accepted = validProposal(pe);
    pe.acceptProposal(accepted.proposalId, 'abc123');
    expect(pe.getProposals()).toHaveLength(2);
    expect(pe.getProposals('accepted')).toHaveLength(1);
    expect(pe.getProposals('proposed')).toHaveLength(1);
  });
});
