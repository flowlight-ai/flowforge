/**
 * model.ts — HubForgekinEditor 表单数据模型
 *
 * 定义可进化智能体（Forgekin）编辑表单的核心数据结构、初始化函数与 PATCH 构造逻辑。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 *
 * 依赖：仅依赖 @/lib/council-types 的 ForgekinRosterItem，不依赖 clowder-ai 任何组件。
 */

import type { ForgekinRosterItem } from "@/lib/council-types";

/** 形态（Species）—— 对应 Forgekin 的存在形态 */
export type SpeciesKind = "BIO" | "ORG" | "OBJ" | "VIRTUAL" | "HYBRID";

/** 角色（Role）—— 用户可选择的角色标签，对应 roster.role.primary */
export type RoleKind = "架构师" | "开发者" | "评审员" | "测试员" | "文档员";

/** 模型账户（Model Account）—— 模型 Provider 通道 */
export type ModelAccount = "builtin" | "openai" | "anthropic" | "zhipu" | "doubao";

/** 路由策略（Routing Strategy）—— 多模型/多通道选择策略 */
export type RoutingStrategy = "round-robin" | "priority" | "weight";

/** CLI 工具 Provider — 可绑定的三方 Agent CLI 工具 */
export type CliTool =
  | "claude_code"
  | "codex"
  | "gemini"
  | "opencode"
  | "codebuddy"
  | "iflow"
  | "qodercli"
  | "kimi"
  | "trae"
  | "trae_cn_ide";

/** 连接模式 — CLI 工具的接入方式 */
export type ConnectionMode = "cli" | "bridge" | "api";

/** CLI 绑定配置 */
export interface CliBinding {
  /** 绑定的 CLI 工具 provider 名 */
  cli_tool: CliTool;
  /** 模型 ID */
  model_id: string;
  /** API Key（明文，保存时写入 .env；空字符串表示未修改） */
  api_key: string;
  /** 连接模式 */
  mode: ConnectionMode;
}

/** 语音配置 */
export interface VoiceConfig {
  /** TTS 语音 ID（如 zh-CN-XiaoxiaoNeural） */
  voice: string;
  /** 语速（0.5 - 2.0） */
  rate: number;
  /** 音调（-10 到 10） */
  pitch: number;
}

/** Forgekin 编辑表单数据 */
export interface ForgekinFormData {
  id: string;
  name: string;
  nickname: string;
  species: SpeciesKind;
  role: RoleKind;
  system_prompt: string;
  model: ModelAccount;
  /** 工具白名单（工具 ID 列表） */
  tools: string[];
  /** 温度（0 - 2） */
  temperature: number;
  /** top_p（0 - 1） */
  topP: number;
  /** 最大 token 数（1 - 32768） */
  maxTokens: number;
  /** 主题色（十六进制，如 #D4A017） */
  themeColor: string;
  /** 语音配置 */
  voiceConfig: VoiceConfig;
  /** 路由策略 */
  routing: RoutingStrategy;
  /** CLI 工具绑定配置 */
  cliBinding: CliBinding;
}

/** 角色可选项（供 RoleField 下拉使用） */
export const ROLE_OPTIONS: RoleKind[] = ["架构师", "开发者", "评审员", "测试员", "文档员"];

/** 形态可选项（供 SpeciesField 下拉使用） */
export const SPECIES_OPTIONS: SpeciesKind[] = ["BIO", "ORG", "OBJ", "VIRTUAL", "HYBRID"];

/** 模型账户可选项（供 AccountSection 下拉使用） */
export const MODEL_ACCOUNT_OPTIONS: ModelAccount[] = ["builtin", "openai", "anthropic", "zhipu", "doubao"];

/** 路由策略可选项（供 RoutingSection 下拉使用） */
export const ROUTING_OPTIONS: { value: RoutingStrategy; label: string }[] = [
  { value: "round-robin", label: "轮询" },
  { value: "priority", label: "优先级" },
  { value: "weight", label: "权重" },
];

/** CLI 工具可选项（供 CliBindingSection 下拉使用） */
export const CLI_TOOL_OPTIONS: { value: CliTool; label: string }[] = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
  { value: "opencode", label: "OpenCode" },
  { value: "codebuddy", label: "CodeBuddy" },
  { value: "iflow", label: "iFlow" },
  { value: "qodercli", label: "Qoder CLI" },
  { value: "kimi", label: "Kimi" },
  { value: "trae", label: "Trae CN（桥接）" },
  { value: "trae_cn_ide", label: "Trae CN IDE" },
];

