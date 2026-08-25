/**
 * @flowforge/cats-teamact — T7.17 HandoffCapsule 交接胶囊（roleagent.md §2.3）。
 *
 * TS 重写自 `core/teamact/handoff.py`：
 * 交接胶囊是 TeamAct 协作协议的协议层硬要求（不是可选的礼貌行为）。
 * 前一个 Forgekin 在传球时主动留下结构化摘要：做了什么/为什么/权衡了什么/
 * 开放问题/下一步，让后一个 Forgekin 接手时不需要重读全部上下文。
 *
 * @module @flowforge/cats-teamact
 */

import { randomUUID } from 'node:crypto';

/** 交接胶囊 — Forgekin 间协作的结构化交接摘要（F002 AC-3 契约）。 */
export interface HandoffCapsuleOptions {
  /** 传出 Forgekin 标识。 */
  fromAgent: string;
  /** 接收 Forgekin 标识。 */
  toAgent: string;
  /** 任务摘要（做了什么）。 */
  taskSummary: string;
  /** 设计理由（为什么这样做，F002 AC-3）。 */
  rationale?: string | undefined;
  /** 取舍说明（权衡了什么，F002 AC-3）。 */
  tradeoffs?: string | undefined;
  /** 已做决策列表。 */
  decisionsMade?: string[] | undefined;
  /** 开放问题列表（须 resolved 或升级，对应终止条件 4）。 */
  openQuestions?: string[] | undefined;
  /** 下一步该做什么。 */
  nextStep: string;
  /** 上下文快照（关键状态键值对，便于接手者快速恢复）。 */
  contextSnapshot?: Record<string, unknown> | undefined;
  /** 胶囊唯一标识（缺省自动生成 capsule-{uuid12}）。 */
  capsuleId?: string | undefined;
  /** 胶囊创建时间（缺省当前 UTC 时间）。 */
  createdAt?: Date | undefined;
}

/** 交接胶囊 — Forgekin 间协作的结构化交接摘要。 */
export class HandoffCapsule {
  readonly capsuleId: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly taskSummary: string;
  readonly rationale: string;
  readonly tradeoffs: string;
  readonly decisionsMade: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextStep: string;
  readonly contextSnapshot: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;

  constructor(options: HandoffCapsuleOptions) {
    this.capsuleId = options.capsuleId ?? `capsule-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    this.fromAgent = options.fromAgent;
    this.toAgent = options.toAgent;
    this.taskSummary = options.taskSummary;
    this.rationale = options.rationale ?? '';
    this.tradeoffs = options.tradeoffs ?? '';
    this.decisionsMade = options.decisionsMade ?? [];
    this.openQuestions = options.openQuestions ?? [];
    this.nextStep = options.nextStep;
    this.contextSnapshot = options.contextSnapshot ?? {};
    this.createdAt = options.createdAt ?? new Date();
  }

  /** 生成人类可读摘要（用于 trace 日志/operator 展示/MindCouncil 议事）。 */
  toSummary(): string {
    const decisions = this.decisionsMade.join(', ') || '(none)';
    const questions = this.openQuestions.join(', ') || '(none)';
    return (
      `HandoffCapsule[${this.capsuleId}] ` +
      `${this.fromAgent} → ${this.toAgent} | ` +
      `summary: ${this.taskSummary} | ` +
      `decisions: [${decisions}] | ` +
      `open_questions: [${questions}] | ` +
      `next_step: ${this.nextStep}`
    );
  }

  /**
   * 校验胶囊完整性（协议层硬要求）：
   *   - from/to agent 非空（有明确路由）
   *   - taskSummary / nextStep 非空
   *   - toAgent != fromAgent（不能自己交给自己）
   */
  isValid(): boolean {
    if (!this.fromAgent || !this.toAgent) {
      return false;
    }
    if (!this.taskSummary || !this.nextStep) {
      return false;
    }
    if (this.fromAgent === this.toAgent) {
      return false;
    }
    return true;
  }
}

/** 便捷构造器（缺省生成 capsuleId / createdAt）。 */
export function newHandoffCapsule(options: HandoffCapsuleOptions): HandoffCapsule {
  return new HandoffCapsule(options);
}
