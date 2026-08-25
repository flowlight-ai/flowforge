/**
 * @flowforge/cats-teamact — T7.17 TeamActState 六步循环状态机 + TerminationReport（F002 §2）。
 *
 * TS 重写自 `core/teamact/state_machine.py`：
 *   - HistoryEntry: 每次 advance/pass_ball/escalate 追加一条历史记录
 *   - TerminationReport: 五项终止条件报告（缺一不可）
 *   - TeamActState: 六步循环状态机（STATE→OWNER→ACTION→EVIDENCE→VERDICT→ROUTE）
 *
 * 关键不变量（F002 §2.3）：
 *   1. TeamAct 状态必须持久化（Durable State Surfaces, F008）
 *   2. 交接胶囊是协议层硬要求（不是可选礼貌）
 *   3. 跨厂商 review 不能被 proxy 替代（"CI 通过"≠"愿景对齐"）
 *   4. 五项终止条件缺一不可
 *
 * @module @flowforge/cats-teamact
 */

import { BallStatus, TeamActStep, TerminationCondition } from './types.js';
import { HandoffCapsule } from './handoff.js';

/** 首席愿景官标识（CVO = Chief Vision Officer）。 */
export const CVO_AGENT_ID = 'cvo';

/** TeamAct 历史记录条目。 */
export interface HistoryEntryOptions {
  /** 记录时的 TeamAct 步骤。 */
  step: TeamActStep;
  /** 执行的动作描述。 */
  action?: string | undefined;
  /** 产出证据（commit/测试/trace ID）。 */
  evidence?: string | undefined;
  /** 执行该动作的 Forgekin 标识（可选）。 */
  agent?: string | null | undefined;
  /** 记录时的持球状态（缺省 HELD）。 */
  ballStatus?: BallStatus | undefined;
  /** 记录时间（缺省当前 UTC 时间）。 */
  timestamp?: Date | undefined;
}

/** TeamAct 历史记录条目。 */
export class HistoryEntry {
  readonly step: TeamActStep;
  readonly action: string;
  readonly evidence: string;
  readonly agent: string | null;
  readonly ballStatus: BallStatus;
  readonly timestamp: Date;

  constructor(options: HistoryEntryOptions) {
    this.step = options.step;
    this.action = options.action ?? '';
    this.evidence = options.evidence ?? '';
    this.agent = options.agent ?? null;
    this.ballStatus = options.ballStatus ?? BallStatus.HELD;
    this.timestamp = options.timestamp ?? new Date();
  }
}

/** 五项终止条件报告（roleagent.md §2.2，缺一不可）。 */
export class TerminationReport {
  /** 验收标准全部达成（不能有 deferred）。 */
  acceptanceDone = false;
  /** 证据已附（每条验收都有 commit/测试/trace）。 */
  evidenceAttached = false;
  /** 跨 agent 交叉验证（不能自己 review 自己）。 */
  crossValidated = false;
  /** 无悬空任务归属（所有 open question 已 resolved 或升级）。 */
  noDanglingOwnership = false;
  /** 愿景收敛（CVO 确认不能被 proxy 替代）。 */
  visionConverged = false;

  /** 检查五项终止条件是否全部满足（缺一不可）。 */
  isTerminated(): boolean {
    return (
      this.acceptanceDone &&
      this.evidenceAttached &&
      this.crossValidated &&
      this.noDanglingOwnership &&
      this.visionConverged
    );
  }

  /** 返回已满足的终止条件列表。 */
  metConditions(): TerminationCondition[] {
    return TerminationCondition.all().filter((c) => this.isMet(c));
  }

  /** 返回未满足的终止条件列表（用于报告缺失项）。 */
  missingConditions(): TerminationCondition[] {
    return TerminationCondition.all().filter((c) => !this.isMet(c));
  }

  /** 检查指定终止条件是否满足。 */
  isMet(condition: TerminationCondition): boolean {
    switch (condition) {
      case TerminationCondition.ACCEPTANCE_DONE:
        return this.acceptanceDone;
      case TerminationCondition.EVIDENCE_ATTACHED:
        return this.evidenceAttached;
      case TerminationCondition.CROSS_VALIDATED:
        return this.crossValidated;
      case TerminationCondition.NO_DANGLING_OWNERSHIP:
        return this.noDanglingOwnership;
      case TerminationCondition.VISION_CONVERGED:
        return this.visionConverged;
    }
  }