/** 连接模式可选项 */
export const CONNECTION_MODE_OPTIONS: { value: ConnectionMode; label: string }[] = [
  { value: "cli", label: "CLI（命令行调用）" },
  { value: "bridge", label: "Bridge（文件桥接）" },
  { value: "api", label: "API（HTTP 直连）" },
];

/** 默认主题色（兜底） */
export const DEFAULT_THEME_COLOR = "#8B7355";

/** 默认语音配置 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voice: "zh-CN-XiaoxiaoNeural",
  rate: 1.0,
  pitch: 0,
};

/**
 * 将任意字符串安全转换为 SpeciesKind，无法匹配时回退到 "BIO"。
 */
function coerceSpecies(raw: string | undefined | null): SpeciesKind {
  if (raw && (SPECIES_OPTIONS as string[]).includes(raw)) {
    return raw as SpeciesKind;
  }
  return "BIO";
}

/**
 * 将任意字符串安全转换为 RoleKind，无法匹配时回退到 "架构师"。
 */
function coerceRole(raw: string | undefined | null): RoleKind {
  if (raw && (ROLE_OPTIONS as string[]).includes(raw)) {
    return raw as RoleKind;
  }
  return "架构师";
}

/**
 * 将任意字符串安全转换为 CliTool，无法匹配时回退到 "trae"。
 */
function coerceCliTool(raw: string | undefined | null): CliTool {
  const valid = CLI_TOOL_OPTIONS.map((o) => o.value);
  if (raw && (valid as string[]).includes(raw)) {
    return raw as CliTool;
  }
  return "trae";
}

/**
 * 将任意字符串安全转换为 ConnectionMode，无法匹配时回退到 "cli"。
 */
function coerceConnectionMode(raw: string | undefined | null): ConnectionMode {
  if (raw === "cli" || raw === "bridge" || raw === "api") {
    return raw;
  }
  return "cli";
}

/**
 * initialState —— 从花名册项初始化表单数据。
 *
 * 当 roster 项缺少某些字段时，使用合理默认值兜底，确保表单始终可编辑。
 */
export function initialState(forgekin: ForgekinRosterItem): ForgekinFormData {
  return {
    id: forgekin.id,
    name: forgekin.name || forgekin.id,
    nickname: forgekin.nickname || forgekin.name || forgekin.id,
    species: coerceSpecies(forgekin.species),
    role: coerceRole(forgekin.role?.primary),
    system_prompt: forgekin.role?.description || "",
    model: "builtin",
    tools: [],
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
    themeColor: DEFAULT_THEME_COLOR,
    voiceConfig: { ...DEFAULT_VOICE_CONFIG },
    routing: "round-robin",
    cliBinding: {
      cli_tool: coerceCliTool(forgekin.llm_provider),
      model_id: forgekin.llm_model ?? "",
      api_key: "",
      mode: coerceConnectionMode(forgekin.llm_mode),
    },
  };
}

/**
 * buildPatchPayload —— 构建 API PATCH 请求体。
 *
 * 仅包含可写字段（不含 id），将表单扁平结构转换回 roster 兼容的嵌套结构。
 */
export function buildPatchPayload(form: ForgekinFormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name,
    nickname: form.nickname,
    species: form.species,
    role: {
      primary: form.role,
      description: form.system_prompt || undefined,
    },
    system_prompt: form.system_prompt,
    model: form.model,
    tools: form.tools,
    runtime: {
      temperature: form.temperature,
      top_p: form.topP,
      max_tokens: form.maxTokens,
    },
    theme_color: form.themeColor,
    voice: {
      voice: form.voiceConfig.voice,
      rate: form.voiceConfig.rate,
      pitch: form.voiceConfig.pitch,
    },
    routing: form.routing,
    llm: {
      provider: form.cliBinding.cli_tool,
      model: form.cliBinding.model_id,
      mode: form.cliBinding.mode,
    },
  };
  // API key 仅在用户填写时传递（空字符串不提交，避免覆盖已有 key）
  if (form.cliBinding.api_key) {
    payload.api_key = form.cliBinding.api_key;
  }
  return payload;
}
