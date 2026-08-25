/**
 * types — Harness Eval 控制面核心模型（对齐 Python `harness/feedback_loop.py` +
 * `evaluators/models.py` + `core/gate/models.py` + F040 契约 + clowder C32 16 域）。
 *
 * @module @flowforge/forgekin-harness-eval
 */

// ========== Harness 生命周期五态（F040 §3.1）==========

/** Harness 组件生命周期状态——增值/折旧/需要行动/瓶颈/稳定。 */
export enum HarnessLifecycleState {
  /** 增值：产出 > 摩擦 */
  APPRECIATING = 'appreciating',
  /** 折旧：摩擦 > 产出 */
  DEPRECIATING = 'depreciating',
  /** 需要行动：信号冲突或归因频发 */
  ACTION_NEEDED = 'action_needed',
  /** 成为瓶颈：持续折旧 + 阻塞其他 */
  BOTTLENECK = 'bottleneck',
  /** 稳定 */
  STABLE = 'stable',
}

/** Harness 组件状态（F040 §3.1 HarnessComponentStatus）。 */
export interface HarnessComponentStatus {
  /** 组件 ID（如 `harness:feedback_loop`、`eval:memory`） */
  readonly component_id: string;
  /** 关联 F018 Eval Contract 的 component_ref */
  readonly contract_id: string;
  /** 生命周期状态 */
  readonly lifecycle_state: HarnessLifecycleState;
  /** 增值分（产出度量，0-1） */
  readonly appreciation_score: number;
  /** 摩擦分（成本度量，0-1） */
  readonly friction_score: number;
  /** 七类归因分布（category → 次数） */
  readonly attribution_distribution: Readonly<Record<string, number>>;
  /** 最近一次派发的行动 */
  readonly last_action?: string | undefined;
  /** 更新时间戳（epoch ms） */
  readonly updated_at: number;
}

/** HarnessComponentStatus 构造入参（缺省字段可省略）。 */
export interface HarnessComponentStatusInit {
  readonly component_id: string;
  readonly contract_id: string;
  readonly appreciation_score: number;
  readonly friction_score: number;
  readonly attribution_distribution?: Readonly<Record<string, number>> | undefined;
  readonly lifecycle_state?: HarnessLifecycleState | undefined;
  readonly last_action?: string | undefined;
  readonly updated_at?: number | undefined;
}

// ========== Gate 模型（对齐 core/gate/models.py Score）==========

/** 评估维度评分（Score，value ∈ [0,1]）。 */
export interface Score {
  /** 评分维度名称 */
  readonly dimension: string;
  /** 评分值 [0,1] */
  readonly value: number;
  /** 权重 [0,1]，默认 1.0 */
  readonly weight: number;
  /** 评分理由 */
  readonly rationale: string;
  /** 改进建议 */
  readonly suggestions: readonly string[];
  /** 置信度 [0,1]，默认 1.0 */
  readonly confidence: number;
}

/** 加权分 = value × weight。 */
export function weightedScoreValue(score: Score): number {
  return score.value * score.weight;
}

// ========== Feedback Loop 模型（对齐 feedback_loop.py v6.0 枚举）==========

/** 评估模式：full = 2 LLM 调用（独立评审 + 详评）；lightweight = 1 次调用（默认）；skip = 0 次自动通过。 */
export enum EvaluationMode {
  FULL = 'full',
  LIGHTWEIGHT = 'lightweight',
  SKIP = 'skip',
}

/** 分类门输出：PASS / CONDITIONAL / FAIL。 */
export enum ClassificationGate {
  PASS = 'pass',
  CONDITIONAL = 'conditional',
  FAIL = 'fail',
}

/** 四个评估维度（v6.0）。 */
export const FEEDBACK_DIMENSIONS = ['correctness', 'completeness', 'coherence', 'safety'] as const;

