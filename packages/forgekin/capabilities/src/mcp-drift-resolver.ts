/**
 * MCP Drift Resolver — F249（B11 补建）。
 *
 * TS 重写自 clowder-ai `api/src/mcp/mcp-drift-resolver.ts`，补建到
 * `@flowforge/forgekin-capabilities`。
 *
 * 与 `mcp-drift-detector.ts`（只读 drift 报告）互补：本模块消费 drift.issues，
 * 应用三类修复——add（global-new）、remove（project-orphan）、update/skip
 * （config-mismatch，按 per-issue 决策或 conflictPolicy），并回写 `mcpSync`
 * 状态。纯配置级操作，不涉及 symlink 备份（skill drift 才需要）。
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - 读/写/锁 → `capability-orchestrator` 的 readCapabilitiesConfig /
 *     writeCapabilitiesConfig / withCapabilityLock（包内复用）
 *   - 哈希/抽取 → `mcp-drift-detector` 的 computeGlobalMcpHash / extractMcpEntries
 *   - mcpServer / globalEnabled / pluginId 等可选字段用条件展开，
 *     满足项目 exactOptionalPropertyTypes 严格约束
 */

import type { CapabilitiesConfig, CapabilityEntry } from '@flowforge/cats-shared';

import { readCapabilitiesConfig, withCapabilityLock, writeCapabilitiesConfig } from './capability-orchestrator.ts';
import { computeGlobalMcpHash, extractMcpEntries, type McpDriftResult, type McpIssue } from './mcp-drift-detector.ts';

// ── Types ────────────────────────────────────────────────────────────────────

/** MCP drift 修复的合法决策（resolver 契约）。 */
export const VALID_MCP_DRIFT_DECISIONS = new Set(['use-global', 'keep-project'] as const);

export interface McpDriftResolution {
  mcpId: string;
  /** use-global: 用全局配置覆盖项目。keep-project: 保留项目配置（跳过）。 */
  decision: 'use-global' | 'keep-project';
}

export interface McpDriftSyncReport {
  /** 因 global-new 而新增到项目的 MCP id。 */
  added: string[];
  /** 因 project-orphan 而从项目移除的 MCP id。 */
  removed: string[];
  /** config-mismatch 且决策 use-global 并已更新的 MCP id。 */
  updated: string[];
  /** config-mismatch 且决策 keep-project 而保留的 MCP id。 */
  skipped: string[];
  /** 修复后的全局 MCP 配置哈希。 */
  syncedHash: string;
}

// ── syncMcpDrift ─────────────────────────────────────────────────────────────

/**
 * 修复一个项目的 MCP drift（spec《Capability Storage》§6.4）。
 *
 * @param projectRoot - 项目目录
 * @param catCafeRoot - 主项目（全局配置）目录
 * @param drift - `checkMcpProject` 产出的 drift 结果
 * @param resolutions - 逐条决策（config-mismatch 用）；优先于 conflictPolicy
 * @param conflictPolicy - config-mismatch 的缺省决策：
 *   'use-global'（默认，覆盖项目配置）| 'keep-project'（保留项目配置）
 */
export function syncMcpDrift(
  projectRoot: string,
  catCafeRoot: string,
  drift: McpDriftResult,
  resolutions?: McpDriftResolution[],
  conflictPolicy?: 'use-global' | 'keep-project',
): Promise<McpDriftSyncReport> {
  return withCapabilityLock(projectRoot, () =>
    syncMcpDriftUnlocked(projectRoot, catCafeRoot, drift, resolutions, conflictPolicy),
  );
}

