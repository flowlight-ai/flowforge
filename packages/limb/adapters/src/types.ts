/**
 * @flowforge/limb-adapters — 阶段6 T6.6 外部 CLI 适配器域统一契约
 *
 * 对齐 forgemind/external_agents.py EAC 契约（老 flowforge Python）+ clowder-ai
 * providers/* 事件解析语义，全部改造为 Cordis 插件可装配的纯函数/对象：
 *
 * 配置五项：kind / binary / description / env / defaultTimeoutMs
 * 能力四项：isAvailable / buildSpawnArgs / createParser / parsePlainText
 */

/** 外部 CLI 提供方种类（EAC ExternalAgentKind，agy 为 antigravity） */
export type CliProviderKind = 'claude' | 'codex' | 'gemini' | 'agy' | 'opencode' | 'custom';

/** 适配器静态配置（对齐 ExternalAgentConfig） */
export interface CliAdapterConfig {
  readonly kind: CliProviderKind;
  /** CLI 二进制名（e.g. claude / codex / gemini / agy / opencode） */
  readonly binary: string;
  readonly description: string;
  /** 注入子进程的环境变量（缺省继承宿主 PATH 等） */
  readonly env?: Record<string, string>;
  /** 默认超时毫秒（EAC default_timeout=120s） */
  readonly defaultTimeoutMs: number;
}

/** 统一 CLI 事件（简化自 clowder-ai AgentMessage，去掉 catId 依赖） */
export type CliEvent =
  | { type: 'session_init'; sessionId: string; timestamp: number }
  | { type: 'text'; content: string; timestamp: number }
  | {
      type: 'tool_use';
      toolName: string;
      toolInput: Record<string, unknown>;
      toolUseId?: string;
      timestamp: number;
    }
  | {
      type: 'tool_result';
      content: string;
      toolName?: string;
      toolResultStatus?: 'ok' | 'error' | 'unknown';
      toolUseId?: string;
      timestamp: number;
    }
  | { type: 'system_info'; content: string; timestamp: number }
  | {
      type: 'error';
      error: string;
      errorDisposition?: 'transient';
      content?: string;
      timestamp: number;
    }
  | {
      type: 'agent_loop';
      metadata?: { provider: string; model?: string; usage?: Record<string, unknown> };
      timestamp: number;
    };

/** spawn 参数（对应 EAC invoke(prompt, cwd, timeout, extra_args) + 各 CLI 非交互模式） */
export interface CliSpawnOptions {
  prompt?: string;
  cwd?: string;
  timeoutMs?: number;
  extraArgs?: string[];
  /** 续跑已有会话（codex exec resume / claude --resume） */
  resumeSessionId?: string;
  /** 模型覆盖（gemini -m / opencode -m provider/model） */
  model?: string;
}

/** agy plain text 分类结果（AntigravityCliPlainTextResult） */
export type CliPlainTextResult =
  | { kind: 'text'; content: string; textMode?: 'replace' }
  | {
      kind: 'error';
      errorKind: 'timeout' | 'missing_model' | 'missing_session' | 'auth_required';
      error: string;
    }
  | { kind: 'empty' };

/** 有状态事件解析器：每次 spawn 创建一个实例，流式喂入 raw 事件 */
export interface CliEventParser {
  /** 原始 CLI 事件 → 统一 CliEvent；null = 跳过 */
  transform(raw: unknown): CliEvent | CliEvent[] | null;
  /** 流结束后调用（codex 追加签名 / claude 状态清理）；无可发事件返回 null */
  finalize?(): CliEvent | null;
}

/** CLI 适配器契约（EAC 七项 → TS 六方法） */
export interface CliAdapter {
  readonly config: CliAdapterConfig;
  /** 二进制是否在 PATH 中（EAC is_available；PATH 可注入便于测试/容器） */
  isAvailable(pathEnv?: string): boolean;
  /** 组装 spawn argv（[binary, ...flags, prompt]） */
  buildSpawnArgs(options?: CliSpawnOptions): string[];
  /** 创建流式事件解析器（stream-json/json/ndjson） */
  createParser(): CliEventParser;
  /** plain text 输出分类（agy print 模式专用；其余适配器缺省） */
  parsePlainText?(stdout: string, stderr?: string): CliPlainTextResult;
}