/** 结构化评估结果（FeedbackResult）。 */
export interface FeedbackResult {
  /** 分类门结果 */
  readonly gate: ClassificationGate;
  /** 各维度加权平均分 */
  readonly overall_score: number;
  /** 各维度得分 */
  readonly dimension_scores: Readonly<Record<string, number>>;
  /** 识别到的问题 */
  readonly issues: readonly string[];
  /** 改进建议 */
  readonly recommendations: readonly string[];
  /** 使用的评估模式 */
  readonly mode: EvaluationMode;
  /** 实际 LLM 调用次数 */
  readonly llm_calls: number;
}

// ========== 控制面模型（F040 §3.1/§3.2）==========

/** 行动建议——由 ActionRecommender 按生命周期状态派发。 */
export interface HarnessAction {
  /** 行动 ID（如 `F012_sunset_review`） */
  readonly action: string;
  /** 目标组件 */
  readonly component_id: string;
  /** 触发原因 */
  readonly reason: string;
  /** 派发时间戳（epoch ms） */
  readonly dispatched_at: number;
}

/** 每日汇总（DailySummarizer 输出，聚合 F018/F019/F020 数据）。 */
export interface DailySummary {
  /** 汇总日期（YYYY-MM-DD） */
  readonly date: string;
  /** 各组件更新后的状态 */
  readonly components: readonly HarnessComponentStatus[];
  /** 派发的行动建议 */
  readonly actions: readonly HarnessAction[];
  /** 归因分布趋势（category → 近窗口次数） */
  readonly attribution_trend: Readonly<Record<string, number>>;
  /** 按状态分组的组件数 */
  readonly counts: Readonly<Record<HarnessLifecycleState, number>>;
}

// ========== Eval 域模型（对照 clowder C32 16 域注册）==========

/** 评估域频率：每日 / 每周 / 每 N 天。 */
export type EvalDomainFrequency = 'daily' | 'weekly' | `every-${number}d`;

/** Eval 域注册条目（对齐 clowder eval-domain-registry，裁剪平台绑定字段）。 */
export interface EvalDomainRegistryEntry {
  /** 域 ID，必须匹配 `eval:<lowercase-slug>`（如 `eval:memory`） */
  readonly domainId: string;
  /** 显示名 */
  readonly displayName: string;
  /** 一句话人类可读说明（Eval Hub 展示面） */
  readonly descriptionForHuman?: string | undefined;
  /** 评估频率 */
  readonly frequency: EvalDomainFrequency;
  /** 源适配器 slug */
  readonly sourceAdapter: string;
  /** 源引用种类 slug */
  readonly sourceRefsKind: string;
  /** 服务等级：acknowledge 小时数 */
  readonly acknowledgeHours?: number | undefined;
  /** 重新评估窗口小时数 */
  readonly reevalWithinHours?: number | undefined;
  /** 是否参与定时调度（false = 静默退役） */
  readonly enabled: boolean;
  /** 关联 Feature 编号（F###） */
  readonly featureId?: string | undefined;
}

