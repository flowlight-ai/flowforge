/**
 * Prompt Hook Pipeline 类型 — C41（F237 Phase 2）。
 *
 * TS 移植自 clowder-ai `@cat-cafe/shared/types/prompt-hook.ts`：
 *   - HookManifest / RegisteredHook / ResolveResult / TraceEvent 判别联合
 *   - HookResolver 接口（纯函数，无副作用）
 *   - AssemblerInput 集中式类型上下文袋
 *
 * 插件化改造决策：
 *   - 裁剪 cats 专属耦合：CrossThreadCoordination → 内联简化 hint 类型；
 *     WorldContextInput 保留但收敛为纯数据
 *   - 裁剪平台专属：CatConfigSnapshot 保留核心字段（displayName/role/personality/
 *     mentionPatterns/restrictions 等），移除 cats 特有业务字段
 */

/** 两个管线执行阶段。 */
export type HookStage = 'session-init' | 'per-turn';

/** 安全/透明/治理三维分级（Phase 1 三轴）。 */
export type SafetyTier = 'readonly' | 'limited-edit' | 'editable';
export type TransparencyTier = 'visible-by-default' | 'opt-in-view' | 'debug-only';
export type GovernanceTier = 'immutable' | 'human-gated' | 'auto-evolve';

/** hook.yaml 解析结果 — 声明的 prompt 段元数据。 */
export interface HookManifest {
  /** 稳定段标识（S1/D5/L3 等） */
  id: string;
  /** 人类可读名称 */
  name: string;
  /** 所属管线阶段 */
  stage: HookStage;
  /** 阶段内执行顺序（内置 100 步距） */
  order: number;
  /** 当前内容版本 */
  version: number;
  /** 默认启用 */
  enabled: boolean;

  // -- 内容解析 --
  /** 模板文件路径（相对 hook 目录） */
  template: string;
  /** resolver 注册名（可选 — 无 resolver 的 hook 无条件触发） */
  resolver?: string;

  // -- 依赖 --
  /** 该 hook 读取的 AssemblerInput 字段 */
  inputs: string[];

  // -- 覆盖约束 --
  /** 是否允许运行期禁用（false = 不可变） */
  disableable: boolean;

  // -- 三轴分级 --
  safetyTier: SafetyTier;
  transparencyTier: TransparencyTier;
  governanceTier: GovernanceTier;

  // -- 面向 operator --
  userExplanation?: string;
}

/** 已注册 hook — manifest + 解析后的运行期路径。 */
export interface RegisteredHook {
  manifest: HookManifest;
  /** hook 目录绝对路径 */
  dirPath: string;
  /** 模板文件绝对路径 */
  templatePath: string;
}

/** resolver 判定结果（判别联合）。 */
export type ResolveResult =
  | { status: 'fired'; vars: Record<string, string>; templateVersion?: number }
  | { status: 'skipped'; reasonCode: string; reason: string };

// ────────── TraceEvent（判别联合） ──────────

interface TraceEventBase {
  hookId: string;
  stage: HookStage;
  timestamp: number;
}

export interface TraceEventFired extends TraceEventBase {
  status: 'fired';
  version: number;
  contentHash: string;
  tokenEstimate: number;
}

export interface TraceEventSkipped extends TraceEventBase {
  status: 'skipped';
  reasonCode: string;
  reason: string;
}

export interface TraceEventDisabled extends TraceEventBase {
  status: 'disabled';
  disabledBy: 'manifest' | 'operator' | 'auto-eval';
}

export interface TraceEventObserved extends TraceEventBase {
  status: 'observed';
  contentHash: string;
  tokenEstimate: number;
}

export type TraceEvent = TraceEventFired | TraceEventSkipped | TraceEventDisabled | TraceEventObserved;

// ────────── 投递通道感知 ──────────

export type DeliveryChannel = 'message-prepend' | 'native-l0' | 'pack-only' | 'always-delivered';

export interface StageDeliveryDecision {
  stage: HookStage;
  delivered: boolean;
  channel: DeliveryChannel;
  reason: string;
}

/** 触发 hook 的输出 — 已渲染内容补丁。 */
export interface PromptPatch {
  hookId: string;
  content: string;
  order: number;
}

// ────────── 注入追踪（持久层） ──────────

export interface TraceEventSummary {
  hookId: string;
  status: TraceEvent['status'];
  version?: number;
  tokenEstimate?: number;
  reasonCode?: string;
}

export interface InjectionTraceSummary {
  turnId: string;
  sessionId: string;
  threadId: string;
  catId: string;
  timestamp: number;
  hooks: TraceEventSummary[];
  delivery: StageDeliveryDecision[];
  totalTokens: number;
  totalHooksFired: number;
  totalHooksSkipped: number;
  totalDurationMs: number;
}

/** 全量追踪细节 — 调试层（含内容哈希/时长，TTL=7d）。 */
export interface InjectionTraceDetail {
  turnId: string;
  threadId: string;
  catId: string;
  timestamp: number;
  hooks: TraceEvent[];
}

// ────────── HookResolver — P2-B resolver 接口 ──────────

