/**
 * Mode B: Process Evolution — 同类错误反复出现时提出流程改进。
 * TS 重写自 Python `evolution/process_evolution.py`。
 *
 * 触发条件（任一，优先级从高到低）：
 * 1. Memory 中同类错误 ≥ 2 次（repeated_error）
 * 2. 用户纠正了可泛化为规则的行为（user_correction）
 * 3. SOP 执行中发现没有指引（sop_gap）
 * 4. Review 指出系统性问题（review_systemic）
 *
 * 提案流程：写提案（5 槽）→ 审批 → 落地闭环（accepted→关联 commit/PR）→ 30 天验证。
 *
 * 最小杠杆排序（从轻到重）：
 * recite_scope → memory → skill → sop → rule → system_prompt → l0
 *
 * 硬护栏：证据 ≥2 源 / 最小杠杆优先 / 先修当前再提改进 / 提案要短。
 */

import { randomUUID } from 'node:crypto';
import {
  makeEvolutionProposal,
  EvolutionProposal,
} from './models.js';

/** 最小杠杆排序：索引越小越优先（越轻）。 */
export const LEVERAGE_ORDER = [
  'recite_scope',
  'memory',
  'skill',
  'sop',
  'rule',
  'system_prompt',
  'l0',
] as const;

/** 最小证据源数量。 */
export const MIN_EVIDENCE_SOURCES = 2;

/** 系统性 review 发现。 */
export interface ReviewFinding {
  readonly systemic?: boolean;
  readonly [key: string]: unknown;
}

/** 用户纠正记录。 */
export interface UserCorrection {
  readonly generalizable?: boolean;
  readonly [key: string]: unknown;
}

export interface CreateProposalInput {
  triggerType: string;
  trigger: string;
  evidence: string[];
  rootCause: string;
  lever: string;
  verify: string;
  target?: string;
}

/** Mode B: Process Evolution — 流程改进提案管理。 */
export class ProcessEvolution {
  private readonly proposals: EvolutionProposal[] = [];

  /**
   * 检测触发条件，返回触发类型或 null。
   * 优先级：repeated_error > user_correction > sop_gap > review_systemic。
   */
  detectTrigger(params: {
    errorHistory: Record<string, unknown>[];
    userCorrections: UserCorrection[];
    sopGaps: string[];
    reviewFindings: ReviewFinding[];
  }): string | null {
    const { errorHistory, userCorrections, sopGaps, reviewFindings } = params;

    // 1. Memory 中同类错误 ≥ 2 次
    if (errorHistory.length >= 2) {
      return 'repeated_error';
    }

    // 2. 用户纠正了可泛化为规则的行为
    const generalizable = userCorrections.filter((c) => c.generalizable === true);
    if (generalizable.length > 0) {
      return 'user_correction';
    }

    // 3. SOP 执行中发现没有指引
    if (sopGaps.length > 0) {
      return 'sop_gap';
    }

    // 4. Review 指出系统性问题（非个案 bug）
    const systemic = reviewFindings.filter((f) => f.systemic === true);
    if (systemic.length > 0) {
      return 'review_systemic';
    }

    return null;
  }

  /** 创建提案（5 槽模板）。五槽：Trigger / Evidence / Root Cause / Lever / Verify。 */
  createProposal(input: CreateProposalInput): EvolutionProposal {
    if (!['repeated_error', 'user_correction', 'sop_gap', 'review_systemic'].includes(input.triggerType)) {
      throw new Error(
        `Invalid trigger_type '${input.triggerType}', must be one of repeated_error | user_correction | sop_gap | review_systemic`,
      );
    }

    const proposal = makeEvolutionProposal({
      proposalId: `pe-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      triggerType: input.triggerType,
      target: input.target && input.target.length > 0 ? input.target : input.lever,
      trigger: input.trigger,
      evidence: [...input.evidence],
      rootCause: input.rootCause,
      lever: input.lever,
      verify: input.verify,
    });
    this.proposals.push(proposal);
    return proposal;
  }

  /**
   * 验证提案（硬护栏检查）。
   *
   * 硬护栏：1. 证据 ≥2 源；2. 五槽均非空；3. trigger_type 合法；4. lever 在最小杠杆排序中。
   */
  validateProposal(proposal: EvolutionProposal): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. 证据 ≥2 源
    if (proposal.evidence.length < MIN_EVIDENCE_SOURCES) {
      errors.push(
        `evidence sources ${proposal.evidence.length} < minimum ${MIN_EVIDENCE_SOURCES}`,
      );
    }

    // 2. 五槽均非空（Trigger/Evidence/RootCause/Lever/Verify，Evidence 由护栏 1 覆盖）
    const slots: Array<[string, string]> = [
      ['trigger', proposal.trigger],
      ['root_cause', proposal.rootCause],
      ['lever', proposal.lever],
      ['verify', proposal.verify],
    ];
    for (const [slotName, slotVal] of slots) {
      if (!slotVal || slotVal.trim().length === 0) {
        errors.push(`slot '${slotName}' is empty`);
      }
    }

    // 3. trigger_type 合法
    if (!['repeated_error', 'user_correction', 'sop_gap', 'review_systemic'].includes(proposal.triggerType)) {
      errors.push(`invalid trigger_type '${proposal.triggerType}'`);
    }

    // 4. lever 在最小杠杆排序中
    if (!(LEVERAGE_ORDER as readonly string[]).includes(proposal.lever)) {
      errors.push(`lever '${proposal.lever}' not in leverage order [${LEVERAGE_ORDER.join(', ')}]`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 最小杠杆排序 — 返回最轻（索引最小）的杠杆。
   * 若无匹配，返回最重的 "l0"。
   */
  getMinimalLeverage(targetOptions: string[]): string {
    if (targetOptions.length === 0) {
      return 'l0';
    }
    const order = LEVERAGE_ORDER as readonly string[];
    const ranked = [...targetOptions].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
    return ranked[0] ?? 'l0';
  }

  /**
   * 接受提案并关联 commit/PR。
   * accepted → 必须关联 commit/PR（硬护栏：落地闭环）。
   */
  acceptProposal(proposalId: string, commitRef: string): EvolutionProposal | null {
    if (!commitRef || commitRef.trim().length === 0) {
      throw new Error('commit_ref is required to accept a proposal (落地闭环硬护栏)');
    }

    const proposal = this.proposals.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      return null;
    }
    if (proposal.status !== 'proposed') {
      return null;
    }

    const accepted: EvolutionProposal = {
      ...proposal,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      commitRef,
    };
    const index = this.proposals.indexOf(proposal);
    this.proposals[index] = accepted;
    return accepted;
  }

  /** 安排 N 天后的 replay check（默认 30 天）。 */
  scheduleReplayCheck(proposalId: string, days = 30): string | null {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      return null;
    }
    const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const index = this.proposals.indexOf(proposal);
    this.proposals[index] = { ...proposal, replayCheckDue: due };
    return due;
  }

  /** 获取提案列表（副本），可按 status 过滤。 */
  getProposals(status?: string): EvolutionProposal[] {
    const list = status === undefined
      ? [...this.proposals]
      : this.proposals.filter((p) => p.status === status);
    return list;
  }

  /** 获取已到期的 replay check 提案（accepted 且 replay_check_due ≤ now）。 */
  getDueReplayChecks(now = new Date()): EvolutionProposal[] {
    return this.proposals.filter(
      (p) =>
        p.replayCheckDue !== null &&
        Date.parse(p.replayCheckDue) <= now.getTime() &&
        p.status === 'accepted',
    );
  }
}
