/**
 * @flowforge/forgekin-trae-bridge — 阶段7 T7.26 Trae 文件桥接域 Cordis 插件
 *
 * 挂载 `ctx.forgeTraeBridge`：Forgekin 通过文件桥接（.trae_bridge/）调用 LLM，
 * 对齐 Python `llm/trae/`（client/protocol/config/session + bridge_operator）。
 *
 * F045 §2.3 不变量：
 *   I1 文件命名唯一（UUID4）/ I2 请求-响应配对（request_id）/ I3 超时保证
 *   I4 不丢数据（归档）/ I6 路径不硬编码（${ENV} 占位符）
 *   I7 operator 可见性（forgekin_id + task_context）/ I8 逃生舱（cancel 文件）
 */
import { Context, Service } from '@flowforge/cordis';
import { TraeLLMClient, type TraeChatOptions } from './client.js';
import {
  makeTraeBridgeConfig,
  makeTraeClientConfig,
  type TraeBridgeConfig,
  type TraeClientConfig,
} from './config.js';
import { BridgeLLMOperator, type BridgeLLMOperatorOptions } from './operator.js';
import {
  TraeBridgeProtocol,
  type BridgeLogger,
  type NowMsFn,
  type SleepFn,
  type UuidFn,
} from './protocol.js';
import type { BridgeMessage, BridgeRequestContext, BridgeResponse, BridgeStatus } from './models.js';
import type { SessionMemoryStore } from './session.js';

export * from './client.js';
export * from './config.js';
export * from './errors.js';
export * from './models.js';
export * from './operator.js';
export * from './protocol.js';
export * from './session.js';

export interface TraeBridgeServiceOptions {
  /** 桥接配置（缺省用默认配置；建议先 await loadTraeBridgeConfigFromYaml） */
  readonly bridgeConfig?: TraeBridgeConfig | undefined;
  /** 客户端配置（mode/默认模型/会话持久化） */
  readonly clientConfig?: TraeClientConfig | undefined;
  /** 预创建的协议层实例（优先于 bridgeConfig） */
  readonly protocol?: TraeBridgeProtocol | undefined;
  /** 协议层注入点（测试用：sleepFn/nowMsFn/uuidFn/logger） */
  readonly sleepFn?: SleepFn | undefined;
  readonly nowMsFn?: NowMsFn | undefined;
  readonly uuidFn?: UuidFn | undefined;
  readonly logger?: BridgeLogger | undefined;
  /** 会话持久化存储注入（对齐 Python MemoryManager） */
  readonly memoryStore?: SessionMemoryStore | undefined;
  /** 是否同时创建 operator（监听请求目录并调用 OpenRoute LLM） */
  readonly enableOperator?: boolean | undefined;
  /** operator 配置（fetchFn/sleepFn 注入、OpenRoute URL/key/model 等） */
  readonly operatorOptions?: BridgeLLMOperatorOptions | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Trae 文件桥接域：Forgekin → LLM 的文件协议客户端 + 可选 operator */
    forgeTraeBridge: TraeBridgeService;
  }
}

export class TraeBridgeService extends Service {
  readonly bridgeConfig: TraeBridgeConfig;
  readonly clientConfig: TraeClientConfig;
  readonly protocol: TraeBridgeProtocol;
  readonly client: TraeLLMClient;
  /** operator 实例（仅 enableOperator 时创建，否则为 null） */
  readonly operator: BridgeLLMOperator | null;

  constructor(ctx: Context, options: TraeBridgeServiceOptions = {}) {
    super(ctx, 'forgeTraeBridge');
    this.bridgeConfig = options.bridgeConfig ?? makeTraeBridgeConfig();
    this.clientConfig = options.clientConfig ?? makeTraeClientConfig();
    this.protocol =
      options.protocol ??
      new TraeBridgeProtocol(this.bridgeConfig, {
        sleepFn: options.sleepFn,
        nowMsFn: options.nowMsFn,
        uuidFn: options.uuidFn,
        logger: options.logger,
      });
    this.client = new TraeLLMClient({
      config: this.clientConfig,
      bridgeConfig: this.bridgeConfig,
      protocol: this.protocol,
      sleepFn: options.sleepFn,
      nowMsFn: options.nowMsFn,
    });
    if (options.memoryStore !== undefined) {
      this.client.setMemoryStore(options.memoryStore);
    }
    this.operator = options.enableOperator === true
      ? new BridgeLLMOperator(this.bridgeConfig, options.operatorOptions ?? {})
      : null;
  }

