/**
 * @flowforge/cats-agent-hooks — C31 agent hooks 域（#1049）Cordis 插件
 *
 * TS 移植：clowder-ai `agent-hooks`（C31 域，纯函数直移）：
 *   - sync-targets：4 个 SyncTarget（session-start/session-stop 可执行脚本 +
 *     codex-hooks / gemini-hooks JSON），canonical JSON 漂移检测 + applySync
 *   - claude-settings：settings.json 四态健康（configured/missing/stale/error）
 *     + 保留用户 hooks 的同步（bash 前缀跨平台）
 *   - health：hooks + skills + MCP 统一健康检查与同步（keep-project 策略），
 *     上游 config/mcp/skills/startup-root 四域依赖剥离为
 *     `AgentHookCapabilityProbes` 端口 —— 宿主注入实现；
 *     ownerAuthorized fail-closed（未授权只同步 hook 文件，不写能力）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsAgentHooks from '@flowforge/cats-agent-hooks'
 * ctx.plugin(CatsAgentHooks)
 * // ctx.catsAgentHooks.createSyncTargets({ projectRoot, targetRoot }) /
 * //   .getStatus(options, probes) / .sync(options, probes)
 * ```
 *
 * @module @flowforge/cats-agent-hooks
 */

import { Context, Service } from '@flowforge/cordis';

import { getAgentHookStatus, syncAgentHooks, type AgentHookCapabilityProbes, type AgentHookOptions, type AgentHookStatusResponse } from './health.js';
import {
  AGENT_HOOK_TARGET_NAMES,
  applySync,
  buildAgentHookTargets,
  canonicalJsonString,
  checkDrift,
  renderCodexHooksJson,
  renderGeminiHooksJson,
  selectAgentHookTargets,
  type BuildAgentHookTargetsOptions,
  type SyncTarget,
} from './sync-targets.js';
import { claudeSettingsHealth, syncClaudeSettings } from './claude-settings.js';

export {
  AGENT_HOOK_TARGET_NAMES,
  applySync,
  getAgentHookStatus,
  syncAgentHooks,
  buildAgentHookTargets,
  canonicalJsonString,
  checkDrift,
  renderCodexHooksJson,
  renderGeminiHooksJson,
  selectAgentHookTargets,
  claudeSettingsHealth,
  syncClaudeSettings,
};
export type {
  AgentHookCapabilityProbes,
  AgentHookHealthStatus,
  AgentHookOptions,
  AgentHookStatusResponse,
  HealthResult,
  McpDriftLike,
  McpIssueLike,
  SkillDriftContextLike,
  SkillDriftLike,
} from './health.js';
export type { BuildAgentHookTargetsOptions, DriftResult, SyncTarget } from './sync-targets.js';

/** CatsAgentHooks 服务构造选项（无状态，保留占位以扩展） */
export interface CatsAgentHooksServiceOptions {
  /** 时间函数注入（预留，目前未使用） */
  readonly now?: (() => Date) | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** agent-hooks 域（C31）：hook 同步目标工厂 + 统一健康检查/同步 */
    catsAgentHooks: CatsAgentHooksService;
  }
}

/**
 * agent-hooks 域服务（C31）：组装 sync-targets / claude-settings / health。
 *
 * 挂载 `ctx.catsAgentHooks`，提供：
 *   - createSyncTargets(options)：构建 4 个 hook 同步目标（脚本 + JSON）
 *   - getStatus(options, probes)：统一健康检查（hooks + skills + MCP）
 *   - sync(options, probes)：能力级同步（ownerAuthorized fail-closed）
 */
export class CatsAgentHooksService extends Service {
  /** 时间函数（预留） */
  readonly now: () => Date;

  constructor(ctx: Context, options: CatsAgentHooksServiceOptions = {}) {
    super(ctx, 'catsAgentHooks');
    this.now = options.now ?? (() => new Date());
  }

  /** 构建 4 个 hook 同步目标（session-start/session-stop/codex-hooks/gemini-hooks） */
  createSyncTargets(options: BuildAgentHookTargetsOptions): SyncTarget[] {
    return buildAgentHookTargets(options);
  }

  /** 统一健康检查：hooks + claude-settings + skills + MCP（探针宿主注入） */
  getStatus(options: AgentHookOptions, probes: AgentHookCapabilityProbes): Promise<AgentHookStatusResponse> {
    return getAgentHookStatus(options, probes);
  }

  /** 同步：hook 文件 + 能力级漂移（keep-project；未授权仅同步 hook 文件） */
  sync(options: AgentHookOptions, probes: AgentHookCapabilityProbes): Promise<AgentHookStatusResponse> {
    return syncAgentHooks(options, probes);
  }
}

export default CatsAgentHooksService;
