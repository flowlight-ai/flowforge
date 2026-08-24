/**
 * CL-025 F177 Close Gate Validator — Phase A Close Gate 结构化判据。
 * TS 重写自 Python `evolution/close_gate.py`。
 *
 * 规格（design v7.1-§D7.9）：
 * - AC → evidence 矩阵（每条 AC 标注 pass/fail + commit/test/screenshot 证据）
 * - fail 强制三选一（immediate/delete/cvo_signoff）
 * - 禁止 follow-up / next phase / P2 字样
 */

/** 默认 follow-up 屏蔽词清单（红线 11：可通过构造参数配置覆盖）。 */
export const DEFAULT_FOLLOW_UP_BLOCKLIST = [
  'follow-up',
  'follow up',
  'next phase',
  'P2',
  'TODO 后续',
  '后续跟进',
] as const;

export const EVIDENCE_STATUSES = ['pass', 'fail'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_TYPES = ['commit', 'test', 'screenshot', 'log'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** AC 证据条目 — 单条 AC 的单一证据。 */
export interface Evidence {
  /** AC 编号（如 "AC-A1"） */
  readonly acId: string;
  readonly status: EvidenceStatus;
  readonly evidenceType: EvidenceType;
  /** commit hash / test report / screenshot path / log path */
  readonly evidenceUri: string;
  readonly notes: string;
}

export const CLOSE_DECISIONS = ['immediate', 'delete', 'cvo_signoff'] as const;
export type CloseDecisionKind = (typeof CLOSE_DECISIONS)[number];

/** Close Gate 决策 — 三选一强制。 */
export interface CloseGateDecision {
  readonly decision: CloseDecisionKind;
  /** 决策者（如 "sherlock" / "operator"） */
  readonly decidedBy: string;
  readonly decidedAt: string;
  /** 决策理由（不能为空、不能含 follow-up 字样） */
  readonly rationale: string;
}

export function makeCloseGateDecision(init: {
  decision: CloseDecisionKind;
  decidedBy: string;
  rationale: string;
  decidedAt?: string;
}): CloseGateDecision {
  return {
    decision: init.decision,
    decidedBy: init.decidedBy,
    rationale: init.rationale,
    decidedAt: init.decidedAt ?? new Date().toISOString(),
  };
}

/** Phase Close Gate 验证报告。 */
export interface CloseGateReport {
  readonly phaseId: string;
  readonly passed: boolean;
  readonly decision: CloseGateDecision;
  readonly evidenceCount: number;
  readonly acPassCount: number;
  readonly acFailCount: number;
  readonly followUpViolations: string[];
  readonly errors: string[];
}

export interface MakeEvidenceInit {
  acId: string;
  status: EvidenceStatus;
  evidenceType: EvidenceType;
  evidenceUri: string;
  notes?: string;
}

export function makeEvidence(init: MakeEvidenceInit): Evidence {
  return { notes: '', ...init };
}

/**
 * Close Gate Validator — Phase A 收尾判据结构化校验。
 *
 * 职责：
 * - 注册 Evidence 形成 AC→evidence 矩阵
 * - 检查 closing_text 不含 follow-up 字样
 * - 强制 decision 三选一（由类型系统约束）
 * - 生成 CloseGateReport
 */
export class CloseGateValidator {
  private readonly followUpBlocklist: string[];
  private readonly evidences: Evidence[] = [];

  constructor(options: { followUpBlocklist?: string[] } = {}) {
    this.followUpBlocklist = options.followUpBlocklist
      ? [...options.followUpBlocklist]
      : [...DEFAULT_FOLLOW_UP_BLOCKLIST];
  }

  /** 注册一条 Evidence。 */
  registerEvidence(evidence: Evidence): void {
    this.evidences.push(evidence);
  }

  /** 按 acId 分组返回证据矩阵。 */
  getEvidenceMatrix(): Record<string, Evidence[]> {
    const matrix: Record<string, Evidence[]> = {};
    for (const ev of this.evidences) {
      (matrix[ev.acId] ??= []).push(ev);
    }
    return matrix;
  }

  /**
   * 检查文本中是否含 follow-up 字样。
   * 返回 { clean, foundTerms }：clean=true 表示未命中任何屏蔽词。
   */
  checkNoFollowUp(text: string): { clean: boolean; foundTerms: string[] } {
    if (!text) {
      return { clean: true, foundTerms: [] };
    }
    const textLower = text.toLowerCase();
    const found: string[] = [];
    for (const term of this.followUpBlocklist) {
      if (textLower.includes(term.toLowerCase())) {
        found.push(term);
      }
    }
    return { clean: found.length === 0, foundTerms: found };
  }

  /**
   * 验证决策合规性：
   * - rationale 不能为空
   * - rationale 不能含 follow-up 字样
   * （decision 三选一由 CloseDecisionKind 类型强制）
   */
  validateCloseDecision(decision: CloseGateDecision): { ok: boolean; message: string } {
    if (!decision.rationale || decision.rationale.trim().length === 0) {
      return { ok: false, message: 'rationale 不能为空' };
    }
    const { clean, foundTerms } = this.checkNoFollowUp(decision.rationale);
    if (!clean) {
      return { ok: false, message: `rationale 含 follow-up 字样: [${foundTerms.join(', ')}]` };
    }
    return { ok: true, message: 'ok' };
  }

  /** 完整 Phase A Close Gate 验证。 */
  validatePhaseClose(params: {
    phaseId: string;
    decision: CloseGateDecision;
    evidences: Evidence[];
    closingText?: string;
  }): CloseGateReport {
    const errors: string[] = [];
    const followUpViolations: string[] = [];

    // 1. 注册证据
    for (const ev of params.evidences) {
      this.registerEvidence(ev);
    }

    // 2. 验证决策
    const decisionResult = this.validateCloseDecision(params.decision);
    if (!decisionResult.ok) {
      errors.push(`decision: ${decisionResult.message}`);
    }

    // 3. 检查 closing_text
    if (params.closingText) {
      const { clean, foundTerms } = this.checkNoFollowUp(params.closingText);
      if (!clean) {
        followUpViolations.push(...foundTerms);
      }
    }

    // 4. 统计 AC pass/fail（同一 AC 任一证据 fail 即 fail）
    const matrix = this.getEvidenceMatrix();
    let acPass = 0;
    let acFail = 0;
    for (const evs of Object.values(matrix)) {
      const statuses = new Set(evs.map((e) => e.status));
      if (statuses.has('fail')) {
        acFail += 1;
      } else if (statuses.has('pass')) {
        acPass += 1;
      }
    }

    const passed =
      decisionResult.ok &&
      followUpViolations.length === 0 &&
      errors.length === 0 &&
      acFail === 0;

    return {
      phaseId: params.phaseId,
      passed,
      decision: params.decision,
      evidenceCount: params.evidences.length,
      acPassCount: acPass,
      acFailCount: acFail,
      followUpViolations,
      errors,
    };
  }
}
