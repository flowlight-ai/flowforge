/**
 * @flowforge/limb-terminal — 阶段6 T6.5 四肢终端域 Cordis 插件
 *
 * 挂载 `ctx.limbTerminal`：TmuxGateway（每 worktree 一个 tmux server）、
 * TerminalSessionStore（会话生命周期）、AgentPaneRegistry（agent pane / bg
 * carrier 追踪）、AgentSessionsReader（~/.claude/jobs 快照）、TmuxAgentSpawner
 * （FIFO NDJSON 流式 spawn）、TmuxAgentCarrierSession（F254 D2 duplex carrier）。
 *
 * Windows 回退：`gateway` 选项可注入 node-pty 实现的 `TerminalGatewayLike`
 * （见 26-stage6 T6.5「Windows 回退：node-pty 实现同接口」），其余组件不受影响。
 * 组合根注入 logger（缺省 no-op）与 jobsDir（缺省 ~/.claude/jobs）。
 */

import { Context, Service } from '@flowforge/cordis';
import type {
  AgentCarrierSessionFactory,
  CreatePaneOpts,
  PaneInfo,
  TerminalGatewayLike,
  TerminalSession,
} from './types.js';
import { AgentPaneRegistry, type AgentPaneInfo } from './agent-pane-registry.js';
import { readAgentSessions, type AgentSessionSnapshot } from './agent-sessions-reader.js';
import { TerminalSessionStore, type SessionRecord } from './session-store.js';
import { createTmuxAgentCarrierSessionFactory } from './tmux-agent-carrier-session.js';
import {
  createTmuxSpawnOverride,
  spawnCliInTmux,
  type TmuxSpawnDeps,
  type TmuxSpawnerLogger,
  type TmuxSpawnOptions,
  type TmuxSpawnResult,
} from './tmux-agent-spawner.js';
import { TmuxGateway } from './tmux-gateway.js';

export type {
  AgentCarrierSession,
  AgentCarrierSessionFactory,
  AgentCarrierSessionOptions,
  AgentPaneInfo,
  AgentSessionSnapshot,
  BgCarrierSessionInfo,
  CliDiagnostics,
  CliErrorReasonCode,
  CreatePaneOpts,
  PaneInfo,
  SessionRecord,
  SessionStatus,
  SpawnCliOverride,
  TerminalGatewayLike,
  TerminalSession,
  TmuxCliSpawnOptions,
  TmuxSpawnOptions,
  TmuxSpawnResult,
  TmuxSpawnerLogger,
} from './modules.js';
export { TerminalSessionStore } from './session-store.js';
export type { CreateSessionInput } from './session-store.js';
export { AgentPaneRegistry } from './agent-pane-registry.js';
export { TmuxGateway } from './tmux-gateway.js';
export { readAgentSessions } from './agent-sessions-reader.js';
export { createTmuxAgentCarrierSessionFactory } from './tmux-agent-carrier-session.js';
export { createTmuxSpawnOverride, spawnCliInTmux } from './tmux-agent-spawner.js';

export interface LimbTerminalServiceOptions {
  /** tmux 网关实现。缺省 new TmuxGateway()（POSIX）；Windows 注入 node-pty 回退实现 */
  readonly gateway?: TerminalGatewayLike | undefined;
  /** agent sessions 读取目录（缺省 ~/.claude/jobs） */
  readonly jobsDir?: string | undefined;
  /** spawn 日志器（缺省 no-op） */
  readonly logger?: TmuxSpawnerLogger | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 四肢终端域：tmux 网关 + agent pane 注册 + 会话存储 + FIFO spawn + carrier 会话 */
    limbTerminal: LimbTerminalService;
  }
}

export class LimbTerminalService extends Service {
  /** tmux 网关（注入或默认 POSIX 实现） */
  readonly gateway: TerminalGatewayLike;
  /** 终端会话存储（connected/disconnected + 按用户所有权门控） */
  readonly sessions: TerminalSessionStore;
  /** agent pane / bg carrier 注册表 */
  readonly agentPanes: AgentPaneRegistry;
  /** agent sessions 快照读取器 */
  readonly agentSessionsReader: (jobsDir?: string) => Promise<AgentSessionSnapshot[]>;
  private readonly logger: TmuxSpawnerLogger;

  constructor(ctx: Context, options: LimbTerminalServiceOptions) {
    super(ctx, 'limbTerminal');
    this.logger = options.logger ?? { error: () => {} };
    this.gateway =
      options.gateway ??
      (() => {
        try {
          return new TmuxGateway();
        } catch (error) {
          // POSIX 缺 tmux / Windows：要求组合根注入回退实现
          throw new Error(
            `tmux unavailable: ${error instanceof Error ? error.message : String(error)}. ` +
              'Install tmux / set FF_TMUX_PATH, or inject a TerminalGatewayLike (e.g. node-pty) implementation.',
          );
        }
      })();
    this.sessions = new TerminalSessionStore();
    this.agentPanes = new AgentPaneRegistry();
    this.agentSessionsReader = (jobsDir) => readAgentSessions(jobsDir ?? options.jobsDir);
  }

