/**
 * Capability Orchestrator — F041 配置编排器
 *
 * 读取 `.cat-cafe/capabilities.json` 唯一真相源，
 * 结合 cat → provider 映射（调用方注入），
 * 生成各客户端 CLI 的 MCP 配置文件。
 *
 * 首次运行时自动从现有 CLI 配置中发现外部 MCP 服务器，
 * 连同自有托管 MCP 一起写入 capabilities.json。
 *
 * 移植自 clowder-ai `config/capabilities/capability-orchestrator.ts`。
 * 裁剪与改造：
 *   - 移除全部 Pencil 专用代码 → 泛化为注入式 `McpResolverRegistry`
 *   - 移除 retired-github-mcp 清理步骤
 *   - `catRegistry` 模块单例 → `CapabilityCatBinding[]` 参数注入
 *   - `resolveCatCafeSkillsSource()` 自动探测 → `skillsSource` 参数注入
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, stat as statPath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { CapabilitiesConfig, CapabilityEntry, McpServerDescriptor } from '@flowforge/cats-shared';
import { migrateCapabilitiesV1ToV2 } from './capabilities-migration.ts';
import {
  cleanStaleClaudeProjectOverrides,
  readAntigravityMcpConfig,
  readClaudeMcpConfig,
  readCodexMcpConfig,
  readGeminiMcpConfig,
  readKimiMcpConfig,
  writeAntigravityMcpConfig,
  writeGeminiMcpConfig,
} from './mcp-config-adapters.ts';

// #712: Re-export shared MCP constants from mcp-constants.ts (single source of truth).
// Consumers import from this file for backwards compatibility.
export {
  CAT_CAFE_SPLIT_ENTRYPOINTS,
  expandManagedMcpNamesForUserMerge,
  MCP_CALLBACK_ENV_KEYS,
  resolveCatCafeNodeCommand,
  SENSITIVE_KEY_PATTERNS,
  summarizeMcpInjection,
} from './mcp-constants.ts';

// ────────── Injection contracts (替代 clowder-ai 的模块级依赖) ──────────

/**
 * 泛化的 MCP 命令解析器 — 将机器相关的 stdio 服务器
 * （clowder-ai 中硬编码为 pencil）解析为本地可执行命令。
 * 返回 null 表示本机未安装/不可解析。
 */
export type McpCommandResolver = (options?: {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
}) => Promise<{ command: string; args: string[] } | null>;

/** Resolver 名 → 解析函数映射（注入式；默认无解析器）。 */
export type McpResolverRegistry = Record<string, McpCommandResolver>;

/** cat → provider 绑定（flowforge 中由插件服务从 ctx.cats 映射后注入）。 */
export interface CapabilityCatBinding {
  catId: string;
  /** CatConfig.clientId（anthropic / openai / google / kimi / ...） */
  provider: string;
}

// ────────── F146: Per-project mutex for capability config writes ──────────

const capabilityLocks = new Map<string, Promise<unknown>>();
const capabilityLockContext = new AsyncLocalStorage<Set<string>>();

export function withCapabilityLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const heldLocks = capabilityLockContext.getStore();
  if (heldLocks?.has(projectRoot)) {
    return Promise.resolve().then(fn);
  }

  const prev = capabilityLocks.get(projectRoot) ?? Promise.resolve();
  const run = () => {
    const nextHeldLocks = new Set(heldLocks ?? []);
    nextHeldLocks.add(projectRoot);
    return capabilityLockContext.run(nextHeldLocks, fn);
  };
  const next = prev.then(run, run);
  capabilityLocks.set(projectRoot, next);
  const cleanup = () => {
    if (capabilityLocks.get(projectRoot) === next) capabilityLocks.delete(projectRoot);
  };
  next.then(cleanup, cleanup);
  return next;
}

// ────────── Constants ──────────

const CAPABILITIES_FILENAME = 'capabilities.json';
const CONFIG_SUBDIR = '.cat-cafe';
const MCP_RESOLVED_FILENAME = 'mcp-resolved.json';

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;
const SCHEME_LIKE_SPEC_RE = /^[A-Za-z][A-Za-z\d+.-]*:[^\\/]/;
const LOCAL_ARTIFACT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.json',
  '.yaml',
  '.yml',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.cmd',
  '.bat',
]);

type ResolvedMcpStatus = 'resolved' | 'unresolved';

export interface ResolvedMcpStateEntry {
  resolver: string;
  status: ResolvedMcpStatus;
  command?: string;
  args?: string[];
}

export type ResolvedMcpState = Record<string, ResolvedMcpStateEntry>;

/**
 * Provider → CLI config writer mapping.
 *
 * Only providers whose CLI reads persistent on-disk config files AND has no
 * invoke-time MCP override mechanism are listed here:
 *
 *   - Gemini: `gemini` CLI reads `.gemini/settings.json` natively; no --mcp-config flag.
 *   - Antigravity: `agy` CLI reads `~/.gemini/antigravity/mcp_config.json`; no override flag.
 *
 * NOT listed (all use invoke-time injection, persistent write is redundant):
 *   - Claude: `--mcp-config JSON --strict-mcp-config` at invoke time
 *   - Codex: `--config mcp_servers.X...` inline overrides at invoke time
 *   - Kimi: temp mcp.json via `writeMcpConfigFile` + `--mcp-config-file`
 *   - OpenCode: temp opencode.json via `writeOpenCodeRuntimeConfig` + `OPENCODE_CONFIG`
 */
const PROVIDER_WRITERS = {
  google: writeGeminiMcpConfig,
  antigravity: writeAntigravityMcpConfig,
} as const;

type CliConfigSnapshot = { kind: 'missing' } | { kind: 'file'; data: Buffer; mode: number } | { kind: 'other' };