  /** 标记指定终止条件的状态。 */
  mark(condition: TerminationCondition, met = true): void {
    switch (condition) {
      case TerminationCondition.ACCEPTANCE_DONE:
        this.acceptanceDone = met;
        break;
      case TerminationCondition.EVIDENCE_ATTACHED:
        this.evidenceAttached = met;
        break;
      case TerminationCondition.CROSS_VALIDATED:
        this.crossValidated = met;
        break;
      case TerminationCondition.NO_DANGLING_OWNERSHIP:
        this.noDanglingOwnership = met;
        break;
      case TerminationCondition.VISION_CONVERGED:
        this.visionConverged = met;
        break;
    }
  }

  /** 生成终止报告摘要。 */
  toSummary(): string {
    const missing = this.missingConditions();
    const status = this.isTerminated() ? 'TERMINATED' : 'NOT_TERMINATED';
    const missingStr = missing.length > 0 ? missing.map((c) => c.valueOf()).join(', ') : '(none)';
    return (
      `TerminationReport[${status}] ` +
      `acceptance=${this.acceptanceDone} ` +
      `evidence=${this.evidenceAttached} ` +
      `cross_validated=${this.crossValidated} ` +
      `no_dangling=${this.noDanglingOwnership} ` +
      `vision=${this.visionConverged} ` +
      `missing=[${missingStr}]`
    );
  }
}

/** TeamActState 构造选项。 */
export interface TeamActStateOptions {
  /** 当前任务标识（必填）。 */
  taskId: string;
  /** 当前 TeamAct 步骤（缺省 STATE）。 */
  currentStep?: TeamActStep | undefined;
  /** 当前持球 Forgekin 标识（缺省 null 表示无人持球）。 */
  ballHolder?: string | null | undefined;
  /** 历史记录列表（缺省空）。 */
  history?: HistoryEntry[] | undefined;
  /** 交接胶囊列表（协议层硬要求，缺省空）。 */
  capsules?: HandoffCapsule[] | undefined;
  /** 五项终止条件报告（缺省新建）。 */
  terminationStatus?: TerminationReport | undefined;
  /** 当前持球状态（缺省 HELD）。 */
  ballStatus?: BallStatus | undefined;
  /** 循环轮数（缺省 0）。 */
  iteration?: number | undefined;
}

/** TeamAct 六步循环状态机（roleagent.md §2.1）。 */
export class TeamActState {
  currentStep: TeamActStep;
  readonly taskId: string;
  ballHolder: string | null;
  readonly history: HistoryEntry[];
  readonly capsules: HandoffCapsule[];
  terminationStatus: TerminationReport;
  ballStatus: BallStatus;
  iteration: number;

  constructor(options: TeamActStateOptions) {
    this.currentStep = options.currentStep ?? TeamActStep.STATE;
    this.taskId = options.taskId;
    this.ballHolder = options.ballHolder ?? null;
    this.history = options.history ?? [];
    this.capsules = options.capsules ?? [];
    this.terminationStatus = options.terminationStatus ?? new TerminationReport();
    this.ballStatus = options.ballStatus ?? BallStatus.HELD;
    this.iteration = options.iteration ?? 0;
  }

  // ── 状态推进 ──────────────────────────────────────────────────

  /**
   * 推进到下一步。
   *
   * 记录当前步骤的 action/evidence 到 history，然后将 currentStep 推进到
   * 六步循环的下一步；当从 ROUTE 推进到 STATE 时 iteration +1（完成一轮）。
   */
  advance(action = '', evidence = ''): TeamActStep {
    this.history.push(
      new HistoryEntry({
        step: this.currentStep,
        action,
        evidence,
        agent: this.ballHolder,
        ballStatus: this.ballStatus,
      }),
    );

    // 如果在 EVIDENCE 步骤产出了证据，标记 evidence_attached
    if (this.currentStep === TeamActStep.EVIDENCE && evidence) {
      this.terminationStatus.evidenceAttached = true;
    }

    const prevStep = this.currentStep;
    this.currentStep = TeamActStep.next(this.currentStep);

    // ROUTE → STATE 表示完成一轮循环
    if (prevStep === TeamActStep.ROUTE) {
      this.iteration += 1;
    }

    return this.currentStep;
  }

  // ── 终止检查 ──────────────────────────────────────────────────

  /**
   * 检查五项终止条件。
   *
   * 可自动推导：evidence_attached（history 存在非空 evidence）、
   * no_dangling_ownership（所有胶囊 open_questions 均为空且至少有一个胶囊）。
   * 需显式标记：acceptance_done / cross_validated / vision_converged。
   */
  checkTermination(): TerminationReport {
    const hasEvidence = this.history.some((entry) => entry.evidence !== '');
    if (hasEvidence) {
      this.terminationStatus.evidenceAttached = true;
    }
    if (this.capsules.length > 0) {
      const allResolved = this.capsules.every((cap) => cap.openQuestions.length === 0);
      if (allResolved) {
        this.terminationStatus.noDanglingOwnership = true;
      }
    }
    return this.terminationStatus;
  }