  /** 确保 worktree 的 tmux server 运行，返回 socket 名 */
  ensureServer(worktreeId: string): Promise<string> {
    return this.gateway.ensureServer(worktreeId);
  }

  /** 创建普通 pane */
  createPane(worktreeId: string, opts?: CreatePaneOpts): Promise<string> {
    return this.gateway.createPane(worktreeId, opts);
  }

  /** 创建 agent pane（remain-on-exit，只读由 spawn 流程在命令启动后设置） */
  createAgentPane(worktreeId: string, opts?: CreatePaneOpts): Promise<string> {
    return this.gateway.createAgentPane(worktreeId, opts);
  }

  /** 列出 worktree 所有 pane */
  listPanes(worktreeId: string): Promise<PaneInfo[]> {
    return this.gateway.listPanes(worktreeId);
  }

  /** 在 pane 中执行命令（send-keys fire-and-forget） */
  execInPane(worktreeId: string, paneId: string, command: string): Promise<void> {
    return this.gateway.execInPane(worktreeId, paneId, command);
  }

  sendKeys(worktreeId: string, paneId: string, text: string): Promise<void> {
    return this.gateway.sendKeys(worktreeId, paneId, text);
  }

  capturePane(worktreeId: string, paneId: string): Promise<string> {
    return this.gateway.capturePane(worktreeId, paneId);
  }

  resizePane(worktreeId: string, paneId: string, cols: number, rows: number): Promise<void> {
    return this.gateway.resizePane(worktreeId, paneId, cols, rows);
  }

  setPaneReadOnly(worktreeId: string, paneId: string, readOnly: boolean): Promise<void> {
    return this.gateway.setPaneReadOnly(worktreeId, paneId, readOnly);
  }

  killPane(worktreeId: string, paneId: string): Promise<void> {
    return this.gateway.killPane(worktreeId, paneId);
  }

  destroyServer(worktreeId: string): Promise<void> {
    return this.gateway.destroyServer(worktreeId);
  }

  /** 读取 ~/.claude/jobs 聚合快照（缺省目录或组合根 jobsDir） */
  readAgentSessions(jobsDir?: string): Promise<AgentSessionSnapshot[]> {
    return this.agentSessionsReader(jobsDir);
  }

  /** 在 tmux pane 中 spawn CLI 并以 FIFO NDJSON 流式 yield 事件 */
  spawnCli(
    options: TmuxSpawnOptions,
    deps?: Partial<TmuxSpawnDeps>,
  ): AsyncGenerator<unknown, TmuxSpawnResult, undefined> {
    return spawnCliInTmux(options, {
      tmuxGateway: deps?.tmuxGateway ?? this.gateway,
      logger: deps?.logger ?? this.logger,
    });
  }

  /** 生成路由 agent 执行到 tmux pane 的 SpawnCliOverride（T6.6 adapters 消费） */
  createSpawnOverride(worktreeId: string, invocationId: string, userId: string): ReturnType<typeof createTmuxSpawnOverride> {
    return createTmuxSpawnOverride(worktreeId, invocationId, userId, this.gateway, this.agentPanes);
  }

  /** 生成 F254 D2 duplex carrier 会话工厂（provider app-server 协议用） */
  createCarrierSessionFactory(input: {
    worktreeId: string;
    userId: string;
  }): AgentCarrierSessionFactory {
    return createTmuxAgentCarrierSessionFactory({
      worktreeId: input.worktreeId,
      userId: input.userId,
      tmuxGateway: this.gateway,
      agentPaneRegistry: this.agentPanes,
    });
  }

  /** 便捷：创建一条终端会话记录 */
  createSession(input: { worktreeId: string; paneId: string; userId: string }): SessionRecord {
    return this.sessions.create(input);
  }

  /** 便捷：构建 TerminalSession 视图（含 socket 名与 shell 元数据） */
  toTerminalSession(record: SessionRecord, shell = process.env.SHELL ?? '/bin/zsh'): TerminalSession {
    return {
      id: record.id,
      worktreeId: record.worktreeId,
      tmuxSocketName: this.gateway.socketName(record.worktreeId),
      paneId: record.paneId,
      shell,
      cols: 80,
      rows: 24,
      createdAt: record.createdAt,
    };
  }

  /** 便捷：某 worktree 的 agent panes 列表 */
  listAgentPanes(worktreeId: string, userId: string): AgentPaneInfo[] {
    return this.agentPanes.listByWorktreeAndUser(worktreeId, userId);
  }
}

export default function Plugin(ctx: Context, options: LimbTerminalServiceOptions) {
  return ctx.plugin(LimbTerminalService, options);
}