  // ── 初始化 ────────────────────────────────────────────────────

  /** 初始化检查（health_check_on_init 时验证目录可读写） */
  async init(): Promise<boolean> {
    if (this.bridgeConfig.health_check_on_init) {
      return await this.protocol.healthCheck();
    }
    return true;
  }

  // ── 客户端门面（Forgekin 侧）──────────────────────────────────

  /** 发送聊天请求并等待响应（F045 §2.1 协议流程） */
  chat(messages: BridgeMessage[], options: TraeChatOptions = {}): Promise<Record<string, unknown>> {
    return this.client.chat(messages, options);
  }

  /** 流式聊天（完整响应后分块 yield） */
  streamChat(
    messages: BridgeMessage[],
    options: TraeChatOptions & { streamChunkSize?: number | undefined } = {},
  ): AsyncGenerator<string> {
    return this.client.streamChat(messages, options);
  }

  /** 支持工具调用的聊天 */
  chatWithTools(
    messages: BridgeMessage[],
    tools: Record<string, unknown>[],
    options: TraeChatOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.client.chatWithTools(messages, tools, options);
  }

  /** 代码补全 */
  completeCode(
    prompt: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { contextCode?: string | undefined } = {},
  ): Promise<string> {
    return this.client.completeCode(prompt, context, options);
  }

  /** 代码审查 */
  reviewCode(
    code: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { language?: string | undefined } = {},
  ): Promise<Record<string, unknown>> {
    return this.client.reviewCode(code, context, options);
  }

  /** 测试生成 */
  generateTests(
    code: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { language?: string | undefined } = {},
  ): Promise<string> {
    return this.client.generateTests(code, context, options);
  }

  // ── 协议层门面 ────────────────────────────────────────────────

  /** 写入请求文件（不变量 1 + 7） */
  writeRequest(
    messages: unknown[],
    context: BridgeRequestContext,
    options: {
      sessionId?: string | undefined;
      timeoutSeconds?: number | undefined;
      requestId?: string | undefined;
    } = {},
  ): Promise<string> {
    return this.protocol.writeRequest(messages, context, options);
  }

  /** 轮询响应（不变量 3 + 8） */
  pollResponse(
    requestId: string,
    options: { timeout?: number | undefined } = {},
  ): Promise<BridgeResponse> {
    return this.protocol.pollResponse(requestId, options);
  }

  /** 写入取消文件（不变量 8 逃生舱） */
  writeCancel(requestId: string, reason = '', cancelledBy = 'operator'): Promise<void> {
    return this.protocol.writeCancel(requestId, reason, cancelledBy);
  }

  /** 列出所有 pending 请求（operator 可见性） */
  listPendingRequests(): Array<Record<string, unknown>> {
    return this.protocol.listPendingRequests();
  }

  /** 获取桥接状态总览 */
  getStatus(): BridgeStatus {
    return this.protocol.getStatus();
  }

  /** 健康检查（目录可读写） */
  healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }

  // ── operator 生命周期 ─────────────────────────────────────────

  /** 启动 operator 轮询循环（未启用 operator 时返回 false） */
  async startOperator(): Promise<boolean> {
    if (this.operator === null) {
      return false;
    }
    await this.operator.start();
    return true;
  }

  /** 停止 operator 轮询循环 */
  async stopOperator(): Promise<void> {
    if (this.operator === null) {
      return;
    }
    await this.operator.stop();
  }

  /** 快照（trace 日志）：桥接状态 + pending 数 + operator 统计 */
  snapshot(): {
    enabled: boolean;
    pendingRequests: number;
    status: BridgeStatus;
    operatorRunning: boolean;
    operatorStats: Record<string, number> | null;
  } {
    return {
      enabled: this.bridgeConfig.enabled,
      pendingRequests: this.protocol.listPendingRequests().length,
      status: this.protocol.getStatus(),
      operatorRunning: this.operator !== null && this.operator.isRunning,
      operatorStats: this.operator === null ? null : this.operator.stats,
    };
  }
}

export default function Plugin(ctx: Context, options?: TraeBridgeServiceOptions) {
  return ctx.plugin(TraeBridgeService, options);
}
