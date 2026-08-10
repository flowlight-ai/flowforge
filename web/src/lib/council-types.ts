/**
 * Council Chat 类型定义 — 5 灵智体协作群聊
 *
 * 对应后端 /api/v1/forgemind/* 端点：
 *   - GET  /api/v1/forgemind/roster        → 灵智体花名册
 *   - POST /api/v1/forgemind/council        → IM 灵议（多轮讨论）
 *   - POST /api/v1/forgemind/webchat/{id}   → 单灵智体对话
 *
 * 详见 MERGE-SPEC.md §3.2 聊天模式融合设计
 */

/** 灵智体角色（运行时标签，区别于 capability_profile） */
export type ForgekinRole = "primary" | "reviewer" | "tester" | "observer";

/** 灵智体花名册项（来自 /api/v1/forgemind/roster） */
export interface ForgekinRosterItem {
  id: string;
  name: string;
  nickname: string;
  species: string;
  role: {
    primary: string;
    secondary?: string[];
    lead?: boolean;
    description?: string;
    description_en?: string;
  };
  available: boolean;
  /** 进化阶（Evolution Stage / 能力成熟度等级 E1-E6） */
  evolutionStage?: string;
  /** 觉醒阶（Awakening Stage / 自主性等级 E1-E6） */
  awakeningStage?: string;
  /** 错误信息（API 返回的临时错误标记，用于过滤不可用项） */
  error?: string;
}

/** 群聊消息来源类型 */
export type CouncilMessageSource = "user" | "forgekin" | "system";

/** 群聊消息（UI 内部状态） */
export interface CouncilMessage {
  id: string;
  source: CouncilMessageSource;
  /** forgekin_id（当 source=forgekin 时） */
  forgekinId?: string;
  /** 灵智体显示名（当 source=forgekin 时） */
  forgekinName?: string;
  /** 灵智体角色（当 source=forgekin 时） */
  forgekinRole?: ForgekinRole;
  content: string;
  timestamp: number;
  /** 引用回复的原消息（当用户使用"引用回复"时） */
  replyTo?: CouncilMessage;
  /** 该灵智体响应的元信息（model/usage 等） */
  meta?: {
    model?: string;
    latency_ms?: number;
    usage?: Record<string, unknown>;
  };
  /** T7 审计徽章（隐藏在 UI 上，仅开发者可见） */
  t7Badge?: {
    verified: boolean;
    score?: number;
    note?: string;
  };
}

/** 灵议请求（POST /api/v1/forgemind/council） */
export interface CouncilRequest {
  topic: string;
  forgekin_ids: string[];
  max_rounds: number;
  /** 会话 ID（用于后端查询上次回复者，实现 fallback 链） */
  thread_id?: string;
  /** 路由模式：auto=自动判断（默认）；single=强制单智能体；parallel=强制全部并行 */
  mode?: "auto" | "single" | "parallel";
}

/** 灵议响应中的单轮单灵智体发言 */
export interface CouncilRoundMessage {
  forgekin_id: string;
  name: string;
  content: string;
  /** 实际使用的 LLM 模型名（如 "glm-4-flash"）— 来自真实 LLM 调用 */
  model?: string;
  /** LLM 调用用量统计（latency_ms/tokens 等） */
  usage?: Record<string, unknown>;
}

/** 灵议响应中的一轮 */
export interface CouncilRound {
  round: number;
  messages: CouncilRoundMessage[];
}

/** 灵议响应（POST /api/v1/forgemind/council） */
export interface CouncilResponse {
  topic: string;
  rounds: CouncilRound[];
  summary: string;
  participant_count: number;
  /** 实际路由模式：single=单智能体回答；parallel=多智能体并行 */
  routing_mode?: "single" | "parallel";
  /** 实际参与回答的 Forgekin ID 列表 */
  selected_forgekin_ids?: string[];
}

/** 群聊配置 */
export interface CouncilConfig {
  /** 参与的灵智体 ID 列表 */
  participantIds: string[];
  /** 角色分配：forgekin_id → role */
  roleAssignment: Record<string, ForgekinRole>;
  /** 灵议轮数（1-3） */
  maxRounds: number;
  /** 是否启用 T7 审计（隐藏 UI，仅开发者） */
  enableT7Audit: boolean;
}

/**
 * 默认群聊配置
 *
 * 路由策略（参考 clowder-ai AgentRouter）：
 *   - 默认不指定 participantIds（空数组）→ 后端 fallback 链决定单智能体
 *   - @all / @全体 → 后端自动展开为全部 Forgekin 并行
 *   - @特定智能体 → 后端仅调用被提及的智能体
 *   - 无 @ → 后端使用上次回复者，若无则默认 luban
 *
 * 注意：participantIds 现在仅作为 UI 展示的"偏好列表"，
 * 不再直接决定每次回答的参与者（由后端 @mention 解析决定）。
 */
export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  participantIds: ["luban"],
  roleAssignment: {
    luban: "primary",
    vangogh: "reviewer",
    davinci: "tester",
    wenxin: "observer",
    sherlock: "observer",
  },
  maxRounds: 1,
  enableT7Audit: true,
};

/**
 * @all / @全体 触发模式（与后端 council_router.py ALL_MENTION_PATTERNS 对应）
 * 前端用于检测用户输入是否触发"全部并行"模式
 */
export const ALL_MENTION_PATTERNS = [
  /@all\b/i,
  /@全体\b/,
  /@所有人\b/,
  /@全部\b/,
  /@大家\b/,
];

/**
 * 检测消息是否包含 @all / @全体 等群组提及
 */
export function isAllMention(text: string): boolean {
  return ALL_MENTION_PATTERNS.some((p) => p.test(text));
}

/** 角色显示配置 */
export const ROLE_CONFIG: Record<ForgekinRole, { label: string; color: string; icon: string }> = {
  primary: { label: "主答", color: "bg-emerald-600", icon: "★" },
  reviewer: { label: "审查", color: "bg-amber-600", icon: "✓" },
  tester: { label: "测试", color: "bg-blue-600", icon: "◇" },
  observer: { label: "观察", color: "bg-gray-600", icon: "○" },
};

/** 灵智体颜色映射（来自 YAML 配置） */
export const FORGEKIN_COLORS: Record<string, { primary: string; secondary: string }> = {
  wenxin: { primary: "#D4A017", secondary: "#F5F5DC" },   // 丹顶鹤金红
  sherlock: { primary: "#4A6FA5", secondary: "#B8C9E0" },  // 猎犬蓝
  luban: { primary: "#8B7355", secondary: "#F5E6D3" },     // 猫头鹰棕褐
  vangogh: { primary: "#9B2C2C", secondary: "#FED7D7" },   // 狐狸红
  davinci: { primary: "#2D7D6E", secondary: "#C6E6D4" },   // 熊绿
};

/** 灵智体图标 emoji（用于头像占位） */
export const FORGEKIN_EMOJI: Record<string, string> = {
  wenxin: "🦩",     // 丹顶鹤
  sherlock: "🐕",   // 猎犬
  luban: "🦉",      // 猫头鹰
  vangogh: "🦊",    // 狐狸
  davinci: "🐻",    // 熊
};
