/**
 * @flowforge/forgekin-trae-bridge — Trae 桥接 operator 端（TS 移植自 `llm/trae/bridge_operator.py`）
 *
 * F045 §2.1 协议流程步骤 4-5：
 *   - 监听 .trae_bridge/requests/ 目录中的 request_*.json 文件
 *   - 读取请求中的 messages 字段
 *   - 通过 OpenRoute API 调用 LLM（主模型 + fallback 模型重试）
 *   - 将 LLM 响应写入 responses/response_{request_id}.json
 *
 * 跨进程互斥：原子重命名 request_xxx.json → request_xxx.json.processing，
 * 重命名成功者获得处理权，解决多 operator 进程并发覆盖响应的竞态。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  cancelsPath,
  requestsPath,
  responsesPath,
  type TraeBridgeConfig,
} from './config.js';
import { BridgeResponseStatus } from './models.js';

/** fetch 响应最小结构（与全局 fetch Response 结构兼容） */
export interface OperatorFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** fetch 注入（测试用；默认全局 fetch） */
export type OperatorFetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal | undefined;
  },
) => Promise<OperatorFetchResponse>;

/** 睡眠注入（测试用） */
export type OperatorSleepFn = (seconds: number) => Promise<void>;

export interface BridgeLLMOperatorOptions {
  /** OpenRoute API 基础 URL（形如 http://localhost:13001/v1，尾部 /v1 剥离后统一拼接） */
  readonly openrouteBaseUrl?: string | undefined;
  /** OpenRoute API key（缺省读环境变量 OPENROUTE_API_KEY） */
  readonly openrouteApiKey?: string | undefined;
  /** 调用的模型名 */
  readonly model?: string | undefined;
  /** 轮询 requests 目录间隔秒数 */
  readonly pollInterval?: number | undefined;
  /** 单次 LLM 调用超时秒数 */
  readonly llmTimeout?: number | undefined;
  readonly fetchFn?: OperatorFetchFn | undefined;
  readonly sleepFn?: OperatorSleepFn | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void } | undefined;
}

/** callLlm 返回的结果字典（status: completed | timeout | error） */
export interface BridgeOperatorResult {
  content: string;
  status: string;
  usage: Record<string, unknown>;
  error: string;
  model: string;
  attempts: number;
}

const silentLogger = {
  info: (_msg: string): void => {},
  warn: (_msg: string): void => {},
  error: (_msg: string): void => {},
};

export class BridgeLLMOperator {
  /** 重试时切换的 fallback 模型列表（attempt>=2 按顺序切换） */
  static readonly FALLBACK_MODELS: string[] = ['Doubao-Seed2.0', 'Kimi-K2.6', 'GLM-5.1', 'auto'];

  /** 无效响应检测模式（沉默失败：状态 completed 但内容是"无法回答"等） */
  static readonly INVALID_RESPONSE_PATTERNS: string[] = [
    '无法回答',
    '无法回答这个问题',
    '我暂时无法回答',
    '我不能回答',
    '我无法提供',
    '我无法完成',
    '当前不可用，请稍后重试',
    '当前不可用,请稍后重试',
  ];

  readonly config: TraeBridgeConfig;
  readonly model: string;
  readonly pollInterval: number;
  readonly llmTimeout: number;
  /** 规范化后的 chat completions endpoint */
  readonly chatEndpoint: string;
  private readonly requestsDir: string;
  private readonly responsesDir: string;
  private readonly cancelsDir: string;
  private readonly openrouteApiKey: string;
  private readonly fetchFn: OperatorFetchFn;
  private readonly sleepFn: OperatorSleepFn;
  private readonly logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  private readonly handledRequests: Set<string> = new Set();
  private readonly counters: Record<string, number> = {
    received: 0,
    completed: 0,
    errors: 0,
    timeouts: 0,
    cancelled: 0,
  };
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(config: TraeBridgeConfig, options: BridgeLLMOperatorOptions = {}) {
    this.config = config;
    this.model = options.model ?? 'Doubao-Seed2.0';
    this.pollInterval = options.pollInterval ?? 1.0;
    this.llmTimeout = options.llmTimeout ?? 180;
    this.logger = options.logger ?? silentLogger;
    this.sleepFn =
      options.sleepFn ??
      ((seconds) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));

    const env = options.env ?? process.env;
    this.openrouteApiKey = options.openrouteApiKey ?? env['OPENROUTE_API_KEY'] ?? '';

    // 规范化 base_url：剥离尾部 /v1，后续统一拼 /v1/chat/completions
    const baseUrl = (options.openrouteBaseUrl ?? 'http://localhost:13001/v1').replace(
      /\/v1$/,
      '',
    );
    this.chatEndpoint = `${baseUrl}/v1/chat/completions`;

