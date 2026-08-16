/**
 * 灵智训练营（Bootcamp）类型定义
 *
 * 参考 clowder-ai BootcampStateV1（packages/api/src/domains/cats/services/
 * stores/ports/ThreadStore.ts:286-297）
 *
 * 12 阶段状态机（与后端 bootcamp.py PHASE_ORDER 一致）：
 *   phase-1-intro → phase-11-farewell
 */

/** 训练营阶段枚举 */
export type BootcampPhase =
  | "phase-1-intro"
  | "phase-2-env-check"
  | "phase-3-config-help"
  | "phase-4-task-select"
  | "phase-5-kickoff"
  | "phase-6-design"
  | "phase-7-dev"
  | "phase-7.5-add-teammate"
  | "phase-8-collab"
  | "phase-9-complete"
  | "phase-10-retro"
  | "phase-11-farewell";

/** 训练营阶段顺序（与后端 PHASE_ORDER 对应） */
export const PHASE_ORDER: BootcampPhase[] = [
  "phase-1-intro",
  "phase-2-env-check",
  "phase-3-config-help",
  "phase-4-task-select",
  "phase-5-kickoff",
  "phase-6-design",
  "phase-7-dev",
  "phase-7.5-add-teammate",
  "phase-8-collab",
  "phase-9-complete",
  "phase-10-retro",
  "phase-11-farewell",
];

/** 阶段中文标签（与后端 PHASE_LABELS 对应） */
export const PHASE_LABELS: Record<BootcampPhase, string> = {
  "phase-1-intro": "自我介绍",
  "phase-2-env-check": "环境检测",
  "phase-3-config-help": "配置帮助",
  "phase-4-task-select": "选择任务",
  "phase-5-kickoff": "确认需求",
  "phase-6-design": "设计",
  "phase-7-dev": "开发",
  "phase-7.5-add-teammate": "添加队友",
  "phase-8-collab": "多智能体协作",
  "phase-9-complete": "完成",
  "phase-10-retro": "回顾",
  "phase-11-farewell": "毕业",
};

/** 训练营状态（与后端 bootcamp_state 对应） */
export interface BootcampState {
  v: number;
  phase: BootcampPhase;
  leadForgekinId?: string;
  selectedTaskId?: string | null;
  /** 环境检测结果（联动 doctor_lib.run_full_check 完整 dict） */
  envCheck?: EnvCheckResult | Record<string, ToolCheckResult>;
  startedAt: number;
  completedAt?: number | null;
}

/** 单个工具检测结果（向后兼容旧格式：{ok, version, note}） */
export interface ToolCheckResult {
  ok: boolean;
  version: string;
  note?: string;
  /** 新格式字段：可执行文件路径 */
  path?: string;
  /** 新格式字段：版本要求（如 "3.11+"） */
  required?: string;
}

/** 核心工具检测结果（python/node/npm/git/pnpm）—— value of core_tools dict */
export interface CoreToolCheck {
  ok: boolean;
  version: string;
  path: string;
  /** 版本要求（如 "3.11+"，仅失败时填充） */
  required?: string;
}

/** 单个 AI CLI 工具检测结果（联动 doctor_lib，value of cli_tools dict） */
export interface CliToolCheck {
  /** 是否安装可用 */
  ok: boolean;
  /** 可执行文件路径（ok=true 时存在） */
  path?: string;
  /** 版本号（ok=true 时存在） */
  version?: string;
  /** 错误信息（ok=false 时为 "not found"） */
  error?: string;
  /** 安装命令（ok=false 时存在，如 "npm install -g @openai/codex"） */
  install_cmd?: string;
  /** 绑定的灵智体名称（如 "sherlock (夏洛克)"） */
  forgekin?: string;
  /** 备注（如 "经 responses proxy 转发"） */
  note?: string;
  /** 工具名（仅当作为数组项时存在；dict 形式时由 key 隐式给出） */
  name?: string;
  /** 旧格式兼容：状态字符串 */
  status?: "ok" | "missing" | "fail" | "unknown";
}

