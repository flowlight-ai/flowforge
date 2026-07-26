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
}

/** 灵议响应中的单轮单灵智体发言 */
export interface CouncilRoundMessage {
  forgekin_id: string;
  name: string;
  content: string;
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

/** 默认群聊配置 */
export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  participantIds: ["wenxin", "sherlock", "luban", "vangogh", "davinci"],
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
