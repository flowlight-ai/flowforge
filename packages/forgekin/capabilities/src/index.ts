/**
 * @flowforge/forgekin-capabilities — C34a capabilities 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `config/capabilities/*`（F041 统一能力模型）：
 *   - capability-orchestrator：capabilities.json 读写 / bootstrap 发现 /
 *     heal 拓扑迁移链（legacy → splits → resolver-backed → main server →
 *     path realign）/ 按 provider 生成 CLI 配置（gemini + antigravity）
 *   - capability-mcp-service：#712 MCP install/remove 单一管线
 *     （lock → read → heal → ownership → mutate → write → CLI regen → audit）
 *   - mcp-config-adapters：Claude/Codex/Gemini/Kimi/Antigravity/OpenCode
 *     配置归一化为 McpServerDescriptor
 *   - capability-install（安装预览）/ revoke / redaction / audit jsonl /
 *     write-guards（loopback + owner 闸门，纯请求参数抽象）/
 *     install-policy / probe-state / version-lock / capabilities-migration
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - pencil 硬编码 → 注入式 `McpResolverRegistry`（resolverId → 命令解析器）
 *   - catRegistry 模块单例 → `CapabilityCatBinding[]`（缺省从 `ctx.cats` 派生）
 *   - resolveCatCafeSkillsSource() → `skillsSource` 可选参数
 *   - retired-github-mcp 检查全部移除
 *   - I/O 层可插拔（McpConfigIO），缺省 fileBasedMcpIO
 *
 * 消费者加载默认插件：
 * ```ts
 * import ForgeCapabilities from '@flowforge/forgekin-capabilities'
 * ctx.plugin(ForgeCapabilities, { projectRoot, catCafeRepoRoot?, resolvers? })
 * // ctx.forgeCapabilities.orchestrate()
 * // ctx.forgeCapabilities.installMcp(entry) / .removeMcp(id, { hard: true })
 * // ctx.forgeCapabilities.preview(req) / .auditLog()
 * ```
 *
 * @module @flowforge/forgekin-capabilities
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { Context, Service } from '@flowforge/cordis';
import type {
  CapabilitiesConfig,
  CapabilityEntry,
  CatRegistry,
  McpInstallPreview,
  McpInstallRequest,
} from '@flowforge/cats-shared';

import { buildInstallPreview } from './capability-install.ts';
import { readAuditLog } from './capability-audit.ts';
import {
  fileBasedMcpIO,
  installMcpCapability,
  removeMcpCapability,
  type McpConfigIO,
  type McpRemoveOpts,
  type McpServiceOpts,
} from './capability-mcp-service.ts';
import {
  type CapabilityCatBinding,
  type CliConfigPaths,
  type DiscoveryPaths,
  type McpResolverRegistry,
  orchestrate,
  healCatCafeMcpTopology,
  readCapabilitiesConfig,
  resolveServersForCat,
  withCapabilityLock,
  writeCapabilitiesConfig,
} from './capability-orchestrator.ts';

// Re-export 核心实现 + 类型（子路径导入也各自可用）。
export * from './capability-orchestrator.ts';
export * from './capability-mcp-service.ts';
export * from './mcp-config-adapters.ts';
// 其余符号已由 capability-orchestrator re-export，这里只补缺的。
export { MCP_SESSION_ENV_KEYS } from './mcp-constants.ts';
export { migrateCapabilitiesV1ToV2 } from './capabilities-migration.ts';
export { buildInstallPreview } from './capability-install.ts';
export { appendAuditEntry, readAuditLog } from './capability-audit.ts';
export { revokeCapability } from './capability-revoke.ts';
export type { RevokeResult } from './capability-revoke.ts';
export {
  REDACTED_CAPABILITY_SECRET,
  sanitizeCapabilityAuditEntry,
  sanitizeCapabilityForAudit,
  sanitizeCapabilityForResponse,
  sanitizeMcpInstallPreviewForResponse,
} from './capability-redaction.ts';
export {
  containsRedactedPlaceholder,
  isLocalCapabilityWriteRequest,
  isLoopbackAddress,
  requireCapabilityWriteOwner,
  requireLocalCapabilityWriteRequest,
  resolveCapabilityWriteSessionUserId,
  resolveOwnerGate,
} from './capability-write-guards.ts';
export type {
  CapabilityWriteOwnerOptions,
  CapabilityWriteRequestLike,
  CapabilityWriteRouteError,
  OwnerGateOptions,
} from './capability-write-guards.ts';
export { evaluateInstallPolicy } from './install-policy.ts';
export { buildProbeState, computeToolDiff } from './probe-state.ts';
export type { ToolDiff } from './probe-state.ts';
export { buildLockVersion } from './version-lock.ts';

declare module '@flowforge/cordis' {
  interface Context {
    /** capabilities 域（C34a）：capabilities.json 编排 + MCP install/remove 管线 */
    forgeCapabilities: ForgeCapabilitiesService;
  }
}

