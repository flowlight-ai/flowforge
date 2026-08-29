/**
 * MCP Config Adapters — F041 CLI 配置读写
 *
 * 移植自 clowder-ai `config/capabilities/mcp-config-adapters.ts`。
 * 读写六种 MCP 配置格式，归一化为 McpServerDescriptor 内部模型。
 *
 * Persistent (written at startup via generateCliConfigs / PROVIDER_WRITERS):
 *   Gemini:      .gemini/settings.json            — { mcpServers: { name: { command, args, env, cwd } } }
 *   Antigravity: ~/.gemini/antigravity/mcp_config.json — 同 Gemini
 *
 * Invoke-time only (temp file or CLI args per invocation, NOT written at startup):
 *   Claude:      --mcp-config JSON --strict-mcp-config at invoke time
 *   Codex:       --config mcp_servers.X... inline overrides at invoke time
 *   Kimi:        temp mcp.json via writeMcpConfigFile + --mcp-config-file
 *   OpenCode:    temp opencode.json via writeOpenCodeRuntimeConfig + OPENCODE_CONFIG
 *
 * 改造点（flowforge）：
 *   - 裁剪 retired-github-mcp / deprecated-managed-servers 清理逻辑
 *     （clowder-ai 专属历史迁移，对 flowforge 无意义）
 *   - smol-toml 依赖替换为内联轻量 TOML 解析（仅需 [mcp_servers.*] 段）
 *   - createModuleLogger 替换为 console.warn
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { McpServerDescriptor } from '@flowforge/cats-shared';
import { MCP_CALLBACK_ENV_KEYS } from './mcp-constants.js';

/**
 * 仅迁移本次托管写入能够证明所有权的旧式冒号命名插件条目。
 * 名称相似本身不足以证明所有权 — 用户可能拥有与外部 `foo__bar`
 * 服务器并存的无关 `foo:bar` 条目。
 */
function migrateOwnedPluginNames(
  existingServers: Record<string, unknown>,
  servers: readonly McpServerDescriptor[],
): void {
  for (const server of servers) {
    const legacyName = server.capabilityId;
    if (server.source === 'plugin' && legacyName?.includes(':') && legacyName.replace(/:/g, '__') === server.name) {
      delete existingServers[legacyName];
    }
  }
}

const CAT_CAFE_ENV_PLACEHOLDERS: Readonly<Record<string, string>> = Object.fromEntries(
  MCP_CALLBACK_ENV_KEYS.map((key) => [key, `\${${key}}`]),
);

/**
 * 解析 Bengal shell 工具将要在其中运行的工作区根
 * （pwd/git 命令的作用域）。概念上区别于运行时二进制根。
 *
 * 优先级：
 *   1. ALLOWED_WORKSPACE_DIRS env（最高 — 用户显式覆盖）
 *   2. CAT_CAFE_WORKSPACE_ROOT env（工作区与运行时二进制分离）
 *   3. process.cwd() 回退
 */
let workspaceRuntimeMisconfigWarned = false;
export function resolveWorkspaceRoot(): string {
  const allowedFromEnv = process.env.ALLOWED_WORKSPACE_DIRS?.trim();
  if (allowedFromEnv) return allowedFromEnv;
  const explicitWorkspace = process.env.CAT_CAFE_WORKSPACE_ROOT?.trim();
  if (explicitWorkspace) return explicitWorkspace;
  const runtimeRoot = process.env.CAT_CAFE_RUNTIME_ROOT?.trim();
  if (runtimeRoot && !workspaceRuntimeMisconfigWarned) {
    workspaceRuntimeMisconfigWarned = true;
    console.warn(
      `[mcp-config] CAT_CAFE_RUNTIME_ROOT=${runtimeRoot} is set but neither ` +
        `CAT_CAFE_WORKSPACE_ROOT nor ALLOWED_WORKSPACE_DIRS is exported. Falling back ` +
        `to process.cwd() (${process.cwd()}) which equals the runtime worktree — ` +
        `managed MCP shell tools will operate on runtime internals instead of the ` +
        `user workspace. Update runtime startup to export CAT_CAFE_WORKSPACE_ROOT.`,
    );
  }
  return process.cwd();
}

/**
 * Baseline defaults — 仅在 descriptor 未提供该键时作为回退。
 */
function buildAntigravityCatCafeEnvBaseline(): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    ALLOWED_WORKSPACE_DIRS: resolveWorkspaceRoot(),
  };
  const agentKeyFile = process.env.CAT_CAFE_AGENT_KEY_FILE?.trim();
  if (agentKeyFile) env.CAT_CAFE_AGENT_KEY_FILE = agentKeyFile;
  const agentKeyFiles = process.env.CAT_CAFE_AGENT_KEY_FILES?.trim();
  if (agentKeyFiles) env.CAT_CAFE_AGENT_KEY_FILES = agentKeyFiles;
  return env;
}

/**
 * 强制覆盖的 env 键：writer 无条件覆盖，不管 descriptor / 既有配置。
 *  - CAT_CAFE_API_URL：部署真相 — 回调必须指向当前运行的 API。
 *  - CAT_CAFE_READONLY：安全边界 — 持久化 MCP 必须保持只读。
 */
function buildAntigravityCatCafeEnforcedEnv(): Readonly<Record<string, string>> {
  return {
    CAT_CAFE_API_URL: process.env.CAT_CAFE_API_URL?.trim() || 'http://localhost:3004',
    CAT_CAFE_READONLY: 'true',
  };
}

function isCatCafeServer(name: string): boolean {
  return name === 'cat-cafe' || name.startsWith('cat-cafe-');
}

/**
 * 确保 cat-cafe-* MCP server 携带调用时回调 env 占位符。
 * Gemini / Kimi writer 共享（逻辑相同，原先重复）。
 */
function ensureCatCafeEnvPlaceholders(name: string, env?: Record<string, string>): Record<string, string> | undefined {
  if (!isCatCafeServer(name)) return env;
  return {
    ...CAT_CAFE_ENV_PLACEHOLDERS,
    ...(env ?? {}),
  };
}

function ensureAntigravityCatCafeEnv(name: string, env?: Record<string, string>): Record<string, string> | undefined {
  if (!isCatCafeServer(name)) return env;
  const safeEnv = { ...(env ?? {}) };
  delete safeEnv.CAT_CAFE_AGENT_KEY_SECRET;
  // 合并顺序：baseline（可填默认）→ 用户配置（可控键优先）→ 强制键（最高）。
  return {
    ...buildAntigravityCatCafeEnvBaseline(),
    ...safeEnv,
    ...buildAntigravityCatCafeEnforcedEnv(),
  };
}

// ────────── TOML 轻量解析（替代 smol-toml，仅需 [mcp_servers.*]）──────────

/**
 * 解析 Codex config.toml 的 mcp_servers 段。
 * 支持：`[mcp_servers.name]` / `[mcp_servers."quoted name"]` 表头、
 * `key = "string"`、`key = true/false`、`key = ["a", "b"]`（单行）。
 */
export function parseCodexTomlMcpServers(raw: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  let current: Record<string, unknown> | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      current = null;
      const header = line.slice(1, -1).trim();
      if (header.startsWith('mcp_servers.')) {
        const name = unquoteTomlKey(header.slice('mcp_servers.'.length));
        if (name) {
          current = {};
          result[name] = current;
        }
      }
      continue;
    }

    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = unquoteTomlKey(line.slice(0, eq).trim());
    const valueRaw = line.slice(eq + 1).trim();
    if (!key) continue;
    current[key] = parseTomlValue(valueRaw);
  }

  return result;
}

function unquoteTomlKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTomlValue(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part));
  }
  return raw;
}

// ────────── Readers ──────────

/** Read Claude .mcp.json → McpServerDescriptor[] */
export async function readClaudeMcpConfig(filePath: string): Promise<McpServerDescriptor[]> {
  const raw = await safeReadFile(filePath);
  if (!raw) return [];

  const data = safeJsonParse(raw);
  if (!data) return [];

  const servers = data.mcpServers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, cfg]) =>
    toDescriptor(name, cfg, true),
  );
}

/** Read Codex .codex/config.toml → McpServerDescriptor[] */
export async function readCodexMcpConfig(filePath: string): Promise<McpServerDescriptor[]> {
  const raw = await safeReadFile(filePath);
  if (!raw) return [];

  let mcpServers: Record<string, Record<string, unknown>>;
  try {
    mcpServers = parseCodexTomlMcpServers(raw);
  } catch {
    return [];
  }

  return Object.entries(mcpServers).map(([name, cfg]) => toDescriptor(name, cfg, cfg.enabled !== false));
}

/** Read Gemini .gemini/settings.json → McpServerDescriptor[] */
export async function readGeminiMcpConfig(filePath: string): Promise<McpServerDescriptor[]> {
  const raw = await safeReadFile(filePath);
  if (!raw) return [];

  const data = safeJsonParse(raw);
  if (!data) return [];

  const servers = data.mcpServers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, cfg]) =>
    toDescriptor(name, cfg, true),
  );
}

/** Read Kimi .kimi/mcp.json → McpServerDescriptor[] */
export async function readKimiMcpConfig(filePath: string): Promise<McpServerDescriptor[]> {
  const raw = await safeReadFile(filePath);
  if (!raw) return [];

  const data = safeJsonParse(raw);
  if (!data) return [];

  const servers = data.mcpServers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, cfg]) =>
    toDescriptor(name, cfg, true),
  );
}

/** Read Antigravity ~/.gemini/antigravity/mcp_config.json → McpServerDescriptor[] */
export async function readAntigravityMcpConfig(filePath: string): Promise<McpServerDescriptor[]> {
  const raw = await safeReadFile(filePath);
  if (!raw) return [];

  const data = safeJsonParse(raw);
  if (!data) return [];

  const servers = data.mcpServers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, cfg]) =>
    toDescriptor(name, normalizeAntigravityConfig(cfg), true),
  );
}

// ────────── Writers ──────────
// NOTE: Claude 与 Codex 使用调用时 CLI 注入（--mcp-config / --config）—
// 持久化文件 writer 已作为死代码移除。仅 Gemini / Kimi / Antigravity 需要持久化配置。

/** Write McpServerDescriptor[] → Gemini .gemini/settings.json（合并：保留用户非托管条目） */
export async function writeGeminiMcpConfig(filePath: string, servers: McpServerDescriptor[]): Promise<void> {
  // 读既有配置以保留非 MCP 段与用户自有 MCP 服务器
  const raw = await safeReadFile(filePath);
  let existing: Record<string, unknown> = {};
  if (raw) {
    const parsed = safeJsonParse(raw);
    if (parsed) existing = parsed;
  }

  const existingMcp: Record<string, unknown> =
    existing.mcpServers && typeof existing.mcpServers === 'object'
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};

  migrateOwnedPluginNames(existingMcp, servers);

  // 更新/添加托管条目；移除禁用的托管条目；保留用户自有条目
  for (const s of servers) {
    // 跳过 URL 型服务器 — Gemini 只支持 stdio。
    // 删除陈旧托管条目避免 Gemini 加载旧 stdio 配置。
    if (s.transport === 'streamableHttp') {
      delete existingMcp[s.name];
      continue;
    }
    if (!s.command || s.command.trim().length === 0) {
      delete existingMcp[s.name];
      continue;
    }
    if (s.enabled) {
      const entry: Record<string, unknown> = { command: s.command, args: s.args };
      const env = ensureCatCafeEnvPlaceholders(s.name, s.env);
      if (env && Object.keys(env).length > 0) entry.env = env;
      if (s.workingDir) entry.cwd = s.workingDir;
      existingMcp[s.name] = entry;
    } else {
      // 禁用的托管服务器 → 从配置移除（Gemini 无 enabled 字段）
      delete existingMcp[s.name];
    }
  }

  // 确保拆分 cat-cafe-* 条目有必需的 Gemini env 占位符。
  for (const [name, value] of Object.entries(existingMcp)) {
    if (!isCatCafeServer(name)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const cfg = value as Record<string, unknown>;
    const currentEnv = toStringRecord(cfg.env);
    cfg.env = ensureCatCafeEnvPlaceholders(name, currentEnv);
    existingMcp[name] = cfg;
  }

  existing.mcpServers = existingMcp;
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}

// ────────── Stale Override Cleanup ──────────

