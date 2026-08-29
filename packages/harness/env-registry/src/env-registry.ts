/**
 * 环境变量注册表 — 所有用户可配置 env 的单一事实源（C39）。
 *
 * TS 移植自 clowder-ai `config/env-registry.ts`（1931 行）：
 *   - EnvDefinition / EnvCategory / ENV_CATEGORIES / ENV_VARS 注册表结构
 *   - maskUrlCredentials / buildEnvSummary：汇总当前值 + 敏感/URL 掩码
 *   - isEditableEnvVar* 系：运行时可编辑性策略（fail-closed 白名单）
 *
 * 插件化改造决策（对照 clowder 平台绑定）：
 *   - env 改名 FF_* 系（R17）：CAT_CAFE_* → FF_*；CAT_TEMPLATE_PATH → FF_TEMPLATE_PATH；
 *     DEFAULT_CAT_ID → FF_DEFAULT_CAT_ID；CAT_CAFE_USER_ID → FF_USER_ID
 *   - 数据裁剪：仅注册 flowforge 实际使用的 env（FF_* 系 + 通用项）；
 *     clowder 平台专属（Redis/API server/Telegram/GitHub/推送/信号源等）不纳入，
 *     分类保留原版结构（server/storage/budget/cli/proxy/codex/gemini/kimi/antigravity/
 *     frontend/telemetry），新增 mcp 类
 *
 * ⚠️ 铁律：新增 process.env.XXX → 必须在 ENV_VARS 注册，否则不存在（对 forgekin 不可见）。
 */

export type EnvCategory =
  | 'server'
  | 'storage'
  | 'budget'
  | 'cli'
  | 'proxy'
  | 'codex'
  | 'gemini'
  | 'kimi'
  | 'antigravity'
  | 'frontend'
  | 'telemetry'
  | 'mcp';

export interface EnvDefinition {
  /** env 变量名，如 'FF_GLOBAL_CONFIG_ROOT' */
  name: string;
  /** 默认值描述（展示用，非逻辑） */
  defaultValue: string;
  /** 人类可读描述（中文） */
  description: string;
  /** 分组类别 */
  category: EnvCategory;
  /** true 时当前值在 API 响应中掩码为 '***' */
  sensitive: boolean;
  /** 'url' 时 URL 中的凭据被掩码但 host/port/db 保留 */
  maskMode?: 'url';
  /** false 时仅内部使用，不在 Hub env 编辑器中展示 */
  hubVisible?: boolean;
  /** false 时仅 bootstrap 期可读，运行期不可从 Hub 编辑 */
  runtimeEditable?: boolean;
  /** true 时该变量应出现在 .env.example（check:env-example 强制） */
  exampleRecommended?: boolean;
  /** 显式允许值（cycle 式开关，如 ['off','shadow','on']） */
  allowedValues?: string[];
}

export const ENV_CATEGORIES: Record<EnvCategory, string> = {
  server: '服务器',
  storage: '存储',
  budget: '猫猫预算',
  cli: 'CLI',
  proxy: 'Anthropic 代理网关',
  codex: '缅因猫 (Codex)',
  gemini: '暹罗猫 (Gemini)',
  kimi: 'Kimi',
  antigravity: '孟加拉猫 (Antigravity)',
  frontend: '前端',
  telemetry: '可观测性 (OTel)',
  mcp: 'MCP',
};

