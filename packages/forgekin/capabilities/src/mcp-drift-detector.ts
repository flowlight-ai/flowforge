/**
 * MCP Drift Detector — F249（B11 补建）。
 *
 * TS 重写自 clowder-ai `api/src/mcp/mcp-drift-detector.ts`，补建到
 * `@flowforge/forgekin-capabilities`（只读 drift 报告前端）。
 *
 * 与 `healCatCafeMcpTopology`（单配置迁移/拓扑修复）互补：本项目负责
 * **跨项目** global vs project 配置 drift 检测，产出三类 issue——
 *   - global-new：全局新增，项目未同步
 *   - project-orphan：项目残留、全局已删（non-external）
 *   - config-mismatch：项目配置与全局不一致（mcpServer 变更，可选 override）
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - capabilities.json 读取 → `readCapabilitiesConfig`（包内）
 *   - 项目枚举 → 注入式 `listProjectPaths` 端口（避免 caps↔gov 循环依赖；
 *     缺省递归读取 capabilities.json#mcpSync? 无 → 仅返回调用方传入的主项目）
 *   - drift 分类 / 哈希保持纯函数，便于零 mock 契约测试
 */

import { createHash } from 'node:crypto';
import type { CapabilitiesConfig, CapabilityEntry } from '@flowforge/cats-shared';

import { readCapabilitiesConfig } from './capability-orchestrator.ts';

// ── Types ────────────────────────────────────────────────────────────────────

/** MCP drift issue type（与 spec《Capability Storage》§6.2 对齐）。 */
export type McpIssueType = 'global-new' | 'project-orphan' | 'config-mismatch';

export interface McpIssue {
  type: McpIssueType;
  mcpId: string;
  message: string;
  /** 项目条目是否有 override（config-mismatch 相关）。 */
  hasOverride?: boolean;
  /** 拥有该条目的插件（project-orphan 来自插件 MCP 时携带）。 */
  pluginId?: string;
}

export interface McpDriftResult {
  issues: McpIssue[];
  /** 全局 + 项目状态哈希，用于变更检测。 */
  driftHash: string;
  summary: { new: number; orphan: number; mismatch: number };
}

export interface McpGlobalDriftResult {
  perProject: Array<{ path: string; result: McpDriftResult }>;
  totalSummary: { new: number; orphan: number; mismatch: number; projectsWithDrift: number };
}

/** 项目枚举端口（避免 caps↔gov 循环依赖）。调用方注入 governance.listAllProjectPaths。 */
export interface McpDriftDetectorDeps {
  listProjectPaths: (hubRoot: string) => Promise<string[]>;
}

// ── Canonical serialization（可复用，sync 侧同样使用）──────────────────────

/**
 * JSON.stringify 递归按键排序——确定性哈希。避免对象键序不同导致的
 * config-mismatch 误报。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

/** 按 id 排序的全局 MCP 配置哈希，用于 drift/变更检测。 */
export function computeGlobalMcpHash(globalMcpEntries: readonly CapabilityEntry[]): string {
  const hash = createHash('sha256');
  const sorted = [...globalMcpEntries].sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of sorted) {
    hash.update(entry.id);
    hash.update(canonicalJson(entry.mcpServer ?? {}));
    hash.update(String(entry.globalEnabled ?? true));
  }
  return hash.digest('hex').slice(0, 16);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 从 capabilities 配置提取 MCP 类型条目。 */
export function extractMcpEntries(config: CapabilitiesConfig | null): CapabilityEntry[] {
  return config?.capabilities.filter((cap) => cap.type === 'mcp') ?? [];
}

function mcpDriftSnapshot(
  entry: CapabilityEntry,
): { mcpServer: CapabilityEntry['mcpServer']; globalEnabled: boolean } {
  return {
    mcpServer: entry.mcpServer,
    globalEnabled: entry.globalEnabled ?? entry.enabled ?? true,
  };
}

function computeDriftHash(
  globalEntries: readonly CapabilityEntry[],
  projectEntries: readonly CapabilityEntry[],
): string {
  const hash = createHash('sha256');
  const sortedGlobal = [...globalEntries].sort((a, b) => a.id.localeCompare(b.id));
  const sortedProject = [...projectEntries].sort((a, b) => a.id.localeCompare(b.id));
  hash.update('global:');
  for (const e of sortedGlobal) {
    hash.update(`${e.id}:${canonicalJson(mcpDriftSnapshot(e))}|`);
  }
  hash.update('project:');
  for (const e of sortedProject) {
    hash.update(`${e.id}:${canonicalJson(mcpDriftSnapshot(e))}:${canonicalJson(e.mcpServerOverride ?? null)}|`);
  }
  return hash.digest('hex').slice(0, 16);
}