async function syncMcpDriftUnlocked(
  projectRoot: string,
  catCafeRoot: string,
  drift: McpDriftResult,
  resolutions?: McpDriftResolution[],
  conflictPolicy?: 'use-global' | 'keep-project',
): Promise<McpDriftSyncReport> {
  const added: string[] = [];
  const removed: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  const resolutionMap = new Map((resolutions ?? []).map((r) => [r.mcpId, r.decision]));

  // 读取全局配置（stdout source of truth）
  const globalConfig = await readCapabilitiesConfig(catCafeRoot);
  const globalMcpMap = new Map(extractMcpEntries(globalConfig).map((e) => [e.id, e]));

  let projectConfig = await readCapabilitiesConfig(projectRoot);
  if (!projectConfig) {
    projectConfig = { version: 2, capabilities: [] };
  }

  // 逐类修复 drift issue
  for (const issue of drift.issues) {
    switch (issue.type) {
      case 'global-new':
        resolveGlobalNew(issue, globalMcpMap, projectConfig, added);
        break;
      case 'project-orphan':
        resolveProjectOrphan(issue, projectConfig, removed);
        break;
      case 'config-mismatch':
        resolveConfigMismatch(issue, globalMcpMap, projectConfig, resolutionMap, updated, skipped, conflictPolicy);
        break;
    }
  }

  // 更新 mcpSync 状态
  const globalMcpEntries = extractMcpEntries(globalConfig);
  const syncedHash = computeGlobalMcpHash(globalMcpEntries);
  projectConfig.mcpSync = {
    sourceConfigHash: syncedHash,
    lastSyncedAt: new Date().toISOString(),
    ...(projectConfig.mcpSync?.cascadeDisabledMcps?.length
      ? { cascadeDisabledMcps: projectConfig.mcpSync.cascadeDisabledMcps }
      : {}),
  };

  await writeCapabilitiesConfig(projectRoot, projectConfig);

  return { added, removed, updated, skipped, syncedHash };
}

// ── 各类 issue 的 resolver ──────────────────────────────────────────────────

/** global-new → 将 MCP 条目加入项目（blockedCats=[]）。 */
function resolveGlobalNew(
  issue: McpIssue,
  globalMcpMap: Map<string, CapabilityEntry>,
  projectConfig: CapabilitiesConfig,
  added: string[],
): void {
  const globalEntry = globalMcpMap.get(issue.mcpId);
  if (!globalEntry) return;

  projectConfig.capabilities.push({
    id: globalEntry.id,
    type: 'mcp',
    enabled: globalEntry.enabled,
    ...(globalEntry.globalEnabled !== undefined ? { globalEnabled: globalEntry.globalEnabled } : {}),
    source: globalEntry.source,
    ...(globalEntry.mcpServer ? { mcpServer: { ...globalEntry.mcpServer } } : {}),
    blockedCats: [],
    ...(globalEntry.pluginId ? { pluginId: globalEntry.pluginId } : {}),
  });
  added.push(issue.mcpId);
}

/** project-orphan → 从项目移除 MCP 条目。 */
function resolveProjectOrphan(issue: McpIssue, projectConfig: CapabilitiesConfig, removed: string[]): void {
  projectConfig.capabilities = projectConfig.capabilities.filter(
    (cap) => !(cap.type === 'mcp' && cap.id === issue.mcpId),
  );
  removed.push(issue.mcpId);
}

/**
 * config-mismatch → 按决策 use-global / keep-project。
 * 优先级：per-issue resolution > conflictPolicy > 'use-global'（默认）。
 */
function resolveConfigMismatch(
  issue: McpIssue,
  globalMcpMap: Map<string, CapabilityEntry>,
  projectConfig: CapabilitiesConfig,
  resolutionMap: Map<string, 'use-global' | 'keep-project'>,
  updatedList: string[],
  skippedList: string[],
  conflictPolicy?: 'use-global' | 'keep-project',
): void {
  const decision = resolutionMap.get(issue.mcpId) ?? conflictPolicy ?? 'use-global';

  if (decision === 'keep-project') {
    skippedList.push(issue.mcpId);
    return;
  }

  // use-global: 覆盖 mcpServer + 清除 mcpServerOverride
  const globalEntry = globalMcpMap.get(issue.mcpId);
  if (!globalEntry) return;

  const projectEntry = projectConfig.capabilities.find((cap) => cap.type === 'mcp' && cap.id === issue.mcpId);
  if (!projectEntry) return;

  if (globalEntry.mcpServer) {
    projectEntry.mcpServer = { ...globalEntry.mcpServer };
  } else {
    delete projectEntry.mcpServer;
  }
  // 清除 override — spec §6.4: "删除 mcpServerOverride，回到使用全局配置"
  delete projectEntry.mcpServerOverride;
  if (globalEntry.globalEnabled !== undefined) {
    projectEntry.globalEnabled = globalEntry.globalEnabled;
  } else {
    delete projectEntry.globalEnabled;
  }
  projectEntry.enabled = globalEntry.enabled ?? true;

  updatedList.push(issue.mcpId);
}