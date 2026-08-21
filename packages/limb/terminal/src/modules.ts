/**
 * @flowforge/limb-terminal 类型聚合 — 从 src/types.ts 统一 re-export，
 * 供 index.ts 的模块级导出与外部消费者使用。
 *
 * @module @flowforge/limb-terminal/modules
 */

export type {
  AgentCarrierSession,
  AgentCarrierSessionFactory,
  AgentCarrierSessionOptions,
  CliDiagnostics,
  CliErrorReasonCode,
  CreatePaneOpts,
  PaneInfo,
  SpawnCliOverride,
  TerminalGatewayLike,
  TerminalSession,
  TmuxCliSpawnOptions,
} from './types.js';

export type { TmuxSpawnOptions, TmuxSpawnResult, TmuxSpawnerLogger } from './tmux-agent-spawner.js';

export type { AgentPaneInfo, BgCarrierSessionInfo } from './agent-pane-registry.js';
export type { AgentSessionSnapshot } from './agent-sessions-reader.js';
export type { SessionRecord, SessionStatus } from './session-store.js';
