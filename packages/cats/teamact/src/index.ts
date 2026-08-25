/**
 * @flowforge/cats-teamact — T7.17 TeamAct 协作协议 Cordis 插件。
 *
 * TS 全量重写自 `core/teamact/`（F002 + F048，roleagent.md §2）：
 *   - types：TeamActStep 六步 / TerminationCondition 五项 / BallStatus 四态
 *   - handoff：HandoffCapsule 交接胶囊（协议层硬要求）
 *   - circuit-breaker：PingPongCircuitBreaker 乒乓球熔断器（给数据不给结论）
 *   - state-machine：TeamActState 六步循环状态机 + TerminationReport
 *   - steer：SteerQueue（F048 7 动作 + I1-I5 不变量）
 *   - TeamActService 挂载 `ctx.catsTeamAct`
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsTeamAct from '@flowforge/cats-teamact'
 * ctx.plugin(CatsTeamAct)
 * // ctx.catsTeamAct.queue / .breaker / .createState() 就绪
 * ```
 *
 * @module @flowforge/cats-teamact
 */

import type { Context } from '@flowforge/cordis';
import TeamActService from './teamact-service.js';

// Re-export 服务 + 类型。
export { TeamActService } from './teamact-service.js';
export type { TeamActServiceOptions } from './teamact-service.js';

// Re-export 类型定义（F002 §2.1 / roleagent.md §2）。
export { BallStatus, TeamActStep, TerminationCondition } from './types.js';

// Re-export 交接胶囊（协议层硬要求）。
export { HandoffCapsule, newHandoffCapsule } from './handoff.js';
export type { HandoffCapsuleOptions } from './handoff.js';

// Re-export 乒乓球熔断器。
export { PingPongCircuitBreaker } from './circuit-breaker.js';
export type { PingPongFailureData, PingPongCircuitBreakerOptions } from './circuit-breaker.js';

// Re-export 六步循环状态机。
export { CVO_AGENT_ID, HistoryEntry, TeamActState, TerminationReport } from './state-machine.js';
export type { HistoryEntryOptions, TeamActStateOptions } from './state-machine.js';

// Re-export F048 Steer 队列。
export {
  appendLine,
  commandToJSON,
  effectToJSON,
  PermissionError,
  SteerAction,
  SteerCommand,
  SteerEffect,
  SteerPriority,
  SteerQueue,
} from './steer.js';
export type {
  AppliedSteerRecord,
  SteerCommandOptions,
  SteerEffectOptions,
  SteerQueueConfig,
  SteerTaskLike,
} from './steer.js';

/**
 * 默认 Cordis 插件：挂载 TeamActService 到 `ctx.catsTeamAct`。
 */
export default function Plugin(ctx: Context) {
  ctx.plugin(TeamActService);
}
