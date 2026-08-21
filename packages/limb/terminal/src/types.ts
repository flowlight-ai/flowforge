/**
 * @flowforge/terminal 共享类型 — T6.5
 *
 * 本地化自 clowder-ai：
 * - `src/domains/terminal/types.ts`（TerminalSession/PaneInfo/CreatePaneOpts）
 * - `src/domains/cats/services/types.ts`（AgentCarrierSession/Options/Factory、SpawnCliOverride）
 * - `packages/shared/src/types/cli-diagnostics.ts`（CliDiagnostics/CliErrorReasonCode）
 *   —— F212 诊断契约原宿主 @cat-cafe/shared，此处内联为本地契约（后续统一共享包时再抽出）。
 *
 * @module @flowforge/terminal/types
 */

/** 绑定到 worktree tmux server 的终端会话 */
export interface TerminalSession {
  /** Unique session ID (uuid) */
  id: string;
  /** Which worktree this terminal belongs to */
  worktreeId: string;
  /** tmux server socket name: `catcafe-{worktreeId}` */
  tmuxSocketName: string;
  /** tmux pane ID within the session (e.g., "%0") */
  paneId: string;
  /** Shell command (e.g., '/bin/zsh') */
  shell: string;
  /** Terminal dimensions */
  cols: number;
  rows: number;
  /** Created at timestamp */
  createdAt: number;
}

/** Info about a tmux pane */
export interface PaneInfo {
  paneId: string;
  panePid: number;
  paneWidth: number;
  paneHeight: number;
}

/** Options for creating a pane */
export interface CreatePaneOpts {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

/**
 * tmux 网关最小契约（Windows 回退 node-pty 实现同接口；
 * 见 26-stage6 T6.5「Windows 回退：node-pty 实现同接口」）。
 */
export interface TerminalGatewayLike {
  /** 读取解析后的 tmux 二进制绝对路径 */
  readonly tmuxBin: string;
  /** worktree 对应的 socket 名 */
  socketName(worktreeId: string): string;
  ensureServer(worktreeId: string): Promise<string>;
  createPane(worktreeId: string, opts?: CreatePaneOpts): Promise<string>;
  createAgentPane(worktreeId: string, opts?: CreatePaneOpts): Promise<string>;
  execInPane(worktreeId: string, paneId: string, command: string): Promise<void>;
  setPaneReadOnly(worktreeId: string, paneId: string, readOnly: boolean): Promise<void>;
  sendKeys(worktreeId: string, paneId: string, text: string): Promise<void>;
  capturePane(worktreeId: string, paneId: string): Promise<string>;
  listPanes(worktreeId: string): Promise<PaneInfo[]>;
  resizePane(worktreeId: string, paneId: string, cols: number, rows: number): Promise<void>;
  killPane(worktreeId: string, paneId: string): Promise<void>;
  destroyServer(worktreeId: string): Promise<void>;
}

// ── F212 诊断契约（原 @cat-cafe/shared CliDiagnostics）──────────────────────────

export type CliErrorReasonCode =
  | 'invalid_thinking_signature'
  | 'missing_rollout'
  | 'session_not_found'
  | 'model_not_found'
  | 'auth_failed'
  | 'quota_exceeded'
  | 'network_error'
  | 'invalid_config'
  | 'spawn_failed'
  | 'context_window_exceeded'
  | 'tool_call_parse_failed'
  | 'server_overloaded'
  | 'cli_response_timeout'
  | 'cli_stall_timeout'
  | 'silent_completion'
  | 'upstream_policy_reject';

/**
 * 结构化 CLI 错误载荷（F212 Phase A KD-1 白名单准入）。
 * safeExcerpt 仅在已知分类或结构化安全源下填充，前端按 excerptSource 白名单渲染。
 */
export interface CliDiagnostics {
  /** 白名单分类；undefined = 未知 stderr / stream error */
  reasonCode?: CliErrorReasonCode;
  /** 恒存在；人类化标题 */
  publicSummary: string;
  /** 恒存在；下一步行动的人类化提示 */
  publicHint: string;
  /** 消毒 + 截断的安全摘录（KD-1 白名单源） */
  safeExcerpt?: string;
  /** 安全摘录源白名单：'classifier' | 'cc_structured' | 'unknown_raw' */
  excerptSource?: 'classifier' | 'cc_structured' | 'unknown_raw';
  /** 调试关联元数据（安全可暴露） */
  debugRef: {
    command: string;
    exitCode?: number | null;
    signal: NodeJS.Signals | string | null;
    invocationId?: string;
    homeMode?: 'process_home' | 'child_env_home' | 'agy_profile_home';
    spawnCwdMode?: 'cat_cafe_agy_cwd' | 'agy_profile_cwd';
    spawnCwdKey?: string;
    profileId?: string;
  };
}

// ── CLI 执行契约（原 cli-types CliSpawnOptions / cats services SpawnCliOverride）────

/** tmux 内 CLI 执行选项（精简自 clowder-ai CliSpawnOptions，适配器层可再扩展） */
export interface TmuxCliSpawnOptions {
  /** CLI 命令（如 'claude'、'codex'） */
  command: string;
  /** 传给 CLI 的参数 */
  args: readonly string[];
  /** stdout 解析模式。缺省 NDJSON（既有 CLI provider） */
  outputMode?: 'ndjson' | 'plainText';
  /** 工作目录 */
  cwd?: string;
  /** 可选超时毫秒（0 = 仅人工取消） */
  timeoutMs?: number;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 环境覆盖；null 表示从子环境删除继承变量 */
  env?: Record<string, string | null>;
  /** 调用上下文（诊断增强用） */
  invocationId?: string;
  /**
   * provider 语义完成信号（如 turn.completed）。aborted 时跳过进程退出等待，
   * 解除 done 与进程退出的耦合。
   */
  semanticCompletionSignal?: AbortSignal;
  /**
   * 2026-05-29 事件（跨线程上下文污染）：prompt 正文经 stdin 传入子进程而非 argv，
   * 防止 ps/proc cmdline 跨进程泄露完整对话历史。
   */
  stdinInput?: string;
}

/** CLI 执行 override：与 spawnCli 同事件格式的异步生成器 */
export type SpawnCliOverride = (
  options: TmuxCliSpawnOptions,
) => AsyncGenerator<unknown, void, undefined>;

// ── Agent carrier 会话契约（原 cats/services/types）────────────────────────────

/** F254 D2 duplex JSON carrier（provider app-server 协议用） */
export interface AgentCarrierSession {
  read(): AsyncIterable<unknown>;
  write(message: Record<string, unknown>): Promise<void>;
  /** 仅当从其仍健康的 affinity host 获取 resume lease 时为 true */
  reusedSessionHost?: boolean;
  /** 启动/恢复后将 provider session id 绑定到可复用 carrier host */
  rememberSession?(sessionId: string): void;
  /** provider 原生中断宽限窗口后强制停止传输进程/pane */
  terminate?(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentCarrierSessionOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string | null>;
  signal?: AbortSignal;
  invocationId: string;
  /** 用于 warm-host affinity 的既有 provider session id */
  sessionId?: string;
}

export type AgentCarrierSessionFactory = (
  options: AgentCarrierSessionOptions,
) => Promise<AgentCarrierSession>;