/**
 * 从 ~/.claude.json 的每项目 override 中移除 resolver 管理的 MCP 服务器。
 *
 * Claude Code 在 ~/.claude.json 中存储每项目 mcpServers，优先级高于
 * 项目级 .mcp.json。对 resolver 管理的服务器，.mcp.json 管线是权威 —
 * 任何每项目 override 要么已陈旧要么会在下次版本升级时陈旧，主动移除。
 * 全局 mcpServers 保持不变（优先级低于 .mcp.json，可能服务其他项目）。
 *
 * 返回被清理的服务器名列表。
 */
export async function cleanStaleClaudeProjectOverrides(
  claudeConfigPath: string,
  projectRoot: string,
  resolverBackedServers: string[],
): Promise<string[]> {
  if (resolverBackedServers.length === 0) return [];

  const raw = await safeReadFile(claudeConfigPath);
  if (!raw) return [];

  const data = safeJsonParse(raw);
  if (!data) return [];

  const cleaned: string[] = [];

  const projects = data.projects;
  if (projects && typeof projects === 'object') {
    const proj = (projects as Record<string, Record<string, unknown>>)[projectRoot];
    if (proj?.mcpServers && typeof proj.mcpServers === 'object') {
      const mcpServers = proj.mcpServers as Record<string, unknown>;
      for (const name of resolverBackedServers) {
        if (name in mcpServers) {
          delete mcpServers[name];
          cleaned.push(name);
        }
      }
    }
  }

  if (cleaned.length > 0) {
    await writeFile(claudeConfigPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }

  return cleaned;
}

/** Write McpServerDescriptor[] → Kimi .kimi/mcp.json（合并：保留用户非托管条目） */
export async function writeKimiMcpConfig(filePath: string, servers: McpServerDescriptor[]): Promise<void> {
  const raw = await safeReadFile(filePath);
  let existing: Record<string, unknown> = {};
  if (raw) {
    const parsed = safeJsonParse(raw);
    if (parsed) existing = parsed;
  }

  const existingMcp: Record<string, unknown> =
    existing.mcpServers && typeof existing.mcpServers === 'object'
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};

  for (const s of servers) {
    if (!s.enabled) {
      delete existingMcp[s.name];
      continue;
    }
    if (s.transport === 'streamableHttp') {
      if (!s.url?.trim()) {
        delete existingMcp[s.name];
        continue;
      }
      const entry: Record<string, unknown> = { url: s.url };
      if (s.headers && Object.keys(s.headers).length > 0) entry.headers = s.headers;
      existingMcp[s.name] = entry;
      continue;
    }
    if (!s.command || s.command.trim().length === 0) {
      delete existingMcp[s.name];
      continue;
    }
    const entry: Record<string, unknown> = { command: s.command, args: s.args };
    const env = ensureCatCafeEnvPlaceholders(s.name, s.env);
    if (env && Object.keys(env).length > 0) entry.env = env;
    if (s.workingDir) entry.cwd = s.workingDir;
    existingMcp[s.name] = entry;
  }

  for (const [name, value] of Object.entries(existingMcp)) {
    if (!isCatCafeServer(name)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const cfg = value as Record<string, unknown>;
    const currentEnv = toStringRecord(cfg.env);
    cfg.env = ensureCatCafeEnvPlaceholders(name, currentEnv);
    existingMcp[name] = cfg;
  }

  existing.mcpServers = existingMcp;
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}

/** Write McpServerDescriptor[] → Antigravity ~/.gemini/antigravity/mcp_config.json */
export async function writeAntigravityMcpConfig(filePath: string, servers: McpServerDescriptor[]): Promise<void> {
  const raw = await safeReadFile(filePath);
  let existing: Record<string, unknown> = {};
  if (raw) {
    const parsed = safeJsonParse(raw);
    if (parsed) existing = parsed;
  }

  const existingMcp: Record<string, unknown> =
    existing.mcpServers && typeof existing.mcpServers === 'object'
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};

  migrateOwnedPluginNames(existingMcp, servers);

  for (const s of servers) {
    if (s.transport === 'streamableHttp') {
      delete existingMcp[s.name];
      continue;
    }
    if (!s.command || s.command.trim().length === 0 || !s.enabled) {
      delete existingMcp[s.name];
      continue;
    }
    const entry: Record<string, unknown> = { command: s.command, args: s.args };
    const env = ensureAntigravityCatCafeEnv(s.name, s.env);
    if (env && Object.keys(env).length > 0) entry.env = env;
    if (s.workingDir) entry.cwd = s.workingDir;
    existingMcp[s.name] = entry;
  }

  for (const [name, value] of Object.entries(existingMcp)) {
    if (!isCatCafeServer(name)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const cfg = value as Record<string, unknown>;
    const currentEnv = toStringRecord(cfg.env);
    cfg.env = ensureAntigravityCatCafeEnv(name, currentEnv);
    existingMcp[name] = cfg;
  }

  existing.mcpServers = existingMcp;
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}

/**
 * 将 server descriptor 转换为 OpenCode 的 MCP 条目格式。
 * 导出供调用时使用（无文件 I/O 的格式转换）。
 */
export function toOpenCodeMcpEntry(s: { command: string; args?: readonly string[]; env?: Record<string, string> }): {
  type: string;
  command: string[];
  environment?: Record<string, string>;
} {
  const entry: { type: string; command: string[]; environment?: Record<string, string> } = {
    type: 'local',
    command: [s.command, ...(s.args ?? [])],
  };
  if (s.env && Object.keys(s.env).length > 0) entry.environment = s.env;
  return entry;
}

export function toOpenCodeRemoteMcpEntry(s: { url: string; headers?: Record<string, string> }): {
  type: 'remote';
  url: string;
  enabled: true;
  headers?: Record<string, string>;
} {
  const entry: { type: 'remote'; url: string; enabled: true; headers?: Record<string, string> } = {
    type: 'remote',
    url: s.url,
    enabled: true,
  };
  if (s.headers && Object.keys(s.headers).length > 0) entry.headers = s.headers;
  return entry;
}

/** Write McpServerDescriptor[] → OpenCode opencode.json mcp 段（合并：保留 provider/model 配置） */
export async function writeOpenCodeMcpConfig(filePath: string, servers: McpServerDescriptor[]): Promise<void> {
  const raw = await safeReadFile(filePath);
  let existing: Record<string, unknown> = {};
  if (raw) {
    const parsed = safeJsonParse(raw);
    if (parsed) existing = parsed;
  }

  const existingMcp: Record<string, unknown> =
    existing.mcp && typeof existing.mcp === 'object' ? { ...(existing.mcp as Record<string, unknown>) } : {};

  for (const s of servers) {
    if (!s.enabled) {
      delete existingMcp[s.name];
      continue;
    }
    if (s.transport === 'streamableHttp') {
      if (s.url) {
        existingMcp[s.name] = toOpenCodeRemoteMcpEntry({
          url: s.url,
          ...(s.headers !== undefined ? { headers: s.headers } : {}),
        });
      } else delete existingMcp[s.name];
      continue;
    }
    if (!s.command || s.command.trim().length === 0) {
      delete existingMcp[s.name];
      continue;
    }
    existingMcp[s.name] = toOpenCodeMcpEntry(s);
  }

  existing.mcp = existingMcp;
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}

// ────────── Helpers ──────────

async function safeReadFile(filePath?: string): Promise<string | null> {
  if (!filePath) return null;
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string');
}

function toStringRecord(val: unknown): Record<string, string> | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    result[k] = String(v);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeAntigravityConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  if (typeof cfg.serverUrl === 'string' && cfg.serverUrl && typeof cfg.url !== 'string') {
    return { ...cfg, url: cfg.serverUrl };
  }
  return cfg;
}

function toDescriptor(name: string, cfg: Record<string, unknown>, enabled: boolean): McpServerDescriptor {
  const isHttp =
    cfg.type === 'streamableHttp' || cfg.type === 'http' || (typeof cfg.url === 'string' && cfg.url.length > 0);
  const desc: McpServerDescriptor = {
    name,
    command: typeof cfg.command === 'string' ? cfg.command : '',
    args: toStringArray(cfg.args),
    enabled,
    source: 'external',
  };
  if (isHttp) {
    desc.transport = 'streamableHttp';
    if (typeof cfg.url === 'string' && cfg.url) desc.url = cfg.url;
    const headers = toStringRecord(cfg.headers);
    if (headers) desc.headers = headers;
  }
  const env = toStringRecord(cfg.env);
  if (env) desc.env = env;
  const cwd = cfg.cwd;
  if (typeof cwd === 'string' && cwd) desc.workingDir = cwd;
  return desc;
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}