async function snapshotCliConfigPath(path: string): Promise<CliConfigSnapshot> {
  try {
    const stat = await lstat(path);
    if (stat.isFile()) return { kind: 'file', data: await readFile(path), mode: stat.mode & 0o7777 };
    if (stat.isSymbolicLink()) {
      const targetStat = await statPath(path).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      if (targetStat?.isFile()) return { kind: 'file', data: await readFile(path), mode: targetStat.mode & 0o7777 };
    }
    return { kind: 'other' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw err;
  }
}

async function restoreCliConfigPath(path: string, snapshot: CliConfigSnapshot): Promise<void> {
  if (snapshot.kind === 'other') return;
  if (snapshot.kind === 'missing') {
    await rm(path, { recursive: true, force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, snapshot.data, { mode: snapshot.mode });
  await chmod(path, snapshot.mode);
}

export const __testing = {
  snapshotCliConfigPath,
  restoreCliConfigPath,
};

/** Check if a descriptor has a usable transport (stdio command, local resolver, or streamableHttp URL). */
export function hasUsableTransport(desc: {
  command?: string;
  resolver?: string;
  transport?: string;
  url?: string;
}): boolean {
  if (desc.transport === 'streamableHttp') {
    return typeof desc.url === 'string' && desc.url.trim().length > 0;
  }
  if (typeof desc.resolver === 'string' && desc.resolver.trim().length > 0) {
    return true;
  }
  return typeof desc.command === 'string' && desc.command.trim().length > 0;
}

export interface RequiredMcpStatus {
  id: string;
  status: 'ready' | 'missing' | 'unresolved';
  reason: string;
}

function resolveHomeDir(env?: NodeJS.ProcessEnv): string {
  return env?.HOME || env?.USERPROFILE || homedir();
}

function resolveLocalPath(projectRoot: string, value: string, env?: NodeJS.ProcessEnv): string {
  const resolvedHome = resolveHomeDir(env);
  if (value === '~') return resolvedHome;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(resolvedHome, value.slice(2));
  }
  if (WINDOWS_DRIVE_PATH_RE.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    return value;
  }
  return resolve(projectRoot, value);
}

function isExecutableCommandPath(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function resolveCommandOnPath(command: string): string | null {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  if (pathEntries.length === 0) return null;

  const suffixes =
    process.platform === 'win32'
      ? extname(command)
        ? ['']
        : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .map((entry) => entry.trim())
            .filter(Boolean)
      : [''];

  for (const dir of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `${command}${suffix}`);
      if (isExecutableCommandPath(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function commandExists(projectRoot: string, command: string, env?: NodeJS.ProcessEnv): boolean {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\') || command.startsWith('.') || command.startsWith('~')) {
    return isExecutableCommandPath(resolveLocalPath(projectRoot, command, env));
  }
  return resolveCommandOnPath(command) !== null;
}

function extractArtifactCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const equalIndex = trimmed.indexOf('=');
  if (trimmed.startsWith('--') && equalIndex > 2 && equalIndex < trimmed.length - 1) {
    return trimmed.slice(equalIndex + 1);
  }
  return trimmed;
}

function isLikelyPackageSpecifier(value: string): boolean {
  return (
    value.startsWith('@') ||
    (SCHEME_LIKE_SPEC_RE.test(value) && !WINDOWS_DRIVE_PATH_RE.test(value) && !value.startsWith('~/'))
  );
}

function isLocalArtifactArg(value: unknown): boolean {
  const candidate = extractArtifactCandidate(value);
  if (!candidate || candidate.startsWith('-')) return false;
  if (URL_SCHEME_RE.test(candidate)) return false;
  if (isLikelyPackageSpecifier(candidate)) return false;
  if (
    candidate.startsWith('.') ||
    candidate.startsWith('~') ||
    candidate.startsWith('/') ||
    candidate.startsWith('\\') ||
    WINDOWS_DRIVE_PATH_RE.test(candidate)
  ) {
    return true;
  }
  if (candidate.includes('/') || candidate.includes('\\')) return true;
  return LOCAL_ARTIFACT_EXTENSIONS.has(extname(candidate).toLowerCase());
}

function referencedArtifactExists(projectRoot: string, args: unknown[] | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!Array.isArray(args)) return true;
  const artifactArgs = args.filter(isLocalArtifactArg).map(extractArtifactCandidate);
  if (artifactArgs.length === 0) return true;
  return artifactArgs.every(
    (artifactArg) => artifactArg && existsSync(resolveLocalPath(projectRoot, artifactArg, env)),
  );
}

/**
 * 解析某个必需 MCP 的本机可用状态。
 * 改造：clowder-ai 的 pencil 专用分支泛化为注入式 `resolvers` 映射 —
 * 声明了 `resolver` 字段的 MCP 通过对应解析器判定是否可解析。
 */
export async function resolveRequiredMcpStatus(
  mcpId: string,
  options: {
    capabilities?: CapabilitiesConfig | null;
    env?: NodeJS.ProcessEnv;
    projectRoot?: string;
    resolvers?: McpResolverRegistry;
  } = {},
): Promise<RequiredMcpStatus> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const capability = options.capabilities?.capabilities?.find((entry) => entry.id === mcpId && entry.type === 'mcp');
  if (!capability || (capability.globalEnabled ?? true) === false || !capability.mcpServer) {
    return {
      id: mcpId,
      status: 'missing',
      reason:
        (capability?.globalEnabled ?? true) === false
          ? 'declared but disabled in capabilities.json'
          : 'not declared in capabilities.json',
    };
  }

  const resolverName = capability.mcpServer.resolver?.trim();
  if (resolverName) {
    const resolverFn = options.resolvers?.[resolverName];
    if (!resolverFn) {
      return {
        id: mcpId,
        status: 'unresolved',
        reason: `resolver '${resolverName}' declared but no resolver registered`,
      };
    }
    const resolved = await resolverFn({
      ...(options.env !== undefined ? { env: options.env } : {}),
      projectRoot,
    });
    return resolved
      ? { id: mcpId, status: 'ready', reason: `resolved via ${resolverName}` }
      : { id: mcpId, status: 'unresolved', reason: `resolver '${resolverName}' declared but local resolution failed` };
  }

  const command = capability.mcpServer.command?.trim() ?? '';
  if (command && !commandExists(projectRoot, command, options.env)) {
    return {
      id: mcpId,
      status: 'unresolved',
      reason: `command not found: ${command}`,
    };
  }

  if (!referencedArtifactExists(projectRoot, capability.mcpServer.args, options.env)) {
    return {
      id: mcpId,
      status: 'unresolved',
      reason: 'command args reference missing local artifact',
    };
  }

  if (hasUsableTransport(capability.mcpServer)) {
    return {
      id: mcpId,
      status: 'ready',
      reason:
        capability.mcpServer.transport === 'streamableHttp'
          ? `remote ${capability.mcpServer.url?.trim() ?? ''}`.trim()
          : `stdio ${capability.mcpServer.command?.trim() ?? ''}`.trim(),
    };
  }

  return {
    id: mcpId,
    status: 'unresolved',
    reason: 'declared but missing usable command/url',
  };
}

type DiscoveredMcpLike = Pick<McpServerDescriptor, 'name' | 'enabled' | 'transport'>;

function shouldReplaceDiscoveredMcpServer<T extends DiscoveredMcpLike>(existing: T, incoming: T): boolean {
  if (existing.transport === 'streamableHttp' && incoming.transport !== 'streamableHttp') {
    return incoming.enabled !== false || existing.enabled !== true;
  }
  return existing.enabled === false && incoming.enabled !== false;
}

export function deduplicateDiscoveredMcpServers<T extends DiscoveredMcpLike>(servers: readonly T[]): T[] {
  const byName = new Map<string, T>();
  for (const server of servers) {
    const existing = byName.get(server.name);
    if (!existing || shouldReplaceDiscoveredMcpServer(existing, server)) {
      byName.set(server.name, server);
    }
  }
  return [...byName.values()];
}

// ────────── Core: Read / Write capabilities.json ──────────

/** Normalize and validate that a path stays within the project tree. */
function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

/**
 * Read capabilities.json without side effects. If the file is v1,
 * returns the in-memory v2-migrated form WITHOUT writing back to disk.
 * Use `migrateAndPersistCapabilities()` for explicit owner-gated migration.
 *
 * 改造：skillsSource 改为可选参数（缺省时 v1 迁移跳过 symlink 探测）。
 */
export async function readCapabilitiesConfig(
  projectRoot: string,
  skillsSource?: string,
): Promise<CapabilitiesConfig | null> {
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, CAPABILITIES_FILENAME);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as CapabilitiesConfig;
    if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.capabilities)) return null;
    let config: CapabilitiesConfig;
    if (data.version === 1) {
      config = await migrateCapabilitiesV1ToV2(projectRoot, data, skillsSource);
    } else {
      config = data;
    }
    // F228/F249: Fill globalEnabled for entries that lack it (field migration).
    // Client-side app — we migrate once at read time, no runtime compat needed.
    for (const cap of config.capabilities) {
      if (cap.globalEnabled === undefined && cap.enabled !== undefined) {
        cap.globalEnabled = cap.enabled;
      }
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * F228: Explicit owner-gated v1→v2 migration. Reads capabilities.json,
 * migrates if v1, and persists the migrated config back to disk.
 * Should only be called from write paths (bootstrap, PATCH, sync).
 */
export async function migrateAndPersistCapabilities(
  projectRoot: string,
  skillsSource?: string,
): Promise<CapabilitiesConfig | null> {
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, CAPABILITIES_FILENAME);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as CapabilitiesConfig;
    if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.capabilities)) return null;
    if (data.version === 1) {
      const migrated = await migrateCapabilitiesV1ToV2(projectRoot, data, skillsSource);
      try {
        await writeCapabilitiesConfig(projectRoot, migrated);
      } catch (err) {
        console.warn(`[capabilities] Failed to persist v1->v2 migration for ${projectRoot}: ${(err as Error).message}`);
      }
      return migrated;
    }
    // F228/F249: Fill globalEnabled for entries that lack it (field migration).
    // Client-side app — we migrate once at init, no runtime compat needed.
    let needsPersist = false;
    for (const cap of data.capabilities) {
      if (cap.globalEnabled === undefined && cap.enabled !== undefined) {
        cap.globalEnabled = cap.enabled;
        needsPersist = true;
      }
    }
    if (needsPersist) {
      try {
        await writeCapabilitiesConfig(projectRoot, data);
      } catch (err) {
        console.warn(
          `[capabilities] Failed to persist globalEnabled migration for ${projectRoot}: ${(err as Error).message}`,
        );
      }
    }
    return data;
  } catch {
    return null;
  }
}