/** 缺省外部 MCP 发现路径（相对 projectRoot）。 */
export function defaultDiscoveryPaths(projectRoot: string): DiscoveryPaths {
  return {
    claudeConfig: join(projectRoot, '.mcp.json'),
    codexConfig: join(projectRoot, '.codex', 'config.toml'),
    geminiConfig: join(projectRoot, '.gemini', 'settings.json'),
    kimiConfig: join(projectRoot, '.kimi', 'mcp.json'),
  };
}

/** 缺省持久化 CLI 配置路径（google 项目级 + antigravity 全局）。 */
export function defaultCliConfigPaths(projectRoot: string): CliConfigPaths {
  return {
    google: join(projectRoot, '.gemini', 'settings.json'),
    antigravity: join(homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
  };
}

/** 插件配置（ctx.plugin(ForgeCapabilities, config)）。 */
export interface ForgeCapabilitiesConfig {
  /** 工作区项目根（capabilities.json 与 .cat-cafe 所在处）。必填。 */
  projectRoot: string;
  /** managed MCP 二进制根（缺省 = CAT_CAFE_RUNTIME_ROOT 或 projectRoot）。 */
  catCafeRepoRoot?: string;
  /** 外部 MCP 发现路径（缺省 = defaultDiscoveryPaths(projectRoot)）。 */
  discoveryPaths?: DiscoveryPaths;
  /** 持久化 CLI 配置路径（缺省 = defaultCliConfigPaths(projectRoot)）。 */
  cliConfigPaths?: CliConfigPaths;
  /** resolver-backed MCP 命令解析器注册表（替代 clowder-ai pencil 硬编码）。 */
  resolvers?: McpResolverRegistry;
  /** cat-cafe skills 源路径（迁移时读取，缺省不读）。 */
  skillsSource?: string;
  /** 显式 cat 绑定；缺省从 `ctx.cats` 实时派生（catId + clientId）。 */
  cats?: readonly CapabilityCatBinding[];
  /** 审计日志缺省 actor。 */
  userId?: string;
}

/**
 * capabilities 域服务 — 挂载 `ctx.forgeCapabilities`。
 *
 * 提供：
 *   - orchestrate：read/bootstrap → heal → 写回 → 生成 CLI 配置
 *   - installMcp / removeMcp：#712 单一管线（lock → heal → mutate → CLI → audit）
 *   - preview / auditLog / readConfig / writeConfig / heal
 *   - resolveServers：按 cat 解析启用的 MCP 列表
 */
export class ForgeCapabilitiesService extends Service {
  private readonly cfg: ForgeCapabilitiesConfig;
  private readonly discoveryPaths: DiscoveryPaths;
  private readonly cliConfigPaths: CliConfigPaths;

  constructor(ctx: Context, config: ForgeCapabilitiesConfig) {
    super(ctx, 'forgeCapabilities');
    this.cfg = config;
    this.discoveryPaths = config.discoveryPaths ?? defaultDiscoveryPaths(config.projectRoot);
    this.cliConfigPaths = config.cliConfigPaths ?? defaultCliConfigPaths(config.projectRoot);
  }

  /** 项目根。 */
  get projectRoot(): string {
    return this.cfg.projectRoot;
  }

  // ────────── cat 绑定派生 ──────────

  /**
   * 当前生效的 cat 绑定（{ catId, provider }）。
   * 显式配置优先；否则从 `ctx.cats`（CatRegistry）实时派生：
   * provider 取 CatConfig.clientId（clowder-ai#340 由 provider 更名）。
   */
  catBindings(): CapabilityCatBinding[] {
    if (this.cfg.cats) return [...this.cfg.cats];
    const registry = this.ctx.cats as CatRegistry | undefined;
    if (!registry) return [];
    const configs = registry.getAllConfigs();
    return Object.entries(configs).map(([catId, config]) => ({
      catId,
      provider: config.clientId,
    }));
  }

  // ────────── orchestrate ──────────

  /** 完整编排：read/bootstrap → heal → 写回 → 生成 CLI 配置。 */
  orchestrate(): Promise<CapabilitiesConfig> {
    return orchestrate(this.cfg.projectRoot, this.discoveryPaths, this.cliConfigPaths, {
      ...(this.cfg.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: this.cfg.catCafeRepoRoot } : {}),
      cats: this.catBindings(),
      ...(this.cfg.resolvers !== undefined ? { resolvers: this.cfg.resolvers } : {}),
      ...(this.cfg.skillsSource !== undefined ? { skillsSource: this.cfg.skillsSource } : {}),
    });
  }

  /** 读取 capabilities.json（不存在返回 null）。 */
  readConfig(): Promise<CapabilitiesConfig | null> {
    return readCapabilitiesConfig(
      this.cfg.projectRoot,
      ...(this.cfg.skillsSource !== undefined ? [this.cfg.skillsSource] : []),
    );
  }

  /** 原子写回 capabilities.json。 */
  writeConfig(config: CapabilitiesConfig): Promise<void> {
    return writeCapabilitiesConfig(this.cfg.projectRoot, config);
  }

  /** 对内存中 config 跑完整 heal 链（不写盘）。 */
  heal(config: CapabilitiesConfig): { migrated: boolean; config: CapabilitiesConfig } {
    return healCatCafeMcpTopology(config, {
      ...(this.cfg.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: this.cfg.catCafeRepoRoot } : {}),
      projectRoot: this.cfg.projectRoot,
      resolverIds: Object.keys(this.cfg.resolvers ?? {}),
    });
  }

  /** 按 cat 解析启用的 MCP server 列表（先读盘，无配置返回空数组）。 */
  async resolveServers(
    catId: string,
    options?: { accessScope?: 'global' | 'project' },
  ) {
    const config = await this.readConfig();
    if (!config) return [];
    const binding = this.catBindings().find((b) => b.catId === catId);
    return resolveServersForCat(config, catId, {
      ...(options?.accessScope !== undefined ? { accessScope: options.accessScope } : {}),
      ...(binding ? { provider: binding.provider } : {}),
    });
  }

  // ────────── MCP install / remove（#712 管线）──────────

  /** 当前 I/O 适配器（缺省文件型）。 */
  io(): McpConfigIO {
    return fileBasedMcpIO(this.cfg.projectRoot, this.cliConfigPaths);
  }

  /** 安装/更新 MCP 能力条目（含 heal + CLI regen + audit）。 */
  installMcp(entry: CapabilityEntry, opts?: McpServiceOpts): Promise<{ before: CapabilityEntry | null; after: CapabilityEntry }> {
    return installMcpCapability(this.cfg.projectRoot, entry, this.io(), {
      ...(this.cfg.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: this.cfg.catCafeRepoRoot } : {}),
      userId: opts?.userId ?? this.cfg.userId ?? 'system',
      ...(opts?.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: opts.catCafeRepoRoot } : {}),
    });
  }

  /** 移除/软禁用 MCP 能力条目（含 CLI regen + audit）。 */
  removeMcp(capabilityId: string, opts?: McpRemoveOpts): Promise<{ before: CapabilityEntry | null }> {
    return removeMcpCapability(this.cfg.projectRoot, capabilityId, this.io(), {
      ...(this.cfg.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: this.cfg.catCafeRepoRoot } : {}),
      userId: opts?.userId ?? this.cfg.userId ?? 'system',
      ...(opts?.hard !== undefined ? { hard: opts.hard } : {}),
      ...(opts?.pluginId !== undefined ? { pluginId: opts.pluginId } : {}),
      ...(opts?.catCafeRepoRoot !== undefined ? { catCafeRepoRoot: opts.catCafeRepoRoot } : {}),
    });
  }

  // ────────── preview / audit ──────────

  /** 安装前预览（不写盘）。 */
  preview(req: McpInstallRequest): Promise<McpInstallPreview> {
    return (async () => {
      const config = await this.readConfig();
      return buildInstallPreview(req, config?.capabilities ?? []);
    })();
  }

  /** 读取审计日志（最新 limit 条）。 */
  auditLog(limit?: number) {
    return readAuditLog(this.cfg.projectRoot, ...(limit !== undefined ? [limit] : []));
  }

  /** 以进程内互斥锁串行化 capabilities 变更。 */
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withCapabilityLock(this.cfg.projectRoot, fn);
  }
}

export default ForgeCapabilitiesService;