function entryConfigHash(entry: CapabilityEntry): string {
  return createHash('sha256')
    .update(canonicalJson(mcpDriftSnapshot(entry)))
    .digest('hex')
    .slice(0, 16);
}

// ── Project Check ────────────────────────────────────────────────────────────

/**
 * 检测单个项目与全局配置之间的 drift（仅配置比较，不写盘）。
 *
 * @param projectRoot - 项目目录
 * @param catCafeRoot - 主项目（全局配置）目录
 * @param globalConfig - 预读的全局配置（缺省现读）
 * @param projectConfig - 预读的项目配置（缺省现读）
 */
export async function checkMcpProject(
  projectRoot: string,
  catCafeRoot: string,
  globalConfig?: CapabilitiesConfig | null,
  projectConfig?: CapabilitiesConfig | null,
): Promise<McpDriftResult> {
  const gc = globalConfig ?? (await readCapabilitiesConfig(catCafeRoot));
  const pc = projectConfig ?? (await readCapabilitiesConfig(projectRoot));

  const globalMcpEntries = extractMcpEntries(gc);
  const projectMcpEntries = extractMcpEntries(pc);

  const globalMcpMap = new Map(globalMcpEntries.map((e) => [e.id, e]));
  const projectMcpMap = new Map(projectMcpEntries.map((e) => [e.id, e]));

  const issues: McpIssue[] = [];

  // 1. global-new：全局有、项目无
  for (const [mcpId] of globalMcpMap) {
    if (!projectMcpMap.has(mcpId)) {
      issues.push({
        type: 'global-new',
        mcpId,
        message: `全局新增了 MCP「${mcpId}」，项目尚未同步`,
      });
    }
  }

  // 2. project-orphan：项目有（non-external）、全局无
  for (const [mcpId, projectEntry] of projectMcpMap) {
    if (!globalMcpMap.has(mcpId) && projectEntry.source !== 'external') {
      issues.push({
        type: 'project-orphan',
        mcpId,
        message: `MCP「${mcpId}」在全局已不存在，疑似残留配置`,
        ...(projectEntry.pluginId ? { pluginId: projectEntry.pluginId } : {}),
      });
    }
  }

  // 3. config-mismatch：两边都有，但全局 mcpServer 变更
  for (const [mcpId, globalEntry] of globalMcpMap) {
    const projectEntry = projectMcpMap.get(mcpId);
    if (!projectEntry) continue;

    const globalHash = entryConfigHash(globalEntry);
    const projectHash = entryConfigHash(projectEntry);

    if (globalHash !== projectHash || projectEntry.mcpServerOverride !== undefined) {
      issues.push({
        type: 'config-mismatch',
        mcpId,
        message: `MCP「${mcpId}」项目配置与全局不一致`,
        ...(projectEntry.mcpServerOverride !== undefined ? { hasOverride: true } : {}),
      });
    }
  }

  const summary = {
    new: issues.filter((i) => i.type === 'global-new').length,
    orphan: issues.filter((i) => i.type === 'project-orphan').length,
    mismatch: issues.filter((i) => i.type === 'config-mismatch').length,
  };

  return {
    issues,
    driftHash: computeDriftHash(globalMcpEntries, projectMcpEntries),
    summary,
  };
}

// ── Global Check ─────────────────────────────────────────────────────────────

/**
 * 检测所有已登记项目的 drift（聚合报告）。
 * 项目枚举经注入式 `listProjectPaths` 端口（缺省仅主项目自身）。
 */
export async function checkMcpGlobal(
  catCafeRoot: string,
  deps?: McpDriftDetectorDeps,
): Promise<McpGlobalDriftResult> {
  const globalConfig = await readCapabilitiesConfig(catCafeRoot);
  const projectPaths = deps?.listProjectPaths
    ? await deps.listProjectPaths(catCafeRoot)
    : [catCafeRoot];

  const perProject: McpGlobalDriftResult['perProject'] = [];
  let totalNew = 0;
  let totalOrphan = 0;
  let totalMismatch = 0;
  let projectsWithDrift = 0;

  for (const projectPath of projectPaths) {
    try {
      const result = await checkMcpProject(projectPath, catCafeRoot, globalConfig);
      if (result.issues.length > 0) {
        perProject.push({ path: projectPath, result });
        totalNew += result.summary.new;
        totalOrphan += result.summary.orphan;
        totalMismatch += result.summary.mismatch;
        projectsWithDrift++;
      }
    } catch (err) {
      console.warn(`[F249] drift check failed for ${projectPath}: ${(err as Error).message}`);
    }
  }

  return {
    perProject,
    totalSummary: { new: totalNew, orphan: totalOrphan, mismatch: totalMismatch, projectsWithDrift },
  };
}