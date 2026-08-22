/**
 * @flowforge/forgekin-trae-bridge — LLM 客户端薄层（TS 移植自 `llm/trae/client.py`）
 *
 * TraeLLMClient 是 F045 §2.2 客户端薄层，所有文件 I/O 委托给 TraeBridgeProtocol：
 *   1. 会话上下文管理（可选，经 TraeSessionManager）
 *   2. 委托 protocol.writeRequest 写入 request_{uuid}.json
 *   3. 委托 protocol.pollResponse 轮询 response_{uuid}.json
 *   4. 委托 protocol.parseResponse 解析响应
 *   5. 返回标准 LLM 响应格式
 */
import {
  makeTraeBridgeConfig,
  makeTraeClientConfig,
  type TraeBridgeConfig,
  type TraeClientConfig,
} from './config.js';
import { TraeBridgeConfigError, TraeBridgeError } from './errors.js';
import {
  type BridgeMessage,
  type BridgeRequestContext,
  makeBridgeRequestContext,
} from './models.js';
import { TraeBridgeProtocol, type SleepFn } from './protocol.js';
import { TraeSessionManager, type SessionMemoryStore } from './session.js';

export interface TraeLLMClientOptions {
  /** TraeClientConfig（决定 mode/默认模型等） */
  readonly config?: TraeClientConfig | undefined;
  /** TraeBridgeConfig（桥接配置，对应 trae_bridge.yaml） */
  readonly bridgeConfig?: TraeBridgeConfig | undefined;
  /** TraeBridgeProtocol（文件协议层，优先使用） */
  readonly protocol?: TraeBridgeProtocol | undefined;
  /** 睡眠注入（streamChat 分块延迟，测试用） */
  readonly sleepFn?: SleepFn | undefined;
  /** 当前时间注入（延迟统计，测试用） */
  readonly nowMsFn?: (() => number) | undefined;
}

/** chat 的可选参数（对齐 Python **kwargs 向后兼容参数） */
export interface TraeChatOptions {
  readonly context?: BridgeRequestContext | undefined;
  readonly sessionId?: string | undefined;
  /** 可选任务 ID（向后兼容，等同于 request_id） */
  readonly taskId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly forgekinId?: string | undefined;
  readonly taskType?: string | undefined;
  readonly taskSummary?: string | undefined;
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly tools?: Record<string, unknown>[] | undefined;
}

/** 长任务类型（使用 long_task_timeout，对齐 Python chat 超时规则） */
const LONG_TASK_TYPES = new Set(['write_doc', 'generate_tests', 'review_code']);

export class TraeLLMClient {
  readonly config: TraeClientConfig;
  readonly bridgeConfig: TraeBridgeConfig;
  readonly protocol: TraeBridgeProtocol;
  readonly sessionManager: TraeSessionManager;
  private readonly sleepFn: SleepFn;
  private readonly nowMsFn: () => number;

  constructor(options: TraeLLMClientOptions = {}) {
    this.config = options.config ?? makeTraeClientConfig();
    this.bridgeConfig = options.bridgeConfig ?? makeTraeBridgeConfig();
    this.protocol = options.protocol ?? new TraeBridgeProtocol(this.bridgeConfig);
    this.sessionManager = new TraeSessionManager(this.config);
    this.sleepFn =
      options.sleepFn ??
      ((seconds) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
    this.nowMsFn = options.nowMsFn ?? (() => Date.now());
  }

  /** 注入持久化存储（会话持久化，依赖注入铁律 3） */
  setMemoryStore(memoryStore: SessionMemoryStore): void {
    this.sessionManager.setMemoryStore(memoryStore);
  }

  // ── 核心 chat 方法 ──────────────────────────────────────────────

  /**
   * 发送聊天请求并返回响应（F045 §2.1 协议流程步骤 1-6）.
   *
   * @throws TraeBridgeConfigError 桥接未启用
   * @throws TraeBridgeTimeoutError / TraeBridgeCancelledError / TraeBridgeProtocolError
   */
  async chat(messages: BridgeMessage[], options: TraeChatOptions = {}): Promise<Record<string, unknown>> {
    // 校验桥接启用
    if (!this.bridgeConfig.enabled) {
      throw new TraeBridgeConfigError('Trae 桥接未启用（bridge.enabled=false）');
    }

    // 构造请求上下文（不变量 7 operator 可见性）
    const ctx = options.context ??
      makeBridgeRequestContext({
        forgekin_id: options.forgekinId ?? 'unknown',
        task_type: options.taskType ?? 'chat',
        task_summary: options.taskSummary ?? '',
        model: options.model ?? this.config.default_model,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        tools: options.tools ?? null,
      });

    const sessionId = options.sessionId ?? '';

    // 会话上下文管理（可选）
    let fullMessages: BridgeMessage[] = messages;
    if (sessionId !== '' && this.config.session_persistence) {
      const session = this.sessionManager.createSession(sessionId);
      await session.load();
      // 如果传入的 messages 为空或只有一条，追加会话历史
      if (messages.length <= 1 && session.getContext().length > 0) {
        fullMessages = [...session.getContext(), ...messages];
      }
      // 将新的 user 消息加入会话
      for (const msg of messages) {
        if (msg.role === 'user') {
          session.addMessage(msg.role, msg.content);
        }
      }
    }

    // 计算超时：长任务用 long_task_timeout
    let effectiveTimeout = options.timeout;
    if (effectiveTimeout === undefined) {
      effectiveTimeout = LONG_TASK_TYPES.has(ctx.task_type)
        ? this.bridgeConfig.long_task_timeout_seconds
        : this.bridgeConfig.default_timeout_seconds;
    }

    const startTime = this.nowMsFn();
    try {
      // 委托 protocol 写入请求
      const requestId = await this.protocol.writeRequest(
        fullMessages,
        ctx,
        {
          sessionId,
          timeoutSeconds: Math.trunc(effectiveTimeout),
          requestId: options.taskId !== undefined && options.taskId !== ''
            ? options.taskId
            : undefined,
        },
      );

      // 委托 protocol 轮询响应
      const response = await this.protocol.pollResponse(requestId, {
        timeout: effectiveTimeout,
      });

      // 委托 protocol 解析响应
      const result = this.protocol.parseResponse(response);

      // 记录延迟
      const latencyMs = this.nowMsFn() - startTime;
      const usage =
        typeof result['usage'] === 'object' && result['usage'] !== null
          ? { ...(result['usage'] as Record<string, unknown>) }
          : {};
      usage['latency_ms'] = latencyMs;
      result['usage'] = usage;

      // 将 assistant 响应加入会话
      const content = typeof result['content'] === 'string' ? result['content'] : '';
      if (sessionId !== '' && this.config.session_persistence && content !== '') {
        const session = this.sessionManager.getSession(sessionId);
        if (session !== null) {
          session.addMessage('assistant', content);
          await session.save();
        }
      }

      return result;
    } catch (error) {
      if (error instanceof TraeBridgeError) {
        throw error;
      }
      throw new TraeBridgeError(`chat 调用失败: ${String(error)}`, {
        requestId: options.taskId ?? '',
      });
    }
  }

  /**
   * 流式聊天响应（Bridge 模式：先完整获取响应再按块 yield，模拟流式）.
   */
  async *streamChat(
    messages: BridgeMessage[],
    options: TraeChatOptions & { streamChunkSize?: number | undefined } = {},
  ): AsyncGenerator<string> {
    const result = await this.chat(messages, options);
    const content = typeof result['content'] === 'string' ? result['content'] : '';
    const chunkSize = options.streamChunkSize ?? 80;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield content.slice(i, i + chunkSize);
      await this.sleepFn(0.01); // 轻微延迟模拟流式
    }
  }

  /** 支持工具调用的聊天（tools 注入 context） */
  async chatWithTools(
    messages: BridgeMessage[],
    tools: Record<string, unknown>[],
    options: TraeChatOptions = {},
  ): Promise<Record<string, unknown>> {
    const ctx = options.context ??
      makeBridgeRequestContext({
        forgekin_id: options.forgekinId ?? 'unknown',
        task_type: 'chat_with_tools',
      });
    ctx.tools = tools;
    return await this.chat(messages, { ...options, context: ctx });
  }

  // ── 专用编码方法（便捷封装）──────────────────────────────────────

  /** 代码补全专用方法（只返回代码字符串） */
  async completeCode(
    prompt: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { contextCode?: string | undefined } = {},
  ): Promise<string> {
    const systemPrompt =
      '你是一个专业的代码补全助手。根据用户提供的上下文和提示，' +
      '生成高质量的代码补全。只返回代码，不要解释。';
    const contextCode = options.contextCode ?? '';
    const userContent = contextCode !== ''
      ? `上下文:\n${contextCode}\n\n补全提示:\n${prompt}`
      : prompt;
    const messages: BridgeMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
    context.task_type = 'complete_code';
    const result = await this.chat(messages, { ...options, context });
    return typeof result['content'] === 'string' ? result['content'] : '';
  }

  /** 代码审查专用方法（返回 {findings, severity, summary, raw_content}） */
  async reviewCode(
    code: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { language?: string | undefined } = {},
  ): Promise<Record<string, unknown>> {
    const language = options.language ?? 'python';
    const systemPrompt =
      '你是一个严格的代码审查专家。审查用户提交的代码，' +
      '识别潜在问题（bug、安全漏洞、性能问题、风格问题）。' +
      '返回 JSON 格式：\n' +
      '{"findings": [{"type": "bug|security|performance|style", ' +
      '"description": "问题描述", "line": 行号, "severity": "P1|P2|P3"}], ' +
      '"severity": "整体严重等级 P1|P2|P3", "summary": "总结"}';
    const userContent = `语言: ${language}\n\n代码:\n\`\`\`\n${code}\n\`\`\``;
    const messages: BridgeMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
    context.task_type = 'review_code';
    const result = await this.chat(messages, { ...options, context, temperature: 0.3 });
    const content = typeof result['content'] === 'string' ? result['content'] : '';

    const reviewResult: Record<string, unknown> = {
      findings: [],
      severity: 'P3',
      summary: content,
      raw_content: content,
    };
    try {
      let cleaned = content.trim().replace(/^```(?:json)?\s*/, '');
      cleaned = cleaned.trim().replace(/\s*```$/, '');
      const parsed: unknown = JSON.parse(cleaned);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(reviewResult, parsed as Record<string, unknown>);
      }
    } catch {
      // 代码审查响应非 JSON 格式，返回原始内容（对齐 Python 兜底）
    }
    return reviewResult;
  }

  /** 测试生成专用方法（只返回测试代码字符串） */
  async generateTests(
    code: string,
    context: BridgeRequestContext,
    options: Omit<TraeChatOptions, 'context'> & { language?: string | undefined } = {},
  ): Promise<string> {
    const language = options.language ?? 'python';
    const systemPrompt =
      '你是一个测试工程师专家。根据用户提供的代码生成全面的单元测试。' +
      '遵循以下原则：\n' +
      '1. 覆盖正常路径和边界情况\n' +
      '2. 测试异常和错误处理\n' +
      '3. 使用真实的测试框架（Python 用 pytest）\n' +
      "4. 测试数据必须是真实场景数据，禁止使用 'test'、'hello' 等假数据\n" +
      '只返回测试代码，不要解释。';
    const userContent = `语言: ${language}\n\n代码:\n\`\`\`\n${code}\n\`\`\``;
    const messages: BridgeMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
    context.task_type = 'generate_tests';
    const result = await this.chat(messages, { ...options, context, temperature: 0.5 });
    return typeof result['content'] === 'string' ? result['content'] : '';
  }

  // ── 健康检查 ────────────────────────────────────────────────────

  /** 检查 Trae 桥接是否可用（bridge 委托 protocol；cli/api 未实现返回 false） */
  async healthCheck(): Promise<boolean> {
    if (this.config.mode === 'bridge') {
      return await this.protocol.healthCheck();
    }
    return false;
  }
}
