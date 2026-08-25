/**
 * types — Harness 七层公共类型（roleagent.md §3.2 / harness.yaml）。
 *
 * 七层工程路径：
 *   1. 感知现实（Durable State Surfaces，F008）
 *   2. 改变现实（Tool Mediation）
 *   3. 验证现实（Evidence & Sensors，F009）
 *   4. 约束现实（Governance Boundary，F010）
 *   5. 人机边界（Magic Words 逃生舱，已交付 forgekin/magic-words）
 *   6. 清理现实（Entropy Control 退役，FR-HRN-04）
 *   7. 适配现实（Harnessability 评估）
 *
 * @module @flowforge/forgekin-harness
 */

/** Harness 七层枚举（对应 harness.yaml 分层）。 */
export enum HarnessLayer {
  DURABLE_STATE = 'durable_state',
  TOOL_MEDIATION = 'tool_mediation',
  EVIDENCE = 'evidence',
  GOVERNANCE = 'governance',
  MAGIC_WORDS = 'magic_words',
  ENTROPY = 'entropy',
  HARNESSABILITY = 'harnessability',
}

/** Harness 七层中文名（用于评估/汇总报告）。 */
export const HARNESS_LAYER_NAMES: Readonly<Record<HarnessLayer, string>> = {
  [HarnessLayer.DURABLE_STATE]: '感知现实',
  [HarnessLayer.TOOL_MEDIATION]: '改变现实',
  [HarnessLayer.EVIDENCE]: '验证现实',
  [HarnessLayer.GOVERNANCE]: '约束现实',
  [HarnessLayer.MAGIC_WORDS]: '人机边界',
  [HarnessLayer.ENTROPY]: '清理现实',
  [HarnessLayer.HARNESSABILITY]: '适配现实',
};

/** Harness 服务整体配置（对齐 harness.yaml 各层配置）。 */
export interface HarnessOptions {
  /** Layer1：默认后端（sqlite / git）。 */
  readonly durableStateBackend?: 'sqlite' | 'git' | undefined;
  /** Layer1：SQLite 数据库路径（默认 `data/harness_v7_state.db`）。 */
  readonly durableStateDbPath?: string | undefined;
  /** Layer1：Git 仓库路径（默认 `data/harness_v7_state_repo`）。 */
  readonly durableStateRepoPath?: string | undefined;
  /** Layer2：危险工具是否需要确认（默认 true）。 */
  readonly dangerousRequiresConfirm?: boolean | undefined;
  /** Layer2：附加工具白名单（追加到内置 5 工具）。 */
  readonly extraToolDescriptors?: readonly import('./tool-mediation.js').ToolDescriptor[] | undefined;
  /** Layer2：附加工具别名。 */
  readonly extraToolAliases?: Readonly<Record<string, string>> | undefined;
  /** Layer3：证据保留期（天，默认 90）。 */
  readonly evidenceRetentionDays?: number | undefined;
  /** Layer3：哈希算法（默认 sha256）。 */
  readonly evidenceHashAlgorithm?: string | undefined;
  /** Layer3：自动验证开关（默认 true）。 */
  readonly evidenceAutoVerify?: boolean | undefined;
  /** Layer4：关键规则优先级阈值（默认 90）。 */
  readonly criticalPriorityThreshold?: number | undefined;
  /** Layer4：附加治理规则（追加到内置规则集）。 */
  readonly extraGovernanceRules?: readonly import('./governance.js').GovernanceRule[] | undefined;
  /** Layer6：组件开关。 */
  readonly entropy?: Readonly<{
    docGardenerEnabled?: boolean | undefined;
    debtTrackerEnabled?: boolean | undefined;
    ruleEvolutionEnabled?: boolean | undefined;
    docStaleThreshold?: number | undefined;
    highDebtThreshold?: number | undefined;
  }> | undefined;
  /** Layer7：harnessability 评估阈值（默认 0.85）。 */
  readonly harnessabilityThreshold?: number | undefined;
  /** Layer7：评估周期（小时，默认 24）。 */
  readonly harnessabilityIntervalHours?: number | undefined;
}
