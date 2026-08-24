/**
 * close-gate — T7.20 CL-025 F177 Close Gate Validator 验证。
 *
 * 覆盖：AC→evidence 矩阵 / follow-up 屏蔽词检测 /
 * 决策合规（rationale 非空 + 无 follow-up）/ Phase Close 全量判定。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import {
  CloseGateValidator,
  DEFAULT_FOLLOW_UP_BLOCKLIST,
  makeCloseGateDecision,
  makeEvidence,
} from '../src/close-gate.js';

describe('CloseGateValidator', () => {
  it('默认屏蔽词清单含 follow-up / next phase / P2', () => {
    expect(DEFAULT_FOLLOW_UP_BLOCKLIST).toContain('follow-up');
    expect(DEFAULT_FOLLOW_UP_BLOCKLIST).toContain('next phase');
    expect(DEFAULT_FOLLOW_UP_BLOCKLIST).toContain('P2');
  });

  it('registerEvidence + getEvidenceMatrix 按 ac_id 分组', () => {
    const v = new CloseGateValidator();
    v.registerEvidence(makeEvidence({ acId: 'AC-A1', status: 'pass', evidenceType: 'test', evidenceUri: 'report.html' }));
    v.registerEvidence(makeEvidence({ acId: 'AC-A1', status: 'pass', evidenceType: 'screenshot', evidenceUri: 'shot.png' }));
    v.registerEvidence(makeEvidence({ acId: 'AC-A2', status: 'fail', evidenceType: 'commit', evidenceUri: 'abc123' }));
    const matrix = v.getEvidenceMatrix();
    expect(Object.keys(matrix)).toEqual(['AC-A1', 'AC-A2']);
    expect(matrix['AC-A1']).toHaveLength(2);
    expect(matrix['AC-A2']?.[0]?.status).toBe('fail');
  });

  it('checkNoFollowUp：命中屏蔽词返回 clean=false + foundTerms', () => {
    const v = new CloseGateValidator();
    expect(v.checkNoFollowUp('')).toEqual({ clean: true, foundTerms: [] });
    expect(v.checkNoFollowUp('功能全部完成')).toEqual({ clean: true, foundTerms: [] });

    const result = v.checkNoFollowUp('剩余 follow-up 将在 next phase 处理');
    expect(result.clean).toBe(false);
    expect(result.foundTerms).toContain('follow-up');
    expect(result.foundTerms).toContain('next phase');
  });

  it('validateCloseDecision：空 rationale 失败、含 follow-up 失败、正常通过', () => {
    const v = new CloseGateValidator();
    expect(
      v.validateCloseDecision(makeCloseGateDecision({ decision: 'immediate', decidedBy: 'sherlock', rationale: '  ' })),
    ).toEqual({ ok: false, message: 'rationale 不能为空' });

    expect(
      v.validateCloseDecision(
        makeCloseGateDecision({ decision: 'immediate', decidedBy: 'sherlock', rationale: 'OK, P2 待办' }),
      ).ok,
    ).toBe(false);

    expect(
      v.validateCloseDecision(
        makeCloseGateDecision({ decision: 'immediate', decidedBy: 'sherlock', rationale: 'AC 全部通过，立即关闭' }),
      ),
    ).toEqual({ ok: true, message: 'ok' });
  });

  it('validatePhaseClose：全 pass → 报告 passed=true', () => {
    const v = new CloseGateValidator();
    const report = v.validatePhaseClose({
      phaseId: 'A',
      decision: makeCloseGateDecision({
        decision: 'immediate',
        decidedBy: 'operator',
        rationale: 'AC 全部通过，立即关闭',
      }),
      evidences: [
        makeEvidence({ acId: 'AC-A1', status: 'pass', evidenceType: 'test', evidenceUri: 'r.html' }),
        makeEvidence({ acId: 'AC-A2', status: 'pass', evidenceType: 'screenshot', evidenceUri: 's.png' }),
      ],
      closingText: '本阶段功能全部完成并验证',
    });
    expect(report.passed).toBe(true);
    expect(report.acPassCount).toBe(2);
    expect(report.acFailCount).toBe(0);
    expect(report.evidenceCount).toBe(2);
    expect(report.followUpViolations).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('validatePhaseClose：任一 AC fail 或 follow-up 字样 → passed=false', () => {
    const v = new CloseGateValidator();
    const failReport = v.validatePhaseClose({
      phaseId: 'A',
      decision: makeCloseGateDecision({
        decision: 'immediate',
        decidedBy: 'operator',
        rationale: 'AC 全部通过',
      }),
      evidences: [
        makeEvidence({ acId: 'AC-A1', status: 'pass', evidenceType: 'test', evidenceUri: 'r.html' }),
        makeEvidence({ acId: 'AC-A2', status: 'fail', evidenceType: 'log', evidenceUri: 'err.log' }),
      ],
    });
    expect(failReport.passed).toBe(false);
    expect(failReport.acFailCount).toBe(1);

    // 重复证据同一 AC：任一 fail 即 fail
    const v2 = new CloseGateValidator();
    const dupReport = v2.validatePhaseClose({
      phaseId: 'B',
      decision: makeCloseGateDecision({
        decision: 'delete',
        decidedBy: 'operator',
        rationale: '功能删除',
      }),
      evidences: [
        makeEvidence({ acId: 'AC-B1', status: 'pass', evidenceType: 'commit', evidenceUri: 'a' }),
        makeEvidence({ acId: 'AC-B1', status: 'fail', evidenceType: 'log', evidenceUri: 'b' }),
      ],
    });
    expect(dupReport.acPassCount).toBe(0);
    expect(dupReport.acFailCount).toBe(1);

    // closing_text 含 follow-up
    const v3 = new CloseGateValidator();
    const followUpReport = v3.validatePhaseClose({
      phaseId: 'C',
      decision: makeCloseGateDecision({
        decision: 'cvo_signoff',
        decidedBy: 'operator',
        rationale: 'CVO 签核通过',
      }),
      evidences: [makeEvidence({ acId: 'AC-C1', status: 'pass', evidenceType: 'test', evidenceUri: 'r' })],
      closingText: '剩余 follow-up 下一阶段处理',
    });
    expect(followUpReport.passed).toBe(false);
    expect(followUpReport.followUpViolations).toContain('follow-up');
  });

  it('自定义屏蔽词清单覆盖默认', () => {
    const v = new CloseGateValidator({ followUpBlocklist: ['后续'] });
    expect(v.checkNoFollowUp('后续跟进').clean).toBe(false);
    expect(v.checkNoFollowUp('follow-up').clean).toBe(true);
  });
});