  /** 快捷方法：检查是否已终止。 */
  isTerminated(): boolean {
    return this.terminationStatus.isTerminated();
  }

  /** 标记单个终止条件的状态（显式标记需人工/外部判断的条件）。 */
  markTermination(condition: TerminationCondition, met = true): void {
    this.terminationStatus.mark(condition, met);
  }

  // ── 传球 ─────────────────────────────────────────────────────

  /**
   * 传球 — 将球权转交给下一个 Forgekin。
   *
   * 交接胶囊是协议层硬要求（roleagent.md §2.3），传球时必须附带胶囊；
   * 胶囊的 toAgent 必须与 toAgent 参数一致，且必须通过 isValid() 校验。
   */
  passBall(toAgent: string, capsule: HandoffCapsule): boolean {
    if (!capsule.isValid()) {
      return false;
    }
    if (capsule.toAgent !== toAgent) {
      return false;
    }

    this.capsules.push(capsule);

    const prevHolder = this.ballHolder;
    this.ballHolder = toAgent;
    this.ballStatus = BallStatus.PASSED;

    this.history.push(
      new HistoryEntry({
        step: this.currentStep,
        action: `pass_ball: ${prevHolder ?? '(none)'} → ${toAgent}`,
        evidence: capsule.capsuleId,
        agent: prevHolder,
        ballStatus: BallStatus.PASSED,
      }),
    );
    return true;
  }

  // ── 升级 ─────────────────────────────────────────────────────

  /**
   * 升级给首席愿景官（CVO）。
   *
   * CVO 的确认是五项终止条件之一（vision_converged），不能被 proxy 替代
   * （roleagent.md §2.2 第 5 项）。toCvo=false 时升级给 operator。
   */
  escalate(toCvo = true): void {
    const target = toCvo ? CVO_AGENT_ID : 'operator';
    const prevHolder = this.ballHolder;
    this.ballHolder = target;
    this.ballStatus = BallStatus.ESCALATED;

    this.history.push(
      new HistoryEntry({
        step: this.currentStep,
        action: `escalate: ${prevHolder ?? '(none)'} → ${target}`,
        evidence: '',
        agent: prevHolder,
        ballStatus: BallStatus.ESCALATED,
      }),
    );
  }

  // ── 摘要 ─────────────────────────────────────────────────────

  /** 生成状态机摘要。 */
  toSummary(): string {
    return (
      `TeamActState[task=${this.taskId}] ` +
      `step=${this.currentStep.valueOf()} ` +
      `holder=${this.ballHolder ?? '(none)'} ` +
      `ball=${this.ballStatus.valueOf()} ` +
      `iter=${this.iteration} ` +
      `capsules=${this.capsules.length} ` +
      `history=${this.history.length} ` +
      `terminated=${this.isTerminated()}`
    );
  }

  /** 收集所有胶囊中的开放问题（用于检查 no_dangling_ownership）。 */
  getOpenQuestions(): string[] {
    return this.capsules.flatMap((cap) => [...cap.openQuestions]);
  }

  /** 检查历史中是否存在证据。 */
  hasEvidence(): boolean {
    return this.history.some((entry) => entry.evidence !== '');
  }

  /** 转为可序列化对象（用于持久化/API 响应）。 */
  toJSON(): Record<string, unknown> {
    return {
      currentStep: this.currentStep.valueOf(),
      taskId: this.taskId,
      ballHolder: this.ballHolder,
      history: this.history.map((entry) => ({
        step: entry.step.valueOf(),
        action: entry.action,
        evidence: entry.evidence,
        agent: entry.agent,
        ballStatus: entry.ballStatus.valueOf(),
        timestamp: entry.timestamp.toISOString(),
      })),
      capsules: this.capsules.map((cap) => ({
        capsuleId: cap.capsuleId,
        fromAgent: cap.fromAgent,
        toAgent: cap.toAgent,
        taskSummary: cap.taskSummary,
        rationale: cap.rationale,
        tradeoffs: cap.tradeoffs,
        decisionsMade: [...cap.decisionsMade],
        openQuestions: [...cap.openQuestions],
        nextStep: cap.nextStep,
        contextSnapshot: cap.contextSnapshot,
        createdAt: cap.createdAt.toISOString(),
      })),
      terminationStatus: {
        acceptanceDone: this.terminationStatus.acceptanceDone,
        evidenceAttached: this.terminationStatus.evidenceAttached,
        crossValidated: this.terminationStatus.crossValidated,
        noDanglingOwnership: this.terminationStatus.noDanglingOwnership,
        visionConverged: this.terminationStatus.visionConverged,
      },
      ballStatus: this.ballStatus.valueOf(),
      iteration: this.iteration,
    };
  }
}