export interface HookResolver {
  /**
   * 判定该 hook 是否触发并准备模板变量。
   * 纯函数 — 无可变状态、无存储查询、无副作用。
   * 全部数据来自 AssemblerInput（由 ContextAssembler 收集）。
   */
  resolve(input: AssemblerInput): ResolveResult;
}

// ────────── AssemblerInput — P2-B 集中式类型上下文袋 ──────────

/** 当前调用的路由模式。 */
export type RoutingMode = 'independent' | 'serial' | 'parallel';

/** 猫配置快照（由 assembler 一次性完成配置查找）。 */
export interface CatConfigSnapshot {
  displayName: string;
  nickname?: string;
  name: string;
  roleDescription: string;
  personality: string;
  defaultModel?: string;
  variantLabel?: string;
  isDefaultVariant?: boolean;
  mentionPatterns: readonly string[];
  restrictions?: readonly string[];
  caution?: string;
  clientId?: string;
  breedId?: string;
  teamStrengths?: string;
}

/** 预计算的 @提及分析。 */
export interface CallableMentionsData {
  mentions: readonly string[];
  hasDuplicateDisplayNames: boolean;
  uniqueHandleExample: string | null;
}

/** 预解析的队友信息（D6）。 */
export interface TeammateSnapshot {
  id: string;
  displayName: string;
  nickname?: string;
  name: string;
  roleDescription: string;
}

/** 预解析的私信信息（D2/D3）。 */
export interface DirectMessageInfo {
  fromCatId: string;
  fromLabel: string;
  fromModel: string;
  fromDisplayName: string;
  fromVariantLabel?: string;
  isSameBreed: boolean;
}

/** 跨线程回复提示（D4）— 裁剪 CrossThreadCoordination 为内联简化。 */
export interface CrossThreadHintInput {
  sourceThreadId: string;
  senderCatId: string;
  effectClass?: string;
  coordination?: { type: string; targetThreadId?: string };
}

/** 乒乓警告信息（D5）。 */
export interface PingPongInput {
  otherLabel: string;
  count: number;
}

/** 活跃参与者信息（D12）。 */
export interface ActiveParticipantInput {
  catId: string;
  label: string;
  lastMessageAt: number;
}

/** SOP 阶段提示（D14）。 */
export interface SopStageInput {
  featureId: string;
  stage: string;
  suggestedSkill: string;
  suggestedSkillSource?: string;
}

/** Bootcamp 状态（D16）。 */
export interface BootcampInput {
  phase: string;
  leadCat?: string;
  selectedTaskId?: string;
}

/** 拍平的世界上下文（D18）。 */
export interface WorldContextInput {
  worldName: string;
  worldStatus: string;
  constitutionLine: string;
  sceneName: string;
  sceneStatus: string;
  charactersBlock: string;
  canonBlock: string;
  recentEventsBlock: string;
  careHintLine: string;
}

/**
 * AssemblerInput — hooks 需要的一切，由 ContextAssembler 一次收集。
 * Resolver 只读此袋 — 无存储查询、无配置查找。
 */
export interface AssemblerInput {
  // --- 核心身份（catRegistry + 配置 + 运行期解析） ---
  catId: string;
  catConfig: CatConfigSnapshot;
  runtimeModel: string;
  providerLabel: string;

  // --- session-init 计算（ContextAssembler） ---
  callableMentions: CallableMentionsData;
  rosterContent: string | null;
  workflowTriggerContent: string | null;
  coCreatorName: string;
  coCreatorHandles: string;
  governanceDigest: string;
  mcpToolsSection: string;

  // --- Pack 块 ---
  packMasksBlock: string | null;
  packWorkflowsBlock: string | null;
  packGuardrailBlock: string | null;
  packDefaultsBlock: string | null;
  packWorldDriverSummary: string | null;

  // --- 路由上下文 ---
  mode: RoutingMode;
  chainIndex: number | null;
  chainTotal: number | null;
  mcpAvailable: boolean;
  nativeL0Injected: boolean;
  a2aEnabled: boolean;

  // --- per-turn 动态（assembler 预解析） ---
  directMessage: DirectMessageInfo | null;
  crossThreadReplyHint: CrossThreadHintInput | null;
  pingPongWarning: PingPongInput | null;
  teammates: readonly TeammateSnapshot[];
  mentionRoutingItems: readonly string[];
  promptTags: readonly string[];
  activeParticipants: readonly ActiveParticipantInput[];
  routingPolicyParts: string | null;
  sopStageHint: SopStageInput | null;
  voiceMode: boolean;
  bootcampState: BootcampInput | null;
  threadId: string | null;
  bootcampMemberCount: number | null;
  guidePromptLines: string | null;
  conciergeLines: readonly string[] | null;

  // --- 世界 / 知识 / 信号 ---
  worldContext: WorldContextInput | null;
  alwaysOnDocsBlock: string | null;
  activeSignalsBlock: string | null;

  // --- 预加载模板内容（D8/D21 文件加载） ---
  a2aBallCheckContent: string | null;
  handoffDecisionTreeContent: string | null;

  // --- 共创者提及（D21 模板 {{CC_MENTION}}） ---
  coCreatorFirstMention: string;
}
