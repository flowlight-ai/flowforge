/**
 * @flowforge/forgekin-capability — 阶段7 T7.2 能力画像数据模型
 *
 * 本地化自 flowforge Python `core/capability/models.py`：
 * CapabilityProfile 六维度（roleagent.md §0 三个可变性层）：
 * - 常量层：ModelCapability / CognitiveStyle / BlindSpot
 * - 变量层：SkillPackage / ToolBoundary
 * - 积累层：PerformanceLog
 * - 瞬时层：AgentState
 * - 契合度层：HarnessFitScore
 *
 * @module @flowforge/forgekin-capability/models
 */

/** 模型固有能力（常量层）——底层 LLM 厂商与模型的固有属性，跨 session 不变 */
export interface ModelCapability {
  /** 模型厂商标识（anthropic / openai / google / deepseek / ...）——跨厂商 review 配对的厂商判别 */
  provider: string;
  /** 模型名称（如 claude-sonnet-4 / gpt-5 / gemini-2-pro） */
  modelName: string;
  /** 上下文窗口大小（token 数，>0） */
  contextWindow: number;
  /** 模型擅长能力列表 */
  strengths: string[];
  /** 模型已知能力限制列表 */
  limitations: string[];
  /** 是否原生支持工具调用 */
  supportsToolCall: boolean;
  /** 是否支持多模态视觉输入 */
  supportsVision: boolean;
  /** 推理能力评分（0.0-1.0） */
  reasoningCapability: number;
  /** 创造力评分（0.0-1.0） */
  creativityCapability: number;
}

export function makeModelCapability(init: Omit<ModelCapability, 'supportsToolCall' | 'supportsVision' | 'reasoningCapability' | 'creativityCapability'> & Partial<Pick<ModelCapability, 'supportsToolCall' | 'supportsVision' | 'reasoningCapability' | 'creativityCapability'>>): ModelCapability {
  if (init.contextWindow <= 0) throw new Error('context_window 必须大于 0');
  return {
    supportsToolCall: true,
    supportsVision: false,
    reasoningCapability: 0.5,
    creativityCapability: 0.5,
    ...init,
  };
}

/** 解释风格枚举 */
export const EXPLANATION_STYLES = ['structured', 'narrative', 'concise', 'verbose'] as const;
export type ExplanationStyle = (typeof EXPLANATION_STYLES)[number];

/** 认知风格（常量层）——推理/抽象/风险/解释四维认知偏好 */
export interface CognitiveStyle {
  /** 推理深度倾向（0.0 浅层直觉 → 1.0 深度链式推理） */
  reasoningDepth: number;
  /** 抽象层级偏好（0.0 具体实例 → 1.0 抽象建模） */
  abstractionLevel: number;
  /** 风险偏好（0.0 保守稳健 → 1.0 激进尝试） */
  riskAppetite: number;
  /** 解释风格枚举 */
  explanationStyle: ExplanationStyle;
}

export function makeCognitiveStyle(init?: Partial<CognitiveStyle>): CognitiveStyle {
  const style: CognitiveStyle = {
    reasoningDepth: 0.5,
    abstractionLevel: 0.5,
    riskAppetite: 0.5,
    explanationStyle: 'structured',
    ...init,
  };
  if (!EXPLANATION_STYLES.includes(style.explanationStyle)) {
    throw new Error(`explanation_style must be one of ${EXPLANATION_STYLES.join(', ')}, got '${style.explanationStyle}'`);
  }
  return style;
}

/** 盲点类别枚举（同类别盲点 + 同厂商 → 冲突 → 必须跨厂商 review） */
export const BLIND_SPOT_CATEGORIES = [
  'self_referential_logic',
  'math_computation',
  'temporal_reasoning',
  'spatial_reasoning',
  'counterfactual',
  'edge_case_blindness',
  'hallucination_prone',
  'over_confidence',
  'context_compression_loss',
  'other',
] as const;
export type BlindSpotCategory = (typeof BLIND_SPOT_CATEGORIES)[number];

/** 盲点（半常量层）——能力画像不是简历，必须写盲点 */
export interface BlindSpot {
  /** 盲点类别（用于跨厂商 review 配对） */
  category: BlindSpotCategory;
  /** 盲点描述 */
  description: string;
  /** 触发盲点的示例 */
  example?: string;
  /** 该盲点最容易暴露的场景（如 code_review / math_proof） */
  scenario?: string;
  /** 检测时间（ISO 8601） */
  detectedAt: string;
  /** 证据 trace ID 列表（Eval 信号） */
  evidence: string[];
  /** 补偿策略（缺省跨厂商 review） */
  compensationStrategy: string;
  /** 置信度（0.0-1.0） */
  confidence: number;
}