export async function writeCapabilitiesConfig(projectRoot: string, config: CapabilitiesConfig): Promise<void> {
  const dir = safePath(projectRoot, CONFIG_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, CAPABILITIES_FILENAME);
  // #712 review P1-2: atomic write — temp file + rename prevents TOCTOU / partial-write corruption
  // Use PID + UUID to ensure uniqueness across concurrent async writes within the same process.
  // PID-only caused ENOENT when multiple @mentions triggered parallel capability writes (#1049).
  const tmpPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  await rename(tmpPath, filePath);
}

function writeCapabilitiesConfigSync(projectRoot: string, config: CapabilitiesConfig): void {
  const dir = safePath(projectRoot, CONFIG_SUBDIR);
  mkdirSync(dir, { recursive: true });
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, CAPABILITIES_FILENAME);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw err;
  }
}

export function inheritFullyBlockedMcpCapabilitiesForNewCatInConfig(
  config: CapabilitiesConfig,
  newCatId: string,
  existingCatIds: ReadonlySet<string>,
): boolean {
  const existingIds = [...existingCatIds].filter((id) => id !== newCatId);
  if (existingIds.length === 0) return false;

  let changed = false;
  for (const cap of config.capabilities) {
    if (cap.type !== 'mcp' || !Array.isArray(cap.blockedCats)) continue;
    const blocked = new Set(cap.blockedCats);
    if (blocked.has(newCatId)) continue;
    if (!existingIds.every((id) => blocked.has(id))) continue;

    cap.blockedCats = [...cap.blockedCats, newCatId];
    changed = true;
  }

  return changed;
}

export function inheritFullyBlockedMcpCapabilitiesForNewCatsSync(
  projectRoot: string,
  newCatIds: readonly string[],
  existingCatIds: ReadonlySet<string>,
): boolean {
  if (newCatIds.length === 0) return false;

  const filePath = safePath(projectRoot, CONFIG_SUBDIR, CAPABILITIES_FILENAME);
  let config: CapabilitiesConfig;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as CapabilitiesConfig;
    if (data.version !== 2 || !Array.isArray(data.capabilities)) return false;
    config = data;
  } catch {
    return false;
  }

  let changed = false;
  const inheritedIds = new Set(existingCatIds);
  for (const newCatId of newCatIds) {
    if (inheritFullyBlockedMcpCapabilitiesForNewCatInConfig(config, newCatId, inheritedIds)) {
      changed = true;
    }
    inheritedIds.add(newCatId);
  }

  if (changed) writeCapabilitiesConfigSync(projectRoot, config);
  return changed;
}

export async function inheritFullyBlockedMcpCapabilitiesForNewCat(
  projectRoot: string,
  newCatId: string,
  existingCatIds: ReadonlySet<string>,
): Promise<boolean> {
  return withCapabilityLock(projectRoot, async () => {
    const existingIds = [...existingCatIds].filter((id) => id !== newCatId);
    if (existingIds.length === 0) return false;

    const config = await readCapabilitiesConfig(projectRoot);
    if (!config) return false;

    const changed = inheritFullyBlockedMcpCapabilitiesForNewCatInConfig(config, newCatId, new Set(existingIds));

    if (changed) await writeCapabilitiesConfig(projectRoot, config);
    return changed;
  });
}

/**
 * Remove a deleted cat from blockedCats in all MCP entries of a single project.
 *
 * Counterpart to inheritFullyBlockedMcpCapabilitiesForNewCat — when a cat is
 * removed, its ID should not linger in blockedCats arrays. Stale entries are
 * harmless at runtime (unknown IDs are simply ignored) but create confusion
 * in the UI where the ghost ID would still appear in the blocked list.
 */
export async function removeDeletedCatFromBlockedMcps(projectRoot: string, deletedCatId: string): Promise<boolean> {
  return withCapabilityLock(projectRoot, async () => {
    const config = await readCapabilitiesConfig(projectRoot);
    if (!config) return false;

    let changed = false;
    for (const cap of config.capabilities) {
      if (cap.type !== 'mcp' || !Array.isArray(cap.blockedCats)) continue;
      const idx = cap.blockedCats.indexOf(deletedCatId);
      if (idx === -1) continue;

      cap.blockedCats = cap.blockedCats.filter((id) => id !== deletedCatId);
      changed = true;
    }

    if (changed) await writeCapabilitiesConfig(projectRoot, config);
    return changed;
  });
}

