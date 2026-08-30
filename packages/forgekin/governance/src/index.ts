/**
 * @flowforge/forgekin-governance — C34b governance 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `config/governance/*`（F070 可移植治理包）：
 *   - governance-pack：治理托管块生成（env 感知 ports + checksum）+ 版本常量
 *   - governance-registry：`.cat-cafe/governance-registry.json` 派发审计登记
 *     （register/get/listAll/checkHealth，win32 大小写不敏感路径比较）
 *   - governance-preflight：外部项目就绪闸门（needsBootstrap /
 *     needsConfirmation 可行动状态，clowder-ai#123 修复）
 *   - governance-bootstrap：GovernanceBootstrapService（托管块写入 +
 *     ADR-025 per-skill symlink + hooks symlink + 方法论骨架 + 报告落盘）
 *   - mission-pack：派发任务包构建（M1 提示段注入）+ execution-digest-capture
 *   - skill-sync：技能名校验 + mount 路径级联（F228 纯工具）
 *   - list-all-projects：hub 根下项目枚举
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - capabilities.json 读写经 `@flowforge/forgekin-capabilities`（模块单例 → 包导入）
 *   - mount-rules-store / mcp-drift-detector → 注入式 GovernanceBootstrapDeps
 *     （readMountRules 缺省 = 项目 capabilities.json#defaultMountRules → DEFAULT_MOUNT_RULES）
 *   - prompt-template-loader.renderSegment('M1') → 注入式 MissionPromptRenderer
 *
 * 消费者加载默认插件：
 * ```ts
 * import ForgeGovernance from '@flowforge/forgekin-governance'
 * ctx.plugin(ForgeGovernance, { hubRoot })
 * // ctx.forgeGovernance.bootstrapProject(projectPath, { dryRun: false })
 * // ctx.forgeGovernance.preflight(projectPath, provider)
 * // ctx.forgeGovernance.registry.listAll()
 * ```
 *
 * @module @flowforge/forgekin-governance
 */

import { Context, Service } from '@flowforge/cordis';
import type { BootstrapReport, DispatchMissionPack } from '@flowforge/cats-shared';

import { GovernanceBootstrapService, type BootstrapOptions, type GovernanceBootstrapDeps } from './governance-bootstrap.ts';
import type { GovernanceRegistry } from './governance-registry.ts';
import { checkGovernancePreflight } from './governance-preflight.ts';
import type { PreflightResult } from './governance-preflight.ts';
import {
  buildMissionPack,
  formatMissionPackPrompt,
  type MissionPromptRenderer,
  type ThreadContext,
} from './mission-pack.ts';
import { captureExecutionDigest } from './execution-digest-capture.ts';
import type { CaptureContext, CompletionData } from './execution-digest-capture.ts';
import { listAllProjectPaths } from './list-all-projects.ts';
import { getMethodologyTemplates } from './methodology-templates.ts';

// Re-export 全部子模块（子路径导入也各自可用）。
export * from './governance-pack.ts';
export * from './governance-registry.ts';
export * from './governance-preflight.ts';
export * from './governance-bootstrap.ts';
export * from './methodology-templates.ts';
export * from './mission-pack.ts';
export * from './execution-digest-capture.ts';
export * from './skill-sync.ts';
export * from './list-all-projects.ts';

declare module '@flowforge/cordis' {
  interface Context {
    /** governance 域（C34b）：治理包 bootstrap + 注册表 + 派发前置闸门 */
    forgeGovernance: ForgeGovernanceService;
  }
}

/** 插件配置（ctx.plugin(ForgeGovernance, config)）。 */
export interface ForgeGovernanceConfig {
  /** hub 项目根（governance-registry / skills 源 / 全局 capabilities.json 所在处）。必填。 */
  hubRoot: string;
  /** 注入式依赖（capabilities 读写 / mount 规则 / MCP seed 同步 / skills 目录名）。 */
  deps?: GovernanceBootstrapDeps;
}

/**
 * governance 域服务 — 挂载 `ctx.forgeGovernance`。
 *
 * 提供：
 *   - bootstrapProject：治理包完整 bootstrap（托管块 + skills/hooks symlink +
 *     方法论骨架 + 注册表登记 + 报告落盘）
 *   - preflight：外部项目派发前就绪闸门（可行动状态）
 *   - registry：GovernanceRegistry 审计登记
 *   - missionPack / formatMissionPrompt / captureDigest：派发任务包闭环
 *   - listProjects / methodologyTemplates：枚举与模板
 */
export class ForgeGovernanceService extends Service {
  private readonly cfg: ForgeGovernanceConfig;
  private readonly bootstrap: GovernanceBootstrapService;

  constructor(ctx: Context, config: ForgeGovernanceConfig) {
    super(ctx, 'forgeGovernance');
    this.cfg = config;
    this.bootstrap = new GovernanceBootstrapService(config.hubRoot, config.deps ?? {});
  }

  /** hub 根。 */
  get hubRoot(): string {
    return this.cfg.hubRoot;
  }

  /** 治理注册表（.cat-cafe/governance-registry.json）。 */
  get registry(): GovernanceRegistry {
    return this.bootstrap.getRegistry();
  }

  /** 完整 bootstrap：托管块 + symlink + 方法论骨架 + 注册表登记。 */
  bootstrapProject(targetProject: string, opts: BootstrapOptions): Promise<BootstrapReport> {
    return this.bootstrap.bootstrap(targetProject, opts);
  }

  /** 派发前置闸门：needsBootstrap / needsConfirmation / ready。 */
  preflight(projectPath: string, catProvider?: string): Promise<PreflightResult> {
    return checkGovernancePreflight(projectPath, this.cfg.hubRoot, catProvider);
  }

  /** hub 根下全部项目路径（扫描 .git 或 package.json 锚点）。 */
  listProjects(options?: { maxScanDepth?: number }): Promise<string[]> {
    return listAllProjectPaths(this.cfg.hubRoot, options);
  }

  /** 从 thread 元数据构建派发任务包（无具体任务内容时返回 null）。 */
  missionPack(thread: ThreadContext): DispatchMissionPack | null {
    return buildMissionPack(thread);
  }

  /** 渲染 M1 提示段（可注入模板引擎，缺省简洁 markdown）。 */
  formatMissionPrompt(pack: DispatchMissionPack, renderer?: MissionPromptRenderer): string {
    return formatMissionPackPrompt(pack, renderer);
  }

  /** 从完成数据捕获结构化执行摘要（纯函数，落库由调用方负责）。 */
  captureDigest(
    missionPack: DispatchMissionPack,
    completion: CompletionData,
    capture: CaptureContext,
  ) {
    return captureExecutionDigest(missionPack, completion, capture);
  }

  /** 方法论骨架模板（bootstrap 时写入缺失文件）。 */
  methodologyTemplates() {
    return getMethodologyTemplates();
  }
}

export default ForgeGovernanceService;