export const ENV_VARS: EnvDefinition[] = [
  // --- server ---
  {
    name: 'PROJECT_ALLOWED_ROOTS',
    defaultValue: '(未设置 — 使用 denylist 模式，仅拦截系统目录)',
    description:
      'Legacy allowlist 模式：设置后切换为 allowlist，仅允许列出的根目录（按系统路径分隔符分隔；配合 PROJECT_ALLOWED_ROOTS_APPEND=true 可追加默认 roots）。未设置时使用 denylist 模式（见 PROJECT_DENIED_ROOTS）。',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'PROJECT_ALLOWED_ROOTS_APPEND',
    defaultValue: 'false',
    description: '设为 true 则将 PROJECT_ALLOWED_ROOTS 追加到默认根目录（home, /tmp, /workspace 等）而非覆盖',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'PROJECT_DENIED_ROOTS',
    defaultValue: '(平台默认系统目录)',
    description:
      'Denylist 模式下额外拦截的目录（按系统路径分隔符分隔，会合并到平台默认拦截列表）。仅在未设置 PROJECT_ALLOWED_ROOTS 时生效。',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'WORKSPACE_LINKED_ROOTS',
    defaultValue: '(未设置)',
    description: '工作区关联的项目根（冒号分隔）',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'FRONTEND_URL',
    defaultValue: '(自动检测)',
    description:
      '前端固定地址（有反向代理或固定域名时设置，如 https://forge.example.com）。本机和局域网直连通常不需要改',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'FRONTEND_PORT',
    defaultValue: '3003',
    description: '前端端口',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'FF_DEFAULT_OWNER_USER_ID',
    defaultValue: '(未设置)',
    description: '默认所有者用户 ID（信任锚点，不可从 Hub 修改；原名 DEFAULT_OWNER_USER_ID）',
    category: 'server',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_USER_ID',
    defaultValue: 'default-user',
    description: '当前用户 ID（原名 CAT_CAFE_USER_ID）',
    category: 'server',
    sensitive: false,
  },
  {
    name: 'FF_MCP_SERVER_PORT',
    defaultValue: '3099',
    description: 'MCP server 监听端口（原名 MCP_SERVER_PORT）',
    category: 'mcp',
    sensitive: false,
  },
  // --- storage ---
  {
    name: 'FF_GLOBAL_CONFIG_ROOT',
    defaultValue: '(未设置 — 用 projectRoot，缺省 homedir)',
    description: '全局配置根（accounts.json / credentials.json / user-preferences.json 所在根；原名 CAT_CAFE_GLOBAL_CONFIG_ROOT）',
    category: 'storage',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_TEMPLATE_PATH',
    defaultValue: '<projectRoot>/cat-template.json',
    description: '猫档案模板路径覆盖（必须位于 projectRoot 内；原名 CAT_TEMPLATE_PATH）',
    category: 'storage',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_DEFAULT_CAT_ID',
    defaultValue: '(种子 breed 自动选取)',
    description: 'bootstrap 时优先选取的种子 breed catId（原名 DEFAULT_CAT_ID）',
    category: 'storage',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_SKIP_HOMEDIR_MIGRATION',
    defaultValue: '0',
    description: '设为 1 跳过 homedir 跨根迁移（credentials/profiles；原名 CAT_CAFE_SKIP_HOMEDIR_MIGRATION）',
    category: 'storage',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_DATA_DIR',
    defaultValue: '(仓库内 data/)',
    description: '数据目录（DB/event stream/checkpoint 等；原名 CAT_CAFE_DATA_DIR）',
    category: 'storage',
    sensitive: false,
    runtimeEditable: false,
  },
  {
    name: 'TRANSCRIPT_DATA_DIR',
    defaultValue: '(未设置)',
    description: '会话转录数据目录',
    category: 'storage',
    sensitive: false,
  },
  {
    name: 'DOCS_ROOT',
    defaultValue: '(未设置)',
    description: '文档根目录（知识/参考检索用）',
    category: 'storage',
    sensitive: false,
  },
  {
    name: 'AUDIT_LOG_DIR',
    defaultValue: '(未设置)',
    description: '审计日志目录',
    category: 'storage',
    sensitive: false,
  },
  // --- budget ---
  {
    name: 'MAX_PROMPT_CHARS',
    defaultValue: '(未设置)',
    description: '单条 prompt 最大字符数（猫级覆盖见 CAT_*_MAX_PROMPT_CHARS）',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'CAT_OPUS_MAX_PROMPT_CHARS',
    defaultValue: '(未设置)',
    description: 'Opus 猫最大 prompt 字符数（覆盖 MAX_PROMPT_CHARS）',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'CAT_CODEX_MAX_PROMPT_CHARS',
    defaultValue: '(未设置)',
    description: 'Codex 猫最大 prompt 字符数（覆盖 MAX_PROMPT_CHARS）',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'CAT_GEMINI_MAX_PROMPT_CHARS',
    defaultValue: '(未设置)',
    description: 'Gemini 猫最大 prompt 字符数（覆盖 MAX_PROMPT_CHARS）',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'MAX_CONTEXT_MSG_CHARS',
    defaultValue: '(未设置)',
    description: '上下文消息最大字符数',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'MAX_PROMPT_TOKENS',
    defaultValue: '(未设置)',
    description: '最大 prompt token 数',
    category: 'budget',
    sensitive: false,
  },
  {
    name: 'MAX_A2A_DEPTH',
    defaultValue: '3',
    description: 'A2A（agent-to-agent）最大路由深度',
    category: 'budget',
    sensitive: false,
  },
  // --- cli ---
  {
    name: 'CLI_TIMEOUT_MS',
    defaultValue: '(未设置)',
    description: 'CLI 调用超时（毫秒）',
    category: 'cli',
    sensitive: false,
  },
  {
    name: 'CODEX_HOME',
    defaultValue: '(未设置)',
    description: 'Codex CLI 配置主目录',
    category: 'cli',
    sensitive: false,
  },
  {
    name: 'ANTIGRAVITY_BRAIN_HOME',
    defaultValue: '(未设置)',
    description: 'Antigravity brain 配置主目录',
    category: 'cli',
    sensitive: false,
  },
  {
    name: 'FF_TMUX_AGENT',
    defaultValue: '(未设置)',
    description: 'tmux agent 名称（原名 CAT_CAFE_TMUX_AGENT）',
    category: 'cli',
    sensitive: false,
  },
  {
    name: 'FF_TMUX_PATH',
    defaultValue: '(未设置)',
    description: 'tmux 可执行文件路径（原名 CAT_CAFE_TMUX_PATH）',
    category: 'cli',
    sensitive: false,
  },
  {
    name: 'FF_MCP_SERVER_PATH',
    defaultValue: '(未设置)',
    description: 'MCP server 可执行文件路径（原名 CAT_CAFE_MCP_SERVER_PATH）',
    category: 'cli',
    sensitive: false,
  },
  // --- proxy ---
  {
    name: 'ANTHROPIC_PROXY_ENABLED',
    defaultValue: 'false',
    description: '启用 Anthropic 代理网关',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'ANTHROPIC_PROXY_PORT',
    defaultValue: '3456',
    description: 'Anthropic 代理网关端口',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'ANTHROPIC_PROXY_DEBUG',
    defaultValue: 'false',
    description: 'Anthropic 代理网关调试日志',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'ANTHROPIC_PROXY_UPSTREAMS_PATH',
    defaultValue: '(未设置)',
    description: '上游代理配置路径',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'HTTPS_PROXY',
    defaultValue: '(未设置)',
    description: 'HTTPS 出站代理',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'HTTP_PROXY',
    defaultValue: '(未设置)',
    description: 'HTTP 出站代理',
    category: 'proxy',
    sensitive: false,
  },
  {
    name: 'ALL_PROXY',
    defaultValue: '(未设置)',
    description: '全协议出站代理',
    category: 'proxy',
    sensitive: false,
  },
  // --- codex / gemini / kimi / antigravity ---
  {
    name: 'CAT_CODEX_SANDBOX_MODE',
    defaultValue: '(未设置)',
    description: 'Codex 沙箱模式（read-only / workspace-write / danger-full-access）',
    category: 'codex',
    sensitive: false,
    allowedValues: ['read-only', 'workspace-write', 'danger-full-access'],
  },
  // --- frontend ---
  {
    name: 'CHROME_EXECUTABLE_PATH',
    defaultValue: '(自动检测)',
    description: 'Chrome/Chromium 可执行文件路径（前端渲染/截图用）',
    category: 'frontend',
    sensitive: false,
  },
  // --- telemetry ---
  {
    name: 'LOG_LEVEL',
    defaultValue: 'info',
    description: '日志级别（trace/debug/info/warn/error）',
    category: 'telemetry',
    sensitive: false,
  },
  {
    name: 'LOG_DIR',
    defaultValue: '(仓库内 logs/)',
    description: '日志目录',
    category: 'telemetry',
    sensitive: false,
  },
  {
    name: 'DEBUG',
    defaultValue: '(未设置)',
    description: '调试开关（逗号分隔的模块名或 *）',
    category: 'telemetry',
    sensitive: false,
  },
  // --- credentials (sensitive) ---
  {
    name: 'ANTHROPIC_API_KEY',
    defaultValue: '(空)',
    description: 'Anthropic API 密钥（敏感，界面掩码）',
    category: 'proxy',
    sensitive: true,
    runtimeEditable: true,
  },
  // --- test sandbox (hub 不可见) ---
  {
    name: 'FF_TEST_SANDBOX',
    defaultValue: '(未设置)',
    description: '测试沙盒写保护开关（仅测试/门禁使用；原名 CAT_CAFE_TEST_SANDBOX）',
    category: 'storage',
    sensitive: false,
    hubVisible: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_TEST_SANDBOX_ALLOW_UNSAFE_ROOT',
    defaultValue: '(未设置)',
    description: '测试沙盒临时允许写入非隔离根目录（仅测试调试使用；原名 CAT_CAFE_TEST_SANDBOX_ALLOW_UNSAFE_ROOT）',
    category: 'storage',
    sensitive: false,
    hubVisible: false,
    runtimeEditable: false,
  },
  {
    name: 'FF_TEST_REAL_HOME',
    defaultValue: '(未设置)',
    description: '测试真实 HOME 路径快照（用于阻止测试写回宿主 HOME；原名 CAT_CAFE_TEST_REAL_HOME）',
    category: 'storage',
    sensitive: false,
    hubVisible: false,
    runtimeEditable: false,
  },
];