    this.requestsDir = requestsPath(config);
    this.responsesDir = responsesPath(config);
    this.cancelsDir = cancelsPath(config);

    // fetch 注入（默认全局 fetch）
    this.fetchFn =
      options.fetchFn ??
      (async (url, init) => {
        const reqInit: RequestInit = {
          method: init.method,
          headers: init.headers,
          body: init.body,
        };
        if (init.signal !== undefined) {
          reqInit.signal = init.signal;
        }
        return await fetch(url, reqInit);
      });
  }

  // ── 生命周期 ─────────────────────────────────────────────────

  /** 启动 operator：创建目录，开始轮询（重复调用幂等） */
  async start(): Promise<void> {
    if (this.loopPromise !== null) {
      return;
    }
    mkdirSync(this.requestsDir, { recursive: true });
    mkdirSync(this.responsesDir, { recursive: true });
    mkdirSync(this.cancelsDir, { recursive: true });
    this.running = true;
    this.loopPromise = this.pollLoop().finally(() => {
      this.loopPromise = null;
    });
    this.logger.info(
      `BridgeLLMOperator 已启动: requests=${this.requestsDir}, ` +
        `endpoint=${this.chatEndpoint}, model=${this.model}, ` +
        `poll_interval=${this.pollInterval}s, llm_timeout=${this.llmTimeout}s`,
    );
  }

  /** 停止 operator：软停止轮询循环 */
  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise !== null) {
      await this.loopPromise;
    }
    this.logger.info(`BridgeLLMOperator 已停止: stats=${JSON.stringify(this.counters)}`);
  }

  /** operator 是否正在运行 */
  get isRunning(): boolean {
    return this.running;
  }

  /** 获取 operator 统计信息（副本） */
  get stats(): Record<string, number> {
    return { ...this.counters };
  }

  // ── 轮询主循环 ───────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        for (const name of readdirSync(this.requestsDir)) {
          if (!name.startsWith('request_') || !name.endsWith('.json')) {
            continue;
          }
          await this.handleRequestFile(path.join(this.requestsDir, name));
        }
      } catch (error) {
        this.logger.warn(`轮询异常: ${String(error)}`);
        this.counters['errors'] = (this.counters['errors'] ?? 0) + 1;
      }
      if (!this.running) {
        break;
      }
      await this.sleepFn(this.pollInterval);
    }
  }

  /**
   * 处理单个 request 文件：读取、检查取消、调用 LLM、写响应.
   *
   * 跨进程互斥：原子重命名 request_xxx.json → request_xxx.json.processing，
   * 失败者表示已被其他 operator 进程接手，直接跳过。
   */
  async handleRequestFile(reqFile: string): Promise<void> {
    const processingFile = `${reqFile}.processing`;
    try {
      renameSync(reqFile, processingFile);
    } catch {
      // 文件不存在（已被处理/归档）或被其他进程抢先重命名
      return;
    }

    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(processingFile, 'utf-8'));
      if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError('request 不是 JSON 对象');
      }
      data = parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`解析 request 失败: ${processingFile}, ${String(error)}`);
      this.safeUnlink(processingFile);
      return;
    }

    const requestId = typeof data['request_id'] === 'string' ? data['request_id'] : '';
    if (requestId === '' || this.handledRequests.has(requestId)) {
      this.safeUnlink(processingFile);
      return;
    }

    // 只处理 pending 状态的请求
    if (data['status'] !== 'pending') {
      this.safeUnlink(processingFile);
      return;
    }

    this.handledRequests.add(requestId);
    this.counters['received'] = (this.counters['received'] ?? 0) + 1;

    const messages = Array.isArray(data['messages'])
      ? (data['messages'] as Array<Record<string, unknown>>)
      : [];
    const context =
      typeof data['context'] === 'object' && data['context'] !== null
        ? (data['context'] as Record<string, unknown>)
        : {};
    this.logger.info(
      `收到请求: ${requestId.slice(0, 8)}... ` +
        `(forgekin=${String(context['forgekin_id'] ?? '?')}, ` +
        `task=${String(context['task_type'] ?? '?')})`,
    );

    // 检查取消文件（不变量 8 逃生舱）
    const cancelFile = path.join(this.cancelsDir, `cancel_${requestId}.json`);
    if (existsSync(cancelFile)) {
      this.counters['cancelled'] = (this.counters['cancelled'] ?? 0) + 1;
      this.logger.info(`检测到 cancel 文件，跳过请求: ${requestId.slice(0, 8)}...`);
      this.safeUnlink(processingFile);
      return;
    }

    // 调用 LLM 并写回响应
    const result = await this.callLlm(messages);

    // 按结果状态更新统计
    if (result.status === BridgeResponseStatus.COMPLETED) {
      this.counters['completed'] = (this.counters['completed'] ?? 0) + 1;
    } else if (result.status === BridgeResponseStatus.TIMEOUT) {
      this.counters['timeouts'] = (this.counters['timeouts'] ?? 0) + 1;
    } else {
      this.counters['errors'] = (this.counters['errors'] ?? 0) + 1;
    }

    await this.writeResponse(requestId, result);
    // 处理完成，清理 .processing 文件
    this.safeUnlink(processingFile);
  }

  /** 安全删除文件，忽略文件不存在的错误 */
  private safeUnlink(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`删除文件失败: ${filePath}, ${String(error)}`);
      }
    }
  }

  // ── 无效响应检测 ─────────────────────────────────────────────

  /** 检测 LLM 响应是否为无效的沉默失败内容（需要重试） */
  isInvalidResponse(content: string): boolean {
    if (!content || content.trim() === '') {
      return false;
    }

    const stripped = content.trim();

    // 1. 精确匹配或主要匹配 INVALID_RESPONSE_PATTERNS
    for (const pattern of BridgeLLMOperator.INVALID_RESPONSE_PATTERNS) {
      if (stripped === pattern) {
        return true;
      }
      if (stripped.startsWith(pattern)) {
        return true;
      }
      // 主要匹配：pattern 是内容的核心部分
      if (stripped.includes(pattern) && stripped.length <= pattern.length + 20) {
        return true;
      }
    }

    // 2. 内容过短（<10字符）且包含"无法"/"不能"/"暂"等关键词
    if (stripped.length < 10) {
      const shortKeywords = ['无法', '不能', '暂'];
      if (shortKeywords.some((kw) => stripped.includes(kw))) {
        return true;
      }
    }

    return false;
  }

  // ── 消息预处理 ───────────────────────────────────────────────

  /**
   * 将 system role message 合并到第一条 user message 前面.
   *
   * OpenRoute 的 web chat 模型不处理 system role message，本方法将
   * 所有 system 内容合并到第一条 user 消息前，确保模型能"看到"角色设定。
   */
  mergeSystemIntoUser(
    messages: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    if (messages.length === 0) {
      return messages;
    }

    const systemContents: string[] = [];
    const otherMessages: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      const role = msg['role'];
      const content = typeof msg['content'] === 'string' ? msg['content'] : '';
      if (role === 'system') {
        if (content !== '') {
          systemContents.push(content);
        }
      } else {
        otherMessages.push(msg);
      }
    }

    if (systemContents.length === 0) {
      return messages;
    }

    const mergedSystem = systemContents.join('\n\n');
    const result: Array<Record<string, unknown>> = [];
    let userMerged = false;
    for (const msg of otherMessages) {
      if (msg['role'] === 'user' && !userMerged) {
        const userContent = typeof msg['content'] === 'string' ? msg['content'] : '';
        result.push({
          role: 'user',
          content: `${mergedSystem}\n\n---\n\n${userContent}`,
        });
        userMerged = true;
      } else {
        result.push(msg);
      }
    }

    // 如果没有 user 消息，把 system 作为 user 消息
    if (!userMerged) {
      result.unshift({ role: 'user', content: mergedSystem });
    }

    return result;
  }

  // ── LLM 调用 ─────────────────────────────────────────────────

  /**
   * 调用 OpenRoute chat completions API.
   *
   * 无效响应检测与重试：沉默失败内容自动重试最多 3 次（间隔 2 秒）；
   * attempt=1 用主模型，重试时按 FALLBACK_MODELS 顺序切换。
   * 超时重试；其他异常不重试直接返回 error。
   */
  async callLlm(messages: Array<Record<string, unknown>>): Promise<BridgeOperatorResult> {
    const maxAttempts = 3;
    const retryWaitSeconds = 2.0;
    let lastResult: BridgeOperatorResult | null = null;

    // 预处理 messages：合并 system 到 user
    const processedMessages = this.mergeSystemIntoUser(messages);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startTime = Date.now();

      // 模型选择：attempt=1 用主模型；重试时切换到 fallback 模型
      let model = this.model;
      if (attempt > 1) {
        const fallbackIdx = Math.min(attempt - 1, BridgeLLMOperator.FALLBACK_MODELS.length - 1);
        model = BridgeLLMOperator.FALLBACK_MODELS[fallbackIdx] ?? this.model;
        this.logger.info(`切换到 fallback 模型 (attempt=${attempt}/${maxAttempts}): ${model}`);
      }

      const emptyUsage = (): Record<string, unknown> => ({
        latency_ms: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });

      try {
        const payload = { model, messages: processedMessages };
        const resp = await this.fetchFn(this.chatEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openrouteApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.llmTimeout * 1000),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const rawData = (await resp.json()) as Record<string, unknown>;

        let content = '';
        const choices = Array.isArray(rawData['choices'])
          ? (rawData['choices'] as Array<Record<string, unknown>>)
          : [];
        const firstChoice = choices[0];
        if (firstChoice !== undefined) {
          const message =
            typeof firstChoice['message'] === 'object' && firstChoice['message'] !== null
              ? (firstChoice['message'] as Record<string, unknown>)
              : {};
          content = typeof message['content'] === 'string' ? message['content'] : '';
        }

        const usage =
          typeof rawData['usage'] === 'object' && rawData['usage'] !== null
            ? (rawData['usage'] as Record<string, unknown>)
            : {};
        const latencyMs = Date.now() - startTime;
        const usageWithLatency: Record<string, unknown> = {
          latency_ms: latencyMs,
          prompt_tokens: usage['prompt_tokens'] ?? 0,
          completion_tokens: usage['completion_tokens'] ?? 0,
          total_tokens: usage['total_tokens'] ?? 0,
        };

        // 检测无效响应（沉默失败：状态 completed 但内容无效）
        if (this.isInvalidResponse(content)) {
          this.logger.warn(`检测到无效响应 (attempt=${attempt}): ${content.slice(0, 50)}...`);
          lastResult = {
            content,
            status: BridgeResponseStatus.COMPLETED,
            usage: usageWithLatency,
            error: '',
            model,
            attempts: attempt,
          };
          if (attempt < maxAttempts) {
            await this.sleepFn(retryWaitSeconds);
            continue;
          }
          this.logger.warn(`重试耗尽，返回最后响应 (attempts=${attempt})`);
          return lastResult;
        }

        this.logger.info(
          `LLM 调用成功: latency=${latencyMs}ms, ` +
            `tokens=${String(usageWithLatency['total_tokens'])}, ` +
            `content_len=${content.length}, attempts=${attempt}`,
        );

        return {
          content,
          status: BridgeResponseStatus.COMPLETED,
          usage: usageWithLatency,
          error: '',
          model,
          attempts: attempt,
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const isTimeout =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

        if (isTimeout) {
          const errMsg = `LLM 调用超时: ${String(error)}`;
          this.logger.warn(`${errMsg} (latency=${latencyMs}ms)`);
          lastResult = {
            content: errMsg,
            status: BridgeResponseStatus.TIMEOUT,
            usage: { ...emptyUsage(), latency_ms: latencyMs },
            error: errMsg,
            model,
            attempts: attempt,
          };
          if (attempt < maxAttempts) {
            await this.sleepFn(retryWaitSeconds);
            continue;
          }
          this.logger.warn(`重试耗尽，返回超时 (attempts=${attempt})`);
          return lastResult;
        }

        // 其他异常不重试（对齐 Python：超时重试，其余直接返回 error）
        const errMsg = `LLM 调用失败: ${String(error)}`;
        this.logger.error(`${errMsg} (latency=${latencyMs}ms)`);
        return {
          content: errMsg,
          status: BridgeResponseStatus.ERROR,
          usage: { ...emptyUsage(), latency_ms: latencyMs },
          error: errMsg,
          model,
          attempts: attempt,
        };
      }
    }

    // 防御性兜底：循环正常结束但未返回（理论不会到达）
    return (
      lastResult ?? {
        content: '',
        status: BridgeResponseStatus.ERROR,
        usage: {},
        error: '未知错误：重试循环异常退出',
        model: this.model,
        attempts: 3,
      }
    );
  }

  // ── 响应写入 ─────────────────────────────────────────────────

  /** 写入 response_{request_id}.json 文件 */
  async writeResponse(requestId: string, result: BridgeOperatorResult): Promise<void> {
    const responseFile = path.join(this.responsesDir, `response_${requestId}.json`);
    const payload = {
      request_id: requestId,
      content: result.content,
      status: result.status,
      model: result.model !== '' ? result.model : this.model,
      usage: result.usage,
      tool_calls: [],
      error: result.error,
      completed_at: new Date().toISOString(),
    };
    try {
      writeFileSync(responseFile, JSON.stringify(payload, null, 2), 'utf-8');
      this.logger.info(
        `已写入响应: ${requestId.slice(0, 8)}... ` +
          `(status=${payload.status}, content_len=${payload.content.length})`,
      );
    } catch (error) {
      this.logger.error(`写入 response 失败: ${requestId}, ${String(error)}`);
    }
  }
}