/** 单个代理服务检测结果（value of proxy_services dict） */
export interface ProxyServiceCheck {
  ok: boolean;
  port: number;
  /** 状态字符串：running / stopped / unknown */
  status: "running" | "stopped" | "unknown";
  /** 服务描述（如 "Claude Code 转发代理"） */
  desc?: string;
  /** 旧格式兼容：服务名（仅数组项时存在） */
  name?: string;
}

/** Trae 桥接检测结果（butterfly 灵智体） */
export interface TraeBridgeCheck {
  ok: boolean;
  /** 桥接目录路径（ok=true 时为 FLOWFORGE_BRIDGE_DIR 值） */
  dir: string;
  /** 状态字符串：ok / missing / unknown */
  status: "ok" | "missing" | "unknown";
  /** 旧格式兼容 */
  bridge_dir?: string;
  name?: string;
  exists?: boolean;
}

/** .env 配置文件检测结果 */
export interface EnvFileCheck {
  /** 是否存在 */
  exists?: boolean;
  /** 是否已配置 API key */
  has_api_keys?: boolean;
  /** 已配置的 API key 数量 */
  configured_keys?: number;
  /** 总 API key 数量（默认 4） */
  total_keys?: number;
  /** 状态字符串：ok / missing / unknown */
  status?: string;
  name?: string;
}

/** .venv 虚拟环境检测结果 */
export interface VenvCheck {
  exists?: boolean;
  status?: string;
  name?: string;
}

/** 前端依赖检测结果（web/node_modules） */
export interface WebDepsCheck {
  exists?: boolean;
  status?: string;
  name?: string;
}

/** 环境检测结果（联动 scripts/doctor_lib.py 的 run_full_check 深度检测）.
 *
 * 返回格式与后端 bootcamp env-check 端点完全一致：
 *   - core_tools: 5 项核心工具（python/node/npm/git/pnpm）
 *   - cli_tools: 8 个 AI CLI 工具（claude/codex/gemini/opencode/codebuddy/qodercli/iflow/kimi）
 *   - proxy_services: 3 个协议代理（claude-code-router/responses-proxy/gemini-proxy）
 *   - trae_bridge: Trae 桥接目录（butterfly 灵智体）
 *   - all_ready: 是否全部就绪（核心+CLI+代理+桥接）
 *   - missing: 缺失项名称列表
 */
export interface EnvCheckResult {
  /** 核心工具检测：{python/node/npm/git/pnpm: {ok, version, path}} */
  core_tools: Record<string, CoreToolCheck>;
  /** AI CLI 工具检测：{tool_name: {ok, version/path 或 error, install_cmd, forgekin}} */
  cli_tools: Record<string, CliToolCheck>;
  /** 代理服务检测：{name: {ok, port, status}} */
  proxy_services: Record<string, ProxyServiceCheck>;
  /** Trae 桥接状态：{ok, dir, status} */
  trae_bridge: TraeBridgeCheck;
  /** .env 配置文件状态 */
  env_file: EnvFileCheck;
  /** .venv 虚拟环境状态 */
  venv: VenvCheck;
  /** 前端依赖状态（web/node_modules） */
  web_deps: WebDepsCheck;
  /** 是否全部就绪（核心+CLI+代理+桥接） */
  all_ready: boolean;
  /** 缺失项名称列表（如 ["codex", "responses-proxy"]） */
  missing: string[];
  /** 给用户的安装提示文案 */
  install_hint: string;
}

/** 训练营会话（Thread + bootcamp_state） */
export interface BootcampThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  bootcamp_state: BootcampState;
}

/** 获取阶段进度百分比 */
export function getPhaseProgress(phase: BootcampPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / PHASE_ORDER.length) * 100);
}

/** 获取阶段序号（1-12） */
export function getPhaseIndex(phase: BootcampPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx === -1 ? 0 : idx + 1;
}