/** 内置 16 评估域（对齐 clowder infrastructure/harness-eval 16 域清单）。 */
export const EVAL_DOMAINS_16: readonly EvalDomainRegistryEntry[] = [
  { domainId: 'eval:a2a', displayName: 'A2A 实时判定', descriptionForHuman: '跨 agent 请求/响应闭环是否真实发生', frequency: 'daily', sourceAdapter: 'a2a-trace', sourceRefsKind: 'a2a-request-response', enabled: true, featureId: 'F047' },
  { domainId: 'eval:anchor-first', displayName: '锚点优先评估', descriptionForHuman: 'agent 是否以最新锚点（非过期上下文）为行动依据', frequency: 'weekly', sourceAdapter: 'anchor-telemetry', sourceRefsKind: 'anchor-refs', enabled: true },
  { domainId: 'eval:capability-tips', displayName: '能力提示评估', descriptionForHuman: '能力提示是否在正确时机触达 agent', frequency: 'weekly', sourceAdapter: 'capability-tips', sourceRefsKind: 'tip-deliveries', enabled: true },
  { domainId: 'eval:capability-wakeup', displayName: '能力唤醒评估', descriptionForHuman: '能力唤醒是否有效打断并改变 agent 行为', frequency: 'weekly', sourceAdapter: 'capability-wakeup', sourceRefsKind: 'wakeup-events', enabled: true, featureId: 'F032' },
  { domainId: 'eval:freshness', displayName: '新鲜度评估', descriptionForHuman: '检索/记忆数据是否新鲜、是否过期', frequency: 'daily', sourceAdapter: 'freshness-replay', sourceRefsKind: 'freshness-snapshot', enabled: true },
  { domainId: 'eval:friction', displayName: '摩擦评估', descriptionForHuman: '用户与系统的摩擦点识别（取消/重试/失败）', frequency: 'daily', sourceAdapter: 'friction-signal', sourceRefsKind: 'friction-packets', enabled: true },
  { domainId: 'eval:memory', displayName: '记忆检索与库健康评估', descriptionForHuman: 'recall 找得到吗、library 健康吗', frequency: 'daily', sourceAdapter: 'memory-recall', sourceRefsKind: 'memory-recall-snapshot', enabled: true, featureId: 'F014' },
  { domainId: 'eval:sop', displayName: 'SOP 遵守评估', descriptionForHuman: '标准操作流程是否被遵守', frequency: 'weekly', sourceAdapter: 'sop-trace', sourceRefsKind: 'sop-traces', enabled: true, featureId: 'F073' },
  { domainId: 'eval:task-outcome', displayName: '任务结局评估', descriptionForHuman: '任务是否有明确结局、结局是否闭环', frequency: 'daily', sourceAdapter: 'task-outcome', sourceRefsKind: 'task-outcome-episodes', enabled: true, featureId: 'F043' },
  { domainId: 'eval:qc', displayName: 'QC 指标评估', descriptionForHuman: '质量门控指标是否达标', frequency: 'weekly', sourceAdapter: 'qc-metrics', sourceRefsKind: 'qc-metrics-snapshot', enabled: true },
  { domainId: 'eval:external-case-closure', displayName: '外部 case 闭环评估', descriptionForHuman: '外部 issue/PR 是否完整走完交付闭环', frequency: 'weekly', sourceAdapter: 'external-case', sourceRefsKind: 'external-case-refs', enabled: true },
  { domainId: 'eval:measurement', displayName: '测量包评估', descriptionForHuman: '测量包完整性/独立重判/负对照', frequency: 'weekly', sourceAdapter: 'measurement-bundle', sourceRefsKind: 'measurement-bundles', enabled: true },
  { domainId: 'eval:publish-verdict', displayName: '判定发布评估', descriptionForHuman: '评估判定是否成功发布到目标仓库', frequency: 'daily', sourceAdapter: 'publish-verdict', sourceRefsKind: 'verdict-publishes', enabled: true },
  { domainId: 'eval:hub', displayName: 'Eval Hub 读模型评估', descriptionForHuman: 'Eval Hub 读模型是否与实际事件一致', frequency: 'weekly', sourceAdapter: 'hub-projection', sourceRefsKind: 'hub-read-model', enabled: true },
  { domainId: 'eval:manual-trigger', displayName: '手动触发评估', descriptionForHuman: '手动触发链路是否可用', frequency: 'weekly', sourceAdapter: 'manual-trigger', sourceRefsKind: 'manual-triggers', enabled: true },
  { domainId: 'eval:paw-feel-disposition', displayName: '手感处置评估', descriptionForHuman: '倾向处置流程（热接收/事件日志/投影）是否健康', frequency: 'weekly', sourceAdapter: 'paw-feel', sourceRefsKind: 'paw-feel-dispositions', enabled: true },
];

/** 域 ID 校验：必须匹配 `eval:<lowercase-slug>`。 */
export function isEvalDomainId(id: string): boolean {
  return /^eval:[a-z0-9][a-z0-9-]*$/.test(id);
}