export function makeBlindSpot(init: Pick<BlindSpot, 'category' | 'description'> & Partial<Omit<BlindSpot, 'category' | 'description'>>): BlindSpot {
  return {
    detectedAt: new Date().toISOString(),
    evidence: [],
    compensationStrategy: 'cross_vendor_review',
    confidence: 0.5,
    ...init,
  };
}

/** 可加载知识包（变量层）——L3 Skill 层 */
export interface SkillPackage {
  /** 知识包名称（唯一标识） */
  name: string;
  /** 所属领域（如 programming / finance / medicine） */
  domain: string;
  /** 知识包版本 */
  version: string;
  /** 加载器标识（如模块路径） */
  loader?: string;
  /** 熟练度（0.0-1.0） */
  proficiency: number;
  /** 上次使用时间 ISO 8601（undefined 表示未使用过） */
  lastUsed?: string;
  /** 累计使用次数 */
  usageCount: number;
}

export function makeSkillPackage(init: Pick<SkillPackage, 'name' | 'domain'> & Partial<Omit<SkillPackage, 'name' | 'domain'>>): SkillPackage {
  return {
    version: '0.1.0',
    proficiency: 0.5,
    usageCount: 0,
    ...init,
  };
}

/** 工具边界（变量层）——允许/禁止/偏好集合 */
export interface ToolBoundary {
  /** 允许调用的工具列表（白名单） */
  allowedTools: string[];
  /** 禁止调用的工具列表（黑名单，优先级高于白名单） */
  forbiddenTools: string[];
  /** 优先使用的工具列表（同等条件下优先选择） */
  preferTools: string[];
  /** 工具熟练度映射 {tool_name: proficiency 0.0-1.0} */
  toolProficiency: Record<string, number>;
}

export function makeToolBoundary(init?: Partial<ToolBoundary>): ToolBoundary {
  return {
    allowedTools: [],
    forbiddenTools: [],
    preferTools: [],
    toolProficiency: {},
    ...init,
  };
}

/** 历史表现日志条目（积累层）——单调积累，不可回退 */
export interface PerformanceLog {
  /** 任务类型（如 code_generation / article_writing / review） */
  taskType: string;
  /** 成功率（0.0-1.0） */
  successRate: number;
  /** 平均延迟（秒） */
  avgLatency: number;
  /** 累计 token 消耗 */
  tokenUsage: number;
  /** 最后更新时间 ISO 8601 */
  lastUpdated: string;
  /** 样本数（用于 Wilson 下界可靠性判断） */
  sampleCount: number;
  /** Wilson 下界（小样本可靠性，0.0-1.0） */
  wilsonLowerBound: number;
}

export function makePerformanceLog(init: Pick<PerformanceLog, 'taskType'> & Partial<Omit<PerformanceLog, 'taskType'>>): PerformanceLog {
  return {
    successRate: 0,
    avgLatency: 0,
    tokenUsage: 0,
    lastUpdated: new Date().toISOString(),
    sampleCount: 0,
    wilsonLowerBound: 0,
    ...init,
  };
}

/** 情绪标签枚举 */
export const MOODS = ['focused', 'tired', 'stressed', 'fresh', 'neutral'] as const;
export type Mood = (typeof MOODS)[number];

/** Forgekin 当前状态（瞬时层）——单 session 内可变 */
export interface AgentState {
  /** 当前负载（0.0 空闲 → 1.0 满载） */
  currentLoad: number;
  /** 疲劳度（0.0 清醒 → 1.0 极度疲劳） */
  fatigue: number;
  /** 当前情绪标签 */
  mood: Mood;
  /** 当前活跃任务数 */
  activeTasks: number;
  /** 上次休息时间 ISO 8601 */
  lastBreak?: string;
}

export function makeAgentState(init?: Partial<AgentState>): AgentState {
  const state: AgentState = {
    currentLoad: 0,
    fatigue: 0,
    mood: 'focused',
    activeTasks: 0,
    ...init,
  };
  if (!MOODS.includes(state.mood)) {
    throw new Error(`mood must be one of ${MOODS.join(', ')}, got '${state.mood}'`);
  }
  return state;
}

/** Harness 契合度评分（契合度层）——Agent 质量 = 模型能力 × Harness 契合度 */
export interface HarnessFitScore {
  /** 总体契合度（0.0-1.0） */
  overall: number;
  /** 持久状态面契合度（Durable State Surfaces, F008） */
  durableState: number;
  /** 工具中介契合度（Tool Mediation） */
  toolMediation: number;
  /** 治理边界契合度（Governance Boundary, F010） */
  governance: number;
  /** 检索入口契合度（Three Retrieval Entry, F015） */
  retrieval: number;
  /** 可观测性契合度（Observability） */
  observability: number;
}

export function makeHarnessFitScore(init?: Partial<HarnessFitScore>): HarnessFitScore {
  return {
    overall: 0.5,
    durableState: 0.5,
    toolMediation: 0.5,
    governance: 0.5,
    retrieval: 0.5,
    observability: 0.5,
    ...init,
  };
}