export function maskUrlCredentials(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = '';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    // 非合法 URL — 整体掩码兜底
    return '***';
  }
}

function maskValue(def: EnvDefinition, raw: string): string {
  if (def.sensitive) return '***';
  if (def.maskMode === 'url') return maskUrlCredentials(raw);
  return raw;
}

function isHubVisibleEnvVar(def: EnvDefinition): boolean {
  return def.hubVisible !== false;
}

/**
 * 构建 env 汇总：读取当前 process.env 值。
 * 敏感值掩码；URL 值掩码凭据。
 */
export function buildEnvSummary(): Array<EnvDefinition & { currentValue: string | null }> {
  return ENV_VARS.filter(isHubVisibleEnvVar).map((def) => {
    const raw = process.env[def.name];
    const currentValue = raw != null && raw !== '' ? maskValue(def, raw) : null;
    return { ...def, currentValue };
  });
}

export function isEditableEnvVar(def: EnvDefinition): boolean {
  // 显式 opt-in：runtimeEditable: true 允许编辑（即使敏感，fail-closed 白名单）
  if (def.runtimeEditable === true) return true;
  // 显式 opt-out：runtimeEditable: false 无条件禁止编辑
  if (def.runtimeEditable === false) return false;
  // 缺省：非敏感变量可编辑
  return !def.sensitive;
}

/** true 当且仅当该变量敏感且显式 opt-in 运行期编辑。 */
export function isSensitiveEditableEnvVar(def: EnvDefinition): boolean {
  return def.sensitive && def.runtimeEditable === true;
}

export function isEditableEnvVarName(name: string): boolean {
  return ENV_VARS.some((def) => def.name === name && isHubVisibleEnvVar(def) && isEditableEnvVar(def));
}

/** 给定变量名集合中是否存在敏感可编辑项（需 owner 门禁）。 */
export function hasSensitiveEditableVars(names: Iterable<string>): boolean {
  const nameSet = new Set(names);
  return ENV_VARS.some((def) => nameSet.has(def.name) && isSensitiveEditableEnvVar(def));
}

/** 从给定变量名中筛出敏感可编辑项（审计过滤用）。 */
export function filterSensitiveEditableKeys(names: Iterable<string>): string[] {
  const nameSet = new Set(names);
  return ENV_VARS.filter((def) => nameSet.has(def.name) && isSensitiveEditableEnvVar(def)).map((def) => def.name);
}