export async function readResolvedMcpState(projectRoot: string): Promise<ResolvedMcpState> {
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, MCP_RESOLVED_FILENAME);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as ResolvedMcpState;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function writeResolvedMcpState(projectRoot: string, state: ResolvedMcpState): Promise<void> {
  const dir = safePath(projectRoot, CONFIG_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = safePath(projectRoot, CONFIG_SUBDIR, MCP_RESOLVED_FILENAME);
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

// ────────── Discovery: Bootstrap from existing CLI configs ──────────

export interface DiscoveryPaths {
  claudeConfig: string; // e.g. <projectRoot>/.mcp.json
  codexConfig: string; // e.g. <projectRoot>/.codex/config.toml
  geminiConfig: string; // e.g. <projectRoot>/.gemini/settings.json
  kimiConfig: string; // e.g. <projectRoot>/.kimi/mcp.json
  antigravityConfig?: string; // e.g. ~/.gemini/antigravity/mcp_config.json
}

/**
 * Discover external MCP servers from all CLI configs.
 * Merges by name; if same name appears in multiple, first wins.
 */
export async function discoverExternalMcpServers(paths: DiscoveryPaths): Promise<McpServerDescriptor[]> {
  const tagged = await discoverExternalMcpServersTagged(paths);
  return tagged.map(({ server }) => server);
}

export interface TaggedMcpServer {
  server: McpServerDescriptor;
  /** Source config label, e.g. "claude", "codex", "gemini", "kimi", "antigravity" */
  discoveredFrom: string;
}

/**
 * Discover external MCP servers with source tracking.
 * Each server is tagged with which config file it was found in.
 * Dedup uses the same enabled-preference logic as the untagged variant.
 */
export async function discoverExternalMcpServersTagged(paths: DiscoveryPaths): Promise<TaggedMcpServer[]> {
  const [claude, codex, gemini, kimi, antigravity] = await Promise.all([
    readClaudeMcpConfig(paths.claudeConfig),
    readCodexMcpConfig(paths.codexConfig),
    readGeminiMcpConfig(paths.geminiConfig),
    readKimiMcpConfig(paths.kimiConfig),
    paths.antigravityConfig ? readAntigravityMcpConfig(paths.antigravityConfig) : Promise.resolve([]),
  ]);
  const batches: { servers: McpServerDescriptor[]; tag: string }[] = [
    { servers: claude, tag: 'claude' },
    { servers: codex, tag: 'codex' },
    { servers: gemini, tag: 'gemini' },
    { servers: kimi, tag: 'kimi' },
    { servers: antigravity, tag: 'antigravity' },
  ];
  const all: TaggedMcpServer[] = [];
  for (const { servers, tag } of batches) {
    for (const server of servers) {
      if (!hasUsableTransport(server)) continue;
      all.push({ server: { ...server, source: 'external' as const }, discoveredFrom: tag });
    }
  }
  // Deduplicate using the same enabled-preference logic as deduplicateDiscoveredMcpServers.
  const byName = new Map<string, TaggedMcpServer>();
  for (const tagged of all) {
    const existing = byName.get(tagged.server.name);
    if (!existing || shouldReplaceDiscoveredMcpServer(existing.server, tagged.server)) {
      byName.set(tagged.server.name, tagged);
    }
  }
  return [...byName.values()];
}

/**
 * Build the managed own MCP server descriptor.
 */
export function buildCatCafeMcpDescriptor(projectRoot: string): McpServerDescriptor {
  const serverPath = resolve(projectRoot, 'packages/mcp-server/dist/index.js');
  return {
    name: 'cat-cafe',
    command: 'node',
    args: [serverPath],
    enabled: true,
    source: 'cat-cafe',
  };
}

// F193 Phase C: split-only topology — the split servers replace the legacy
// all-in-one server for fresh managed installs. F207 Phase B0 adds the
// finance read-only data plane as its own split server.
const CAT_CAFE_SPLIT_SERVER_IDS = [
  'cat-cafe-collab',
  'cat-cafe-memory',
  'cat-cafe-signals',
  'cat-cafe-limb',
  'cat-cafe-audio',
  'cat-cafe-finance',
] as const;

const CAT_CAFE_SUPPLEMENTAL_SPLIT_SERVERS = [
  { id: 'cat-cafe-limb', entrypoint: 'limb.js' },
  { id: 'cat-cafe-audio', entrypoint: 'audio.js' },
  { id: 'cat-cafe-finance', entrypoint: 'finance.js' },
] as const;

/**
 * Resolve the runtime binary root (where managed MCP server code lives).
 *
 * Order of precedence:
 *   1. CAT_CAFE_RUNTIME_ROOT env (highest — runtime startup explicit override)
 *   2. explicit caller opt (e.g. multi-project setups)
 *   3. process.cwd() fallback
 */
export function resolveBinaryRoot(explicit?: string): string {
  const runtimeRoot = process.env.CAT_CAFE_RUNTIME_ROOT?.trim();
  if (runtimeRoot) return runtimeRoot;
  if (explicit) return explicit;
  return process.cwd();
}

function buildCatCafeSplitMcpDescriptors(binaryRoot: string): McpServerDescriptor[] {
  return [
    {
      name: 'cat-cafe-collab',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/collab.js')],
      enabled: true,
      source: 'cat-cafe',
    },
    {
      name: 'cat-cafe-memory',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/memory.js')],
      enabled: true,
      source: 'cat-cafe',
    },
    {
      name: 'cat-cafe-signals',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/signals.js')],
      enabled: true,
      source: 'cat-cafe',
    },
    {
      // F193 Phase C: limb tools get their own namespace.
      name: 'cat-cafe-limb',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/limb.js')],
      enabled: true,
      source: 'cat-cafe',
    },
    {
      // F195: audio capture/transcription tools get their own split server.
      name: 'cat-cafe-audio',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/audio.js')],
      enabled: true,
      source: 'cat-cafe',
    },
    {
      // F207 Phase B0: finance facts get a dedicated read-only data plane.
      name: 'cat-cafe-finance',
      command: 'node',
      args: [resolve(binaryRoot, 'packages/mcp-server/dist/finance.js')],
      enabled: true,
      source: 'cat-cafe',
    },
  ];
}

export function toCapabilityEntry(server: McpServerDescriptor): CapabilityEntry {
  const entry: CapabilityEntry = {
    id: server.name,
    type: 'mcp',
    enabled: server.enabled,
    source: server.source,
    mcpServer: {
      command: server.command,
      args: server.args,
    },
  };
  if (server.transport) entry.mcpServer!.transport = server.transport;
  if (server.resolver) entry.mcpServer!.resolver = server.resolver;
  if (server.url) entry.mcpServer!.url = server.url;
  if (server.headers) entry.mcpServer!.headers = server.headers;
  if (server.env) entry.mcpServer!.env = server.env;
  if (server.workingDir) entry.mcpServer!.workingDir = server.workingDir;
  return entry;
}

type LegacyCatCafeSeed = {
  enabled: boolean;
  overrides?: CapabilityEntry['overrides'];
  env?: Record<string, string>;
  workingDir?: string;
};

function buildSplitCapabilityEntries(projectRoot: string, legacySeed?: LegacyCatCafeSeed): CapabilityEntry[] {
  const descriptors = buildCatCafeSplitMcpDescriptors(projectRoot);
  const entries = descriptors.map((descriptor) => {
    const entry = toCapabilityEntry(descriptor);
    if (legacySeed) {
      entry.enabled = legacySeed.enabled;
      entry.globalEnabled = legacySeed.enabled;
      if (legacySeed.overrides) {
        const blocked = legacySeed.overrides.filter((o) => !o.enabled).map((o) => o.catId);
        if (blocked.length > 0) entry.blockedCats = blocked;
      }
      if (legacySeed.env) {
        entry.mcpServer!.env = { ...legacySeed.env };
      }
      if (legacySeed.workingDir) {
        entry.mcpServer!.workingDir = legacySeed.workingDir;
      }
    }
    return entry;
  });
  return entries;
}

export function migrateLegacyCatCafeCapability(
  config: CapabilitiesConfig,
  opts?: { catCafeRepoRoot?: string; projectRoot?: string },
): { migrated: boolean; config: CapabilitiesConfig } {
  // `projectRoot` is workspace, NOT binary root. Use resolveBinaryRoot for the
  // binary path. The opts.projectRoot field is accepted for backward-compatible
  // callers but ignored for path resolution.
  const splitSet = new Set<string>(CAT_CAFE_SPLIT_SERVER_IDS);

  // hasSplit must filter by source. External MCP servers reusing split ids
  // are ID collisions, not "already split".
  const hasManagedSplit = config.capabilities.some(
    (cap) => cap.type === 'mcp' && cap.source === 'cat-cafe' && splitSet.has(cap.id),
  );
  if (hasManagedSplit) return { migrated: false, config };

  const legacyCatCafe = config.capabilities.find(
    (cap) => cap.type === 'mcp' && cap.source === 'cat-cafe' && cap.id === 'cat-cafe',
  );
  if (!legacyCatCafe) return { migrated: false, config };

  // Collision guard: if any planned managed split id is already taken by a
  // non-managed entry, bail out. Adding duplicate ids would corrupt
  // capabilities.json.
  const existingIds = new Set(config.capabilities.filter((cap) => cap.type === 'mcp').map((cap) => cap.id));
  const wouldCollide = CAT_CAFE_SPLIT_SERVER_IDS.some((id) => existingIds.has(id));
  if (wouldCollide) return { migrated: false, config };

  const binaryRoot = resolveBinaryRoot(opts?.catCafeRepoRoot);
  const nextCapabilities = config.capabilities.filter((cap) => cap.id !== 'cat-cafe');
  const legacySeed: LegacyCatCafeSeed = { enabled: legacyCatCafe.globalEnabled ?? legacyCatCafe.enabled };
  if (legacyCatCafe.overrides) legacySeed.overrides = legacyCatCafe.overrides;
  if (legacyCatCafe.mcpServer?.env) legacySeed.env = legacyCatCafe.mcpServer.env;
  if (legacyCatCafe.mcpServer?.workingDir) legacySeed.workingDir = legacyCatCafe.mcpServer.workingDir;
  const splitEntries = buildSplitCapabilityEntries(binaryRoot, legacySeed);
  for (const splitEntry of splitEntries) {
    nextCapabilities.unshift(splitEntry);
  }
  return {
    migrated: true,
    config: {
      ...config,
      capabilities: nextCapabilities,
    },
  };
}

/**
 * 改造：clowder-ai 的 pencil 专用迁移泛化 — 凡 id 命中注入的
 * `resolverIds` 的 MCP 条目，归一为 `{ resolver: <id>, command: '', args: [] }`
 * resolver-backed 形态。
 */
export function migrateResolverBackedCapabilities(
  config: CapabilitiesConfig,
  opts?: { resolverIds?: readonly string[] },
): { migrated: boolean; config: CapabilitiesConfig } {
  const resolverIds = new Set(opts?.resolverIds ?? []);
  if (resolverIds.size === 0) return { migrated: false, config };

  let migrated = false;
  const capabilities = config.capabilities.map((cap) => {
    if (cap.type !== 'mcp' || !resolverIds.has(cap.id)) return cap;

    const current = cap.mcpServer;
    const nextServer = {
      ...(current ?? {}),
      resolver: cap.id,
      command: '',
      args: [] as string[],
    };

    const changed =
      current?.resolver !== cap.id ||
      current?.command !== '' ||
      (current?.args?.length ?? 0) > 0 ||
      current === undefined;

    if (!changed) return cap;
    migrated = true;
    return { ...cap, mcpServer: nextServer };
  });

  if (!migrated) return { migrated: false, config };
  return { migrated: true, config: { ...config, capabilities } };
}

/**
 * F193 Phase C: split-only direction.
 *   1. If all-in-one `cat-cafe` entry exists → REMOVE it once supplemental splits are available
 *   2. If core splits exist but supplemental splits are missing → ADD them
 *      (limb for F193, finance for F207)
 *
 * Splits without main is the new canonical state.
 */
export function ensureCatCafeMainServer(
  config: CapabilitiesConfig,
  opts?: { catCafeRepoRoot?: string; projectRoot?: string },
): { migrated: boolean; config: CapabilitiesConfig } {
  const splitSet = new Set<string>(CAT_CAFE_SPLIT_SERVER_IDS);

  // Match by `source === 'cat-cafe'` AND id — an external MCP server that
  // happens to reuse split IDs must NOT trigger this managed-cafe migration path.
  const isManagedSplit = (cap: CapabilityEntry): boolean =>
    cap.type === 'mcp' && cap.source === 'cat-cafe' && splitSet.has(cap.id);
  const isManagedMain = (cap: CapabilityEntry): boolean =>
    cap.type === 'mcp' && cap.source === 'cat-cafe' && cap.id === 'cat-cafe';

  // Require the full canonical 3-split set (collab + memory + signals) before
  // any migration. Migrating a partial config would silently remove the only
  // source of memory/signal tools — a data-plane regression.
  const splitIds = new Set(config.capabilities.filter(isManagedSplit).map((cap) => cap.id));
  const hasFullSplitSet =
    splitIds.has('cat-cafe-collab') && splitIds.has('cat-cafe-memory') && splitIds.has('cat-cafe-signals');
  if (!hasFullSplitSet) return { migrated: false, config };

  // Compute supplemental split availability before mutating anything.
  // Detect external entries whose binary IS the repo's own split entrypoint
  // (suffix match on `packages/mcp-server/dist/{entrypoint}`); require
  // `enabled: true` and normalize backslash for Windows paths.
  const isSameRepoExternalSplit = (cap: CapabilityEntry, id: string, entrypoint: string): boolean => {
    if (cap.type !== 'mcp' || cap.id !== id || cap.source !== 'external') return false;
    if ((cap.globalEnabled ?? true) !== true) return false;
    const arg0 = cap.mcpServer?.args?.[0];
    if (typeof arg0 !== 'string') return false;
    const posixArg = arg0.replace(/\\/g, '/');
    return posixArg.endsWith(`packages/mcp-server/dist/${entrypoint}`);
  };
  const supplementalAvailability = CAT_CAFE_SUPPLEMENTAL_SPLIT_SERVERS.map(({ id, entrypoint }) => {
    const hasManaged = config.capabilities.some((cap) => isManagedSplit(cap) && cap.id === id);
    const hasAnyId = config.capabilities.some((cap) => cap.type === 'mcp' && cap.id === id);
    const canAddManaged = !hasAnyId;
    const hasSameRepoExternal = config.capabilities.some((cap) => isSameRepoExternalSplit(cap, id, entrypoint));
    return {
      id,
      hasAnyId,
      willHaveManaged: hasManaged || canAddManaged || hasSameRepoExternal,
    };
  });

  // Capture legacy managed `cat-cafe` settings BEFORE any decision — its
  // enabled/overrides/env represent user intent for the split tools.
  const legacyMain = config.capabilities.find(isManagedMain);

  // Only remove legacy `cat-cafe` if managed supplemental splits will be
  // available afterwards. Otherwise the user loses that tool surface entirely.
  const canProvideAllSupplementalSplits = supplementalAvailability.every((split) => split.willHaveManaged);
  const shouldRemoveLegacyMain = legacyMain !== undefined && canProvideAllSupplementalSplits;

  // If we can't safely complete migration, bail out entirely to preserve
  // the existing tool surface.
  if (legacyMain !== undefined && !shouldRemoveLegacyMain) {
    return { migrated: false, config };
  }

  let migrated = false;
  let capabilities = [...config.capabilities];

  // Step 1: remove legacy all-in-one managed `cat-cafe` if present.
  if (shouldRemoveLegacyMain) {
    capabilities = capabilities.filter((cap) => !isManagedMain(cap));
    migrated = true;
  }

  // Step 2: ensure managed supplemental splits exist alongside core splits.
  // The existence check uses id alone — if ANY entry (managed OR external)
  // already claims an id, we must NOT add another.
  const binaryRoot = resolveBinaryRoot(opts?.catCafeRepoRoot);
  const descriptors = buildCatCafeSplitMcpDescriptors(binaryRoot);
  for (const split of supplementalAvailability) {
    if (split.hasAnyId) continue;
    const descriptor = descriptors.find((d) => d.name === split.id);
    if (descriptor) {
      const splitEntry = toCapabilityEntry(descriptor);
      // P1 inheritance precedence:
      //   1. legacy managed `cat-cafe` (if exists) — it hosted these tools
      //   2. first existing managed split (fallback for fresh 3-split install)
      const inheritFrom = legacyMain ?? capabilities.find(isManagedSplit);
      if (inheritFrom) {
        const inheritedEnabled = inheritFrom.globalEnabled ?? inheritFrom.enabled;
        splitEntry.enabled = inheritedEnabled;
        splitEntry.globalEnabled = inheritedEnabled;
        if (inheritFrom.overrides) {
          const blocked = inheritFrom.overrides.filter((o) => !o.enabled).map((o) => o.catId);
          if (blocked.length > 0) splitEntry.blockedCats = blocked;
        }
        if (inheritFrom.mcpServer?.env) splitEntry.mcpServer!.env = { ...inheritFrom.mcpServer.env };
        if (inheritFrom.mcpServer?.workingDir) splitEntry.mcpServer!.workingDir = inheritFrom.mcpServer.workingDir;
      }
      // Insert near other managed splits (keep config readable)
      const lastSplitIdx = (() => {
        let lastIdx = -1;
        for (let i = 0; i < capabilities.length; i++) {
          const cap = capabilities[i];
          if (cap && isManagedSplit(cap)) lastIdx = i;
        }
        return lastIdx;
      })();
      if (lastSplitIdx >= 0) {
        capabilities.splice(lastSplitIdx + 1, 0, splitEntry);
      } else {
        capabilities.push(splitEntry);
      }
      migrated = true;
    }
  }

  return migrated ? { migrated: true, config: { ...config, capabilities } } : { migrated: false, config };
}

/**
 * Rewrite managed MCP command paths to a stable repo root.
 * This prevents global provider configs from pinning deleted feature worktrees.
 */
export function realignManagedCatCafeServerPaths(
  config: CapabilitiesConfig,
  opts?: { catCafeRepoRoot?: string; projectRoot?: string },
): { migrated: boolean; config: CapabilitiesConfig } {
  // Only act when the caller has an explicit signal (catCafeRepoRoot opt OR
  // runtime env) — falling back to process.cwd() here could clobber valid
  // paths every time the process moves cwd.
  if (!opts?.catCafeRepoRoot && !process.env.CAT_CAFE_RUNTIME_ROOT) {
    return { migrated: false, config };
  }
  const binaryRoot = resolveBinaryRoot(opts?.catCafeRepoRoot);

  const desiredById = new Map<string, McpServerDescriptor>([
    ['cat-cafe', buildCatCafeMcpDescriptor(binaryRoot)],
    ...buildCatCafeSplitMcpDescriptors(binaryRoot).map((descriptor) => [descriptor.name, descriptor] as const),
  ]);

  let migrated = false;
  const capabilities = config.capabilities.map((cap) => {
    if (cap.type !== 'mcp' || cap.source !== 'cat-cafe' || !cap.mcpServer) return cap;
    const desired = desiredById.get(cap.id);
    if (!desired) return cap;

    const currentCommand = cap.mcpServer.command ?? '';
    const currentArgs = cap.mcpServer.args ?? [];
    const sameCommand = currentCommand === desired.command;
    const sameArgs =
      currentArgs.length === desired.args.length && currentArgs.every((arg, idx) => arg === desired.args[idx]);
    if (sameCommand && sameArgs) return cap;

    migrated = true;
    return {
      ...cap,
      mcpServer: {
        ...cap.mcpServer,
        command: desired.command,
        args: [...desired.args],
      },
    };
  });

  if (!migrated) return { migrated: false, config };
  return { migrated: true, config: { ...config, capabilities } };
}

// ────────── Bootstrap: Create initial capabilities.json ──────────

/**
 * Bootstrap capabilities.json from discovery.
 * Called once on first run (when capabilities.json doesn't exist).
 */
export async function bootstrapCapabilities(
  projectRoot: string,
  discoveryPaths: DiscoveryPaths,
  opts?: { catCafeRepoRoot?: string; resolvers?: McpResolverRegistry },
): Promise<CapabilitiesConfig> {
  // `projectRoot` is the workspace project root (where capabilities.json gets
  // written). It is NOT the binary root — those are conceptually different.
  const catCafeRepoRoot = resolveBinaryRoot(opts?.catCafeRepoRoot);
  const catCafeServers = buildCatCafeSplitMcpDescriptors(catCafeRepoRoot);
  const externals = await discoverExternalMcpServers(discoveryPaths);

  const capabilities: CapabilityEntry[] = [];

  // F193/F207 split-only direction — only split servers
  // (collab/memory/signals/limb/audio/finance), no all-in-one.
  for (const entry of buildSplitCapabilityEntries(catCafeRepoRoot)) {
    capabilities.push(entry);
  }

  // Add discovered external MCP servers
  const splitNames = new Set(catCafeServers.map((s) => s.name));
  for (const ext of externals) {
    // Skip built-in server names if already discovered from existing config
    if (ext.name === 'cat-cafe' || splitNames.has(ext.name)) continue;
    capabilities.push(toCapabilityEntry(ext));
  }

  const config: CapabilitiesConfig = { version: 2, capabilities };
  const resolverMigrated = migrateResolverBackedCapabilities(config, {
    resolverIds: Object.keys(opts?.resolvers ?? {}),
  });
  // Fill globalEnabled for fresh entries (matches readCapabilitiesConfig in-memory migration)
  for (const cap of resolverMigrated.config.capabilities) {
    if (cap.globalEnabled === undefined && cap.enabled !== undefined) {
      cap.globalEnabled = cap.enabled;
    }
  }
  await writeCapabilitiesConfig(projectRoot, resolverMigrated.config);
  return resolverMigrated.config;
}

/**
 * #1049: Ensure all managed split MCP servers exist in capabilities.json.
 *
 * Catches the gap where capabilities.json exists but managed MCPs are partially
 * or entirely missing (e.g., manual deletion, corrupt bootstrap, or migration
 * from an older version that didn't create all splits).
 *
 * Unlike `migrateLegacyCatCafeCapability` (requires legacy `cat-cafe` entry) or
 * `ensureCatCafeMainServer` (requires core 3 splits to already exist), this
 * function unconditionally ensures ALL 6 managed split servers are present.
 *
 * Newly added entries inherit enabled/blockedCats from the first existing
 * managed split (if any), maintaining user intent for the managed MCP surface.
 */
export function ensureCoreManagedMcps(
  config: CapabilitiesConfig,
  opts?: { catCafeRepoRoot?: string },
): { migrated: boolean; config: CapabilitiesConfig } {
  const binaryRoot = resolveBinaryRoot(opts?.catCafeRepoRoot);
  const descriptors = buildCatCafeSplitMcpDescriptors(binaryRoot);

  // #1049 partial-legacy: detect legacy `cat-cafe` entry with `overrides`.
  // ensureCatCafeMainServer (step 3) will remove the legacy entry later —
  // we must propagate its overrides→blockedCats to splits HERE to preserve them.
  const legacyMain = config.capabilities.find(
    (cap) => cap.type === 'mcp' && cap.source === 'cat-cafe' && cap.id === 'cat-cafe',
  );
  const legacyBlockedCats = legacyMain?.overrides
    ? legacyMain.overrides.filter((o) => !o.enabled).map((o) => o.catId)
    : [];

  // Check which managed splits already exist (by source + id).
  // Exclude plugin MCPs (source='cat-cafe' + pluginId) — they are user-installed
  // extensions, not built-in splits.
  const isBuiltinManaged = (cap: CapabilityEntry): boolean =>
    cap.type === 'mcp' && cap.source === 'cat-cafe' && !cap.pluginId;
  const existingManagedIds = new Set(config.capabilities.filter(isBuiltinManaged).map((cap) => cap.id));

  // Find missing managed splits
  const missingDescriptors = descriptors.filter((d) => !existingManagedIds.has(d.name));

  // Nothing to add AND no legacy overrides to propagate → no-op
  if (missingDescriptors.length === 0 && legacyBlockedCats.length === 0) {
    return { migrated: false, config };
  }

  // Collision guard: skip any managed split whose id is already taken by
  // a non-managed entry (same logic as migrateLegacyCatCafeCapability).
  const allMcpIds = new Set(config.capabilities.filter((cap) => cap.type === 'mcp').map((cap) => cap.id));
  const safeToAdd = missingDescriptors.filter((d) => !allMcpIds.has(d.name));

  // #1049 upstream P2: all-or-nothing when legacy is active.
  // If legacy main exists and some splits are collision-blocked by non-managed
  // MCPs, adding only the non-colliding splits would create duplicate tool
  // exposure. Clear the add set; legacy overrides propagation below still runs.
  if (legacyMain && missingDescriptors.length > 0 && safeToAdd.length < missingDescriptors.length) {
    safeToAdd.splice(0);
  }

  // No splits to add AND no legacy overrides to propagate → no-op
  if (safeToAdd.length === 0 && legacyBlockedCats.length === 0) {
    return { migrated: false, config };
  }

  let migrated = false;
  const capabilities = [...config.capabilities];

  // P1 inheritance priority (matches ensureCatCafeMainServer):
  //   1. Legacy main (if exists) — it hosted these split tools
  //   2. First existing managed split (fallback for installs with no legacy main)
  const inheritFrom = legacyMain ?? capabilities.find((cap) => isBuiltinManaged(cap) && cap.id !== 'cat-cafe');

  for (const descriptor of safeToAdd) {
    const entry = toCapabilityEntry(descriptor);
    if (inheritFrom) {
      const inheritedEnabled = inheritFrom.globalEnabled ?? inheritFrom.enabled ?? true;
      entry.enabled = inheritedEnabled;
      entry.globalEnabled = inheritedEnabled;
      if (inheritFrom.blockedCats && inheritFrom.blockedCats.length > 0) {
        entry.blockedCats = [...inheritFrom.blockedCats];
      }
      if (inheritFrom.mcpServer?.env) {
        entry.mcpServer!.env = { ...inheritFrom.mcpServer.env };
      }
      if (inheritFrom.mcpServer?.workingDir) {
        entry.mcpServer!.workingDir = inheritFrom.mcpServer.workingDir;
      }
    }

    // Legacy overrides→blockedCats take precedence over inherited blockedCats
    if (legacyBlockedCats.length > 0) {
      entry.blockedCats = [...legacyBlockedCats];
    }

    // Insert near other managed splits for readability
    const lastManagedIdx = (() => {
      let lastIdx = -1;
      for (let i = 0; i < capabilities.length; i++) {
        const cap = capabilities[i];
        if (cap && cap.type === 'mcp' && cap.source === 'cat-cafe') lastIdx = i;
      }
      return lastIdx;
    })();

    if (lastManagedIdx >= 0) {
      capabilities.splice(lastManagedIdx + 1, 0, entry);
    } else {
      // No managed MCPs at all — prepend (managed MCPs conventionally come first)
      capabilities.unshift(entry);
    }
    migrated = true;
  }

  // Propagate legacy overrides→blockedCats to existing managed splits.
  // Union with any existing blockedCats so pre-existing per-cat restrictions
  // are preserved AND legacy-blocked cats are not silently unblocked.
  if (legacyBlockedCats.length > 0) {
    for (let i = 0; i < capabilities.length; i++) {
      const cap = capabilities[i]!;
      if (isBuiltinManaged(cap) && cap.id !== 'cat-cafe') {
        const existing = cap.blockedCats ?? [];
        const merged = [...new Set([...existing, ...legacyBlockedCats])];
        if (merged.length !== existing.length) {
          capabilities[i] = { ...cap, blockedCats: merged };
          migrated = true;
        }
      }
    }
  }

  if (!migrated) {
    return { migrated: false, config };
  }

  return { migrated: true, config: { ...config, capabilities } };
}

/**
 * F193 Phase C: shared migration chain for any code path that mutates
 * capabilities.json or generates CLI configs from it.
 *
 * Single source of truth: every config read → full chain → write/CLI-gen.
 * Order matters:
 *   1. migrateLegacyCatCafeCapability — legacy 1-server → split servers
 *   1.5 ensureCoreManagedMcps — restore any missing managed splits (#1049)
 *       (AFTER legacy migration so overrides→blockedCats conversion happens first)
 *   2. migrateResolverBackedCapabilities — resolver-backed paths (注入式)
 *   3. ensureCatCafeMainServer — split topology (remove legacy, add supplemental splits)
 *   4. realignManagedCatCafeServerPaths — stable binary path realignment
 *
 * 裁剪：移除 clowder-ai 的 retireGithubMcpCapabilities 步骤。
 */
export function healCatCafeMcpTopology(
  config: CapabilitiesConfig,
  opts?: { catCafeRepoRoot?: string; projectRoot?: string; resolverIds?: readonly string[] },
): { migrated: boolean; config: CapabilitiesConfig } {
  const a = migrateLegacyCatCafeCapability(config, opts);
  // #1049: ensure managed splits AFTER legacy migration.
  // Legacy migration converts overrides→blockedCats; running ensureCoreManagedMcps
  // first would skip that conversion, silently re-enabling blocked cats.
  const z = ensureCoreManagedMcps(a.config, opts);
  const b = migrateResolverBackedCapabilities(z.config, opts);
  const c = ensureCatCafeMainServer(b.config, opts);
  const d = realignManagedCatCafeServerPaths(c.config, opts);
  return {
    migrated: a.migrated || z.migrated || b.migrated || c.migrated || d.migrated,
    config: d.config,
  };
}

// ────────── Orchestrate: Generate CLI configs from capabilities.json ──────────

/**
 * Provider → persistent config file path mapping.
 *
 * Only providers that read persistent on-disk config files at startup
 * (no invoke-time MCP override CLI flag) are listed here.
 * Claude, Codex, Kimi, OpenCode all do invoke-time injection and are excluded.
 */
export interface CliConfigPaths {
  google: string; // e.g. <projectRoot>/.gemini/settings.json
  antigravity?: string; // e.g. ~/.gemini/antigravity/mcp_config.json
}

/** Providers that support streamableHttp transport (URL-based MCP). */
const STREAMABLE_HTTP_PROVIDERS = new Set(['anthropic', 'openai', 'kimi', 'opencode']);

interface ResolveServersForCatOptions {
  /** global = globalEnabled is the master switch; project = blockedCats is the project access source. */
  accessScope?: 'global' | 'project';
  /**
   * 目标 cat 的 provider（clientId）— 调用方注入。
   * 改造：clowder-ai 从 catRegistry 模块单例读取；flowforge 无模块级注册表。
   */
  provider?: string;
}

/**
 * Determine whether an MCP capability is enabled for a specific cat.
 * Single source of truth for per-cat MCP access resolution (invoke-time).
 *
 * - `globalEnabled` = master switch (off → all cats disabled)
 * - `enabled` = legacy field; used as fallback when `globalEnabled` is absent
 * - `blockedCats` = per-cat blacklist (cat in list → disabled)
 */
export function isMcpEnabledForCat(
  cap: CapabilityEntry,
  catId: string,
  options: ResolveServersForCatOptions = {},
): boolean {
  if (options.accessScope === 'project' && Array.isArray(cap.blockedCats)) {
    return !cap.blockedCats.includes(catId);
  }
  if (!(cap.globalEnabled ?? cap.enabled ?? true)) return false;
  return !cap.blockedCats?.includes(catId);
}

/**
 * Resolve effective MCP servers for a specific cat from a single config.
 *
 * - blockedCats filtering: catId in blockedCats → skip
 * - mcpServerOverride > mcpServer: project override takes full priority
 * - globalEnabled / per-cat overrides: used for global-context board display
 */
export function resolveServersForCat(
  config: CapabilitiesConfig,
  catId: string,
  options: ResolveServersForCatOptions = {},
): McpServerDescriptor[] {
  const provider = options.provider;

  const result: McpServerDescriptor[] = [];
  /** Track cap.id → encoded name for collision detection. */
  const nameOrigin = new Map<string, string>();

  for (const cap of config.capabilities) {
    if (cap.type !== 'mcp') continue;

    // Priority: mcpServerOverride > mcpServer
    const mcpServer = cap.mcpServerOverride ?? cap.mcpServer;
    if (!mcpServer) continue;

    // Per-cat access: single source of truth via isMcpEnabledForCat
    const enabledFromConfig = isMcpEnabledForCat(cap, catId, options);

    const transportSupported =
      mcpServer.transport === 'streamableHttp'
        ? provider !== undefined && STREAMABLE_HTTP_PROVIDERS.has(provider) && !!mcpServer.url?.trim()
        : hasUsableTransport(mcpServer);
    const enabled = enabledFromConfig && transportSupported;

    // MCP server names must not contain colons — Codex uses `mcp:<name>/<tool>`
    // convention, so colons in the name break tool resolution. Plugin capability
    // IDs use `plugin:pluginId:resourceName`; replace `:` with `__` (double
    // underscore) for the external-facing server name.
    const name = cap.id.replace(/:/g, '__');

    // Collision guard: reject if a different cap.id already mapped to the same
    // encoded name (e.g. `plugin:a:b__c` vs `plugin:a:b:c`).
    const priorCapId = nameOrigin.get(name);
    if (priorCapId !== undefined && priorCapId !== cap.id) {
      console.warn(
        `[resolveServersForCat] MCP name collision: "${cap.id}" and "${priorCapId}" ` +
          `both encode to "${name}". Skipping duplicate.`,
      );
      continue;
    }
    nameOrigin.set(name, cap.id);

    const desc: McpServerDescriptor = {
      name,
      capabilityId: cap.id,
      command: mcpServer.command,
      args: mcpServer.args ?? [],
      enabled,
      // Plugin MCPs are stored as source=cat-cafe + pluginId so capability
      // governance can distinguish them from user-owned externals. Runtime
      // descriptors must expose their actual ownership.
      source: cap.pluginId ? 'plugin' : cap.source,
    };
    if (mcpServer.transport) desc.transport = mcpServer.transport;
    if (mcpServer.resolver) desc.resolver = mcpServer.resolver;
    if (mcpServer.url) desc.url = mcpServer.url;
    if (mcpServer.headers) desc.headers = mcpServer.headers;
    if (mcpServer.env) desc.env = mcpServer.env;
    if (mcpServer.workingDir) desc.workingDir = mcpServer.workingDir;
    result.push(desc);
  }

  return result;
}

/**
 * Group cats by provider, collecting the union of servers each provider needs.
 * A server is included for a provider if ANY cat of that provider has it enabled.
 * 改造：cat 列表由调用方注入（clowder-ai 遍历 catRegistry.getAllIds()）。
 */
function collectServersPerProvider(
  config: CapabilitiesConfig,
  cats: readonly CapabilityCatBinding[],
): Record<string, McpServerDescriptor[]> {
  const providerServers: Record<string, Map<string, McpServerDescriptor>> = {};

  for (const { catId, provider } of cats) {
    if (!providerServers[provider]) {
      providerServers[provider] = new Map();
    }

    const servers = resolveServersForCat(config, catId, { accessScope: 'project', provider });
    for (const s of servers) {
      // If any cat of this provider has it enabled, it's enabled for the provider
      const existing = providerServers[provider].get(s.name);
      if (!existing || (s.enabled && !existing.enabled)) {
        providerServers[provider].set(s.name, s);
      }
    }
  }

  const result: Record<string, McpServerDescriptor[]> = {};
  for (const [provider, serverMap] of Object.entries(providerServers)) {
    result[provider] = Array.from(serverMap.values());
  }
  return result;
}

/** 匹配 server 应使用的已注册 resolver 名（resolver 字段优先，其次按名称）。 */
function matchResolverName(server: McpServerDescriptor, resolvers: McpResolverRegistry): string | undefined {
  if (server.resolver && resolvers[server.resolver]) return server.resolver;
  if (resolvers[server.name]) return server.name;
  return undefined;
}

/**
 * 改造：clowder-ai 的 pencil 专用解析泛化为注入式 `resolvers` 映射 —
 * 凡声明了已注册 resolver 的 server，解析为本地命令或标记为 unresolved。
 */
export async function resolveMachineSpecificServers(
  perProvider: Record<string, McpServerDescriptor[]>,
  options: {
    projectRoot?: string;
    env?: NodeJS.ProcessEnv;
    resolvers?: McpResolverRegistry;
  } = {},
): Promise<void> {
  const resolvers = options.resolvers ?? {};
  const resolvedState: ResolvedMcpState = {};

  // 收集需要解析的 resolver 名并批量解析（每个解析器只调用一次）
  const needed = new Set<string>();
  for (const servers of Object.values(perProvider)) {
    for (const server of servers) {
      const resolverName = matchResolverName(server, resolvers);
      if (resolverName) needed.add(resolverName);
    }
  }
  const resolvedByName = new Map<string, { command: string; args: string[] } | null>();
  for (const resolverName of needed) {
    const resolverFn = resolvers[resolverName];
    if (!resolverFn) continue;
    resolvedByName.set(
      resolverName,
      await resolverFn(options.env !== undefined ? { env: options.env } : {}),
    );
  }

  for (const servers of Object.values(perProvider)) {
    for (const server of servers) {
      const resolverName = matchResolverName(server, resolvers);
      if (!resolverName) continue;

      const resolved = resolvedByName.get(resolverName) ?? null;
      if (!resolved) {
        server.command = '';
        server.args = [];
        server.enabled = false;
        server.resolver = resolverName;
        resolvedState[server.name] = { resolver: resolverName, status: 'unresolved' };
        continue;
      }

      server.command = resolved.command;
      server.args = resolved.args;
      server.resolver = resolverName;
      resolvedState[server.name] = {
        resolver: resolverName,
        status: 'resolved',
        command: resolved.command,
        args: resolved.args,
      };
    }
  }

  if (options.projectRoot) {
    await writeResolvedMcpState(options.projectRoot, resolvedState);
  }
}

/**
 * Generate persistent CLI config files from capabilities.json.
 *
 * Only writes configs for providers in PROVIDER_WRITERS (Gemini, Antigravity).
 * Claude, Codex, Kimi, OpenCode all use invoke-time injection and are skipped.
 */
export async function generateCliConfigs(
  config: CapabilitiesConfig,
  paths: CliConfigPaths,
  projectRoot: string,
  opts?: { cats?: readonly CapabilityCatBinding[]; resolvers?: McpResolverRegistry },
): Promise<void> {
  const perProvider = collectServersPerProvider(config, opts?.cats ?? []);
  await resolveMachineSpecificServers(perProvider, {
    projectRoot,
    ...(opts?.resolvers !== undefined ? { resolvers: opts.resolvers } : {}),
  });
  const configPaths = Object.values(paths).filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
  const snapshots = await Promise.all(
    configPaths.map(async (path) => ({ path, snapshot: await snapshotCliConfigPath(path) })),
  );

  const writes: Promise<void>[] = [];
  for (const [provider, servers] of Object.entries(perProvider)) {
    const writer = PROVIDER_WRITERS[provider as keyof typeof PROVIDER_WRITERS];
    const path = paths[provider as keyof CliConfigPaths];
    if (writer && path) {
      writes.push(writer(path, servers));
    }
  }

  const results = await Promise.allSettled(writes);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    await Promise.all(snapshots.map(({ path, snapshot }) => restoreCliConfigPath(path, snapshot).catch(() => {})));
    throw failure.reason;
  }

  // Best-effort: clean resolver-managed per-project overrides from ~/.claude.json (F145 Phase D).
  // Per-project mcpServers shadow .mcp.json (higher priority), causing silent MCP failures
  // when the binary path becomes outdated. Global mcpServers are left untouched.
  const resolverBacked = config.capabilities.filter((c) => c.type === 'mcp' && c.mcpServer?.resolver).map((c) => c.id);
  if (resolverBacked.length > 0) {
    try {
      const claudeConfigPath = resolve(homedir(), '.claude.json');
      const cleaned = await cleanStaleClaudeProjectOverrides(claudeConfigPath, projectRoot, resolverBacked);
      if (cleaned.length > 0) {
        console.warn(`[F145] Cleaned resolver-managed overrides from ~/.claude.json: ${cleaned.join(', ')}`);
      }
    } catch (err) {
      console.warn(`[F145] Failed to clean ~/.claude.json overrides (non-blocking): ${(err as Error).message}`);
    }
  }
}

/**
 * Full orchestration flow:
 * 1. Read or bootstrap capabilities.json
 * 2. Heal managed MCP topology
 * 3. Generate CLI configs
 */
export async function orchestrate(
  projectRoot: string,
  discoveryPaths: DiscoveryPaths,
  cliConfigPaths: CliConfigPaths,
  opts?: {
    catCafeRepoRoot?: string;
    cats?: readonly CapabilityCatBinding[];
    resolvers?: McpResolverRegistry;
    skillsSource?: string;
  },
): Promise<CapabilitiesConfig> {
  const resolverIds = Object.keys(opts?.resolvers ?? {});
  let config = await readCapabilitiesConfig(projectRoot, opts?.skillsSource);
  if (!config) {
    config = await bootstrapCapabilities(projectRoot, discoveryPaths, opts);
  } else {
    const rootOpts = opts?.catCafeRepoRoot
      ? { projectRoot, catCafeRepoRoot: opts.catCafeRepoRoot, resolverIds }
      : { projectRoot, resolverIds };
    const healed = healCatCafeMcpTopology(config, rootOpts);
    config = healed.config;
    if (healed.migrated) {
      await writeCapabilitiesConfig(projectRoot, config);
    }
  }
  await generateCliConfigs(config, cliConfigPaths, projectRoot, opts);

  return config;
}
