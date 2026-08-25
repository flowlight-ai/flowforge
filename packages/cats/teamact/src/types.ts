/**
 * @flowforge/cats-teamact — T7.17 TeamAct 类型定义（F002 §2.1 + roleagent.md §2）。
 *
 * TS 重写自 `core/teamact/types.py`：
 *   - TeamActStep: 六步循环状态（STATE→OWNER→ACTION→EVIDENCE→VERDICT→ROUTE）
 *   - TerminationCondition: 五项终止条件（缺一不可）
 *   - BallStatus: 持球状态（持球/已传/释放/升级）
 *
 * @module @flowforge/cats-teamact
 */

/** TeamAct 六步循环状态（roleagent.md §2.1 团队主循环）。 */
export enum TeamActStep {
  /** 读共享状态（仓库/spec/任务/记忆/交接胶囊）。 */
  STATE = 'state',
  /** 谁持球？（路由指令/显式持有声明）。 */
  OWNER = 'owner',
  /** 持球者执行（写代码/review/设计/调研）。 */
  ACTION = 'action',
  /** 产出证据（commit/测试/trace/截图）。 */
  EVIDENCE = 'evidence',
  /** 验证（跨 agent review/自检/CVO 确认）。 */
  VERDICT = 'verdict',
  /** 传球（路由给下一个 agent/继续持有/升级给 CVO）。 */
  ROUTE = 'route',
}

export namespace TeamActStep {
  /** 返回六步循环的有序列表。 */
  export function ordered(): readonly TeamActStep[] {
    return [
      TeamActStep.STATE,
      TeamActStep.OWNER,
      TeamActStep.ACTION,
      TeamActStep.EVIDENCE,
      TeamActStep.VERDICT,
      TeamActStep.ROUTE,
    ];
  }

  /** 返回下一步（ROUTE 之后循环回 STATE）。 */
  export function next(step: TeamActStep): TeamActStep {
    const order = ordered();
    const idx = order.indexOf(step);
    return order[(idx + 1) % order.length]!;
  }
}

/** 五项终止条件（roleagent.md §2.2，缺一不可）。 */
export enum TerminationCondition {
  /** 验收标准全部达成（不能有 deferred）。 */
  ACCEPTANCE_DONE = 'acceptance_done',
  /** 证据已附（每条验收都有 commit/测试/trace）。 */
  EVIDENCE_ATTACHED = 'evidence_attached',
  /** 跨 agent 交叉验证（不能自己 review 自己）。 */
  CROSS_VALIDATED = 'cross_validated',
  /** 无悬空任务归属（所有 open question 已 resolved 或升级）。 */
  NO_DANGLING_OWNERSHIP = 'no_dangling_ownership',
  /** 愿景收敛（CVO 确认不能被 proxy 替代）。 */
  VISION_CONVERGED = 'vision_converged',
}

export namespace TerminationCondition {
  /** 返回五项终止条件的完整列表。 */
  export function all(): readonly TerminationCondition[] {
    return [
      TerminationCondition.ACCEPTANCE_DONE,
      TerminationCondition.EVIDENCE_ATTACHED,
      TerminationCondition.CROSS_VALIDATED,
      TerminationCondition.NO_DANGLING_OWNERSHIP,
      TerminationCondition.VISION_CONVERGED,
    ];
  }
}

/** 持球状态（描述 Forgekin 在 TeamAct 循环中的持球状态）。 */
export enum BallStatus {
  /** 当前持球（执行中）。 */
  HELD = 'held',
  /** 已传球（球已转交给下一个 Forgekin）。 */
  PASSED = 'passed',
  /** 已释放（任务完成，主动释放球权）。 */
  RELEASED = 'released',
  /** 已升级（升级给首席愿景官 CVO）。 */
  ESCALATED = 'escalated',
}
