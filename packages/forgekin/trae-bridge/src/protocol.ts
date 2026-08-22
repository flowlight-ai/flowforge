/**
 * @flowforge/forgekin-trae-bridge — 协议层（TS 移植自 `llm/trae/protocol.py`）
 *
 * TraeBridgeProtocol 负责所有文件 I/O 与协议逻辑：
 *   - writeRequest: 写入 request_{uuid}.json（不变量 1 唯一性 + 不变量 7 operator 可见性）
 *   - pollResponse: 轮询 response_{uuid}.json（不变量 3 超时保证 + 不变量 8 逃生舱）
 *   - parseResponse: 解析响应为标准 LLM 返回格式
 *   - writeCancel: 写入取消文件（不变量 8）
 *   - archiveRequestResponse: 归档完成请求（不变量 4 不丢数据）
 *   - bumpStatus: 更新 status.json（不变量 7）
 *
 * 设计原则：协议层无 LLM 逻辑；所有路径从 TraeBridgeConfig 读取（不变量 6）；
 * sleepFn/nowFn/uuidFn 可注入（测试控制）。
 */
import {
  accessSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  acksPath,
  archivePath,
  cancelsPath,
  requestsPath,
  responsesPath,
  statusFilePath,
  type TraeBridgeConfig,
} from './config.js';
import {
  TraeBridgeCancelledError,
  TraeBridgeIOError,
  TraeBridgeProtocolError,
  TraeBridgeTimeoutError,
} from './errors.js';
import {
  type BridgeCancel,
  type BridgeMessage,
  type BridgeRequestContext,
  BridgeRequestStatus,
  BridgeResponseStatus,
  type BridgeResponse,
  type BridgeStatus,
  makeBridgeCancel,
  makeBridgeRequest,
  makeBridgeStatus,
  parseBridgeCancel,
  parseBridgeResponse,
  parseBridgeStatus,
  validateBridgeMessage,
} from './models.js';

/** 睡眠注入（测试用；默认 setTimeout） */
export type SleepFn = (seconds: number) => Promise<void>;
/** 当前时间注入（测试用；返回 epoch 毫秒） */
export type NowMsFn = () => number;
/** UUID 注入（测试用；默认 node:crypto randomUUID） */
export type UuidFn = () => string;
/** 日志注入（默认 console.warn/info） */
export interface BridgeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** watcher 等待事件结果 */
export type BridgeWaitEvent =
  | { readonly kind: 'response'; readonly filePath: string }
  | { readonly kind: 'cancel'; readonly filePath: string };

/** 可选事件驱动监听器接口（对齐 Python TraeBridgeWatcher 关键接口） */
export interface BridgeWatcherLike {
  readonly available: boolean;
  readonly started: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  wait(requestId: string, timeoutSeconds: number): Promise<BridgeWaitEvent | null>;
}

export interface TraeBridgeProtocolOptions {
  /** 可选的预创建 watcher 实例（优先级高于 enableWatcher） */
  readonly watcher?: BridgeWatcherLike | undefined;
  /** 是否采用传入/外部管理的 watcher（本实现不自动创建） */
  readonly enableWatcher?: boolean | undefined;
  readonly sleepFn?: SleepFn | undefined;
  readonly nowMsFn?: NowMsFn | undefined;
  readonly uuidFn?: UuidFn | undefined;
  readonly logger?: BridgeLogger | undefined;
}

const defaultLogger: BridgeLogger = {
  debug: () => {},
  info: () => {},
  warn: (message) => console.warn(`[trae-bridge] ${message}`),
  error: (message) => console.error(`[trae-bridge] ${message}`),
};

const defaultSleepFn: SleepFn = (seconds) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));

/** 从文件 JSON 读取顶层对象（失败返回 null） */
function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class TraeBridgeProtocol {
  readonly config: TraeBridgeConfig;
  readonly sharedDir: string;
  readonly requestsDir: string;
  readonly responsesDir: string;
  readonly cancelsDir: string;
  readonly acksDir: string;
  readonly archiveDir: string;
  readonly statusFile: string;
  /** 关联的 watcher 实例（可能为 null 或未启动） */
  watcher: BridgeWatcherLike | null;
  /** watcher 是否由本实例管理生命周期（外部注入的不归本实例管理） */
  readonly watcherOwned: boolean;
  readonly sleepFn: SleepFn;
  readonly nowMsFn: NowMsFn;
  readonly uuidFn: UuidFn;
  readonly logger: BridgeLogger;

  constructor(config: TraeBridgeConfig, options: TraeBridgeProtocolOptions = {}) {
    this.config = config;
    this.sharedDir = config.shared_dir;
    this.requestsDir = requestsPath(config);
    this.responsesDir = responsesPath(config);
    this.cancelsDir = cancelsPath(config);
    this.acksDir = acksPath(config);
    this.archiveDir = archivePath(config);
    this.statusFile = statusFilePath(config);
    this.sleepFn = options.sleepFn ?? defaultSleepFn;
    this.nowMsFn = options.nowMsFn ?? (() => Date.now());
    this.uuidFn = options.uuidFn ?? randomUUID;
    this.logger = options.logger ?? defaultLogger;
    this.watcher = options.watcher ?? null;
    this.watcherOwned = false; // TS 实现不自动创建 watcher，外部注入统一管理
    this.ensureDirs();
  }

  // ── 目录初始化 ──────────────────────────────────────────────────

  /** 确保所有桥接目录存在（失败抛 TraeBridgeIOError；不变量 6 路径从配置读取） */
  ensureDirs(): void {
    try {
      for (const dir of [
        this.sharedDir,
        this.requestsDir,
        this.responsesDir,
        this.cancelsDir,
        this.acksDir,
        this.archiveDir,
      ]) {
        mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      throw new TraeBridgeIOError(
        `创建桥接目录失败: ${this.sharedDir}, ${String(error)}`,
      );
    }

    if (this.config.cleanup_on_startup) {
      this.cleanupPendingRequests();
    }
  }

  /** 启动时清理遗留的 pending 请求（标记为 timeout；不变量 3 超时保证） */
  cleanupPendingRequests(): void {
    try {
      for (const name of readdirSync(this.requestsDir)) {
        if (!name.startsWith('request_') || !name.endsWith('.json')) {
          continue;
        }
        const filePath = path.join(this.requestsDir, name);
        try {
          const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
          if (data['status'] === BridgeRequestStatus.PENDING) {
            data['status'] = BridgeRequestStatus.TIMEOUT;
            data['timeout_at'] = new Date(this.nowMsFn()).toISOString();
            writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            this.logger.warn(`启动清理：标记遗留请求为 timeout: ${name}`);
          }
        } catch (error) {
          this.logger.warn(`清理请求文件失败: ${filePath}, ${String(error)}`);
        }
      }
    } catch (error) {
      this.logger.warn(`cleanup_pending_requests 异常: ${String(error)}`);
    }
  }

  // ── 写入请求（不变量 1 + 7）────────────────────────────────────

  /**
   * 写入 request_{uuid}.json 文件（F045 §2.1 协议流程步骤 2）.
   *
   * @returns request_id（UUID4，用于后续 pollResponse）
   * @throws TraeBridgeProtocolError 消息格式非法
   * @throws TraeBridgeIOError 文件写入失败
   */
  async writeRequest(
    messages: unknown[],
    context: BridgeRequestContext,
    options: {
      sessionId?: string | undefined;
      timeoutSeconds?: number | undefined;
      requestId?: string | undefined;
    } = {},
  ): Promise<string> {
    const rid = options.requestId && options.requestId.length > 0
      ? options.requestId
      : this.uuidFn();

    if (messages.length === 0) {
      throw new TraeBridgeProtocolError('messages 不能为空');
    }
    let bridgeMessages: BridgeMessage[];
    try {
      bridgeMessages = messages.map((m) => validateBridgeMessage(m));
    } catch (error) {
      throw new TraeBridgeProtocolError(
        `消息格式非法（role 必须是 system/user/assistant）: ${String(error)}`,
        { requestId: rid },
      );
    }

    const timeoutSecs = options.timeoutSeconds ?? this.config.default_timeout_seconds;
    const request = makeBridgeRequest({
      request_id: rid,
      session_id: options.sessionId ?? '',
      messages: bridgeMessages,
      context,
      timeout_seconds: timeoutSecs,
      created_at: new Date(this.nowMsFn()).toISOString(),
      status: BridgeRequestStatus.PENDING,
    });

    const requestFile = path.join(this.requestsDir, `request_${rid}.json`);
    try {
      await writeFile(requestFile, JSON.stringify(request, null, 2), 'utf-8');
    } catch (error) {
      throw new TraeBridgeIOError(
        `写入请求文件失败: ${requestFile}, ${String(error)}`,
        { requestId: rid },
      );
    }

    this.logger.info(
      `Bridge 请求已写入: request_${rid}.json ` +
        `(forgekin=${context.forgekin_id}, task=${context.task_type}, ` +
        `session=${options.sessionId ?? 'N/A'}, timeout=${timeoutSecs}s)`,
    );

    if (this.config.update_status_on_write) {
      await this.bumpStatus({ pendingDelta: 1 });
    }

    return rid;
  }

  // ── 轮询响应（不变量 3 + 8）─────────────────────────────────────

  /**
   * 等待 response_{uuid}.json 到达或超时/取消（F045 §2.1 协议流程步骤 3）.
   *
   * 监听过程中同时检测：
   *   - response 到达 → 解析返回
   *   - cancel 到达 → 抛 TraeBridgeCancelledError（不变量 8）
   *   - 超时 → 标记 request 为 timeout，抛 TraeBridgeTimeoutError（不变量 3）
   *
   * @throws TraeBridgeTimeoutError / TraeBridgeCancelledError / TraeBridgeProtocolError
   */
  async pollResponse(
    requestId: string,
    options: { timeout?: number | undefined } = {},
  ): Promise<BridgeResponse> {
    const responseFile = path.join(this.responsesDir, `response_${requestId}.json`);
    const cancelFile = path.join(this.cancelsDir, `cancel_${requestId}.json`);

    // 解析超时：优先用传入参数，否则读 request 文件中的 timeout_seconds
    let effectiveTimeout = options.timeout;
    if (effectiveTimeout === undefined) {
      effectiveTimeout = this.readRequestTimeout(requestId) ?? undefined;
    }
    effectiveTimeout = effectiveTimeout || this.config.default_timeout_seconds;

    // 路径选择：watcher 已启动 → 事件驱动；否则 → 轮询
    const useWatcher =
      this.watcher !== null && this.watcher.started && this.watcher.available;

    let kind: 'response' | 'cancel';
    if (useWatcher && this.watcher !== null) {
      const event = await this.watcher.wait(requestId, effectiveTimeout);
      if (event === null) {
        await this.markTimeout(requestId, effectiveTimeout);
      }
      kind = event?.kind ?? 'response'; // markTimeout 已抛错，此处不会到达
    } else {
      kind = await this.waitWithPolling(
        requestId,
        responseFile,
        cancelFile,
        effectiveTimeout,
      );
    }

    // 处理取消
    if (kind === 'cancel') {
      const cancelData = this.readCancelFile(cancelFile, requestId);
      this.logger.warn(
        `Bridge 请求被 operator 取消: ${requestId}, reason=${cancelData.reason}`,
      );
      await this.updateRequestStatus(requestId, BridgeRequestStatus.CANCELLED);
      if (this.config.update_status_on_complete) {
        await this.bumpStatus({ cancelledDelta: 1 });
      }
      throw new TraeBridgeCancelledError(
        `operator 取消请求: ${cancelData.reason || '无理由'}`,
        { requestId },
      );
    }

    // kind === "response"：解析响应文件
    let data: unknown;
    try {
      const raw = await readFile(responseFile, 'utf-8');
      data = JSON.parse(raw);
    } catch (error) {
      throw new TraeBridgeProtocolError(
        `响应文件解析失败: ${responseFile}, ${String(error)}`,
        { requestId },
      );
    }

    const parsed = typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : null;
    // 校验 request_id 配对（不变量 2）
    if (parsed === null || parsed['request_id'] !== requestId) {
      throw new TraeBridgeProtocolError(
        `响应 request_id 不匹配: 期望 ${requestId}, 实际 ${String(parsed?.['request_id'])}`,
        { requestId },
      );
    }

    let response: BridgeResponse;
    try {
      response = parseBridgeResponse(data);
    } catch (error) {
      throw new TraeBridgeProtocolError(`响应数据校验失败: ${String(error)}`, { requestId });
    }

    // 错误响应
    if (response.status === BridgeResponseStatus.ERROR) {
      this.logger.error(`Bridge 响应错误: ${requestId}, error=${response.error}`);
      await this.archiveRequestResponse(requestId);
      if (this.config.update_status_on_complete) {
        await this.bumpStatus({ completedDelta: 1 });
      }
      throw new TraeBridgeProtocolError(`LLM 调用错误: ${response.error}`, { requestId });
    }

    // 正常完成
    this.logger.info(
      `Bridge 响应已收到: ${requestId} (content_len=${response.content.length})`,
    );
    await this.archiveRequestResponse(requestId);
    if (this.config.update_status_on_complete) {
      await this.bumpStatus({ completedDelta: 1 });
    }
    return response;
  }

  /** 超时标记 + 状态计数 + 抛 TraeBridgeTimeoutError（不变量 3） */
  private async markTimeout(requestId: string, effectiveTimeout: number): Promise<never> {
    await this.updateRequestStatus(requestId, BridgeRequestStatus.TIMEOUT);
    if (this.config.update_status_on_complete) {
      await this.bumpStatus({ timeoutDelta: 1 });
    }
    throw new TraeBridgeTimeoutError(
      `Bridge 超时: request_id=${requestId}, timeout=${effectiveTimeout}s`,
      { requestId },
    );
  }

  /** 轮询等待：周期性检查 response/cancel 文件存在（先查 cancel 再 response） */
  private async waitWithPolling(
    requestId: string,
    responseFile: string,
    cancelFile: string,
    effectiveTimeout: number,
  ): Promise<'response' | 'cancel'> {
    const pollInterval = this.config.poll_interval_seconds;
    const start = this.nowMsFn();
    let elapsedSeconds = 0.0;
    let lastLogSeconds = 0.0;

    while (elapsedSeconds < effectiveTimeout) {
      // 检测取消（不变量 8 逃生舱）
      if (existsSync(cancelFile)) {
        return 'cancel';
      }
      // 检测响应
      if (existsSync(responseFile)) {
        return 'response';
      }
      // 等待下一轮
      await this.sleepFn(pollInterval);
      elapsedSeconds = (this.nowMsFn() - start) / 1000;

      // 每 30 秒打印一次等待日志
      if (elapsedSeconds - lastLogSeconds >= 30) {
        this.logger.debug(
          `Bridge 等待响应: request_id=${requestId}, ` +
            `elapsed=${Math.round(elapsedSeconds)}s/${Math.round(effectiveTimeout)}s`,
        );
        lastLogSeconds = elapsedSeconds;
      }
    }

    // 超时（不变量 3）：markTimeout 总是抛出，此处返回仅为类型兜底（不可达）
    await this.markTimeout(requestId, effectiveTimeout);
    return 'response';
  }

  // ── 解析响应 ────────────────────────────────────────────────────

  /** 解析 BridgeResponse 为标准 LLM 返回格式（对齐 LLMClient.chat 兼容字典） */
  parseResponse(response: BridgeResponse): Record<string, unknown> {
    return {
      content: response.content,
      model: response.model,
      usage: response.usage,
      tool_calls: response.tool_calls ?? [],
      provider: 'trae',
      request_id: response.request_id,
      completed_at: response.completed_at ?? '',
    };
  }

  // ── 取消机制（不变量 8 逃生舱）──────────────────────────────────

  /** 写入 cancel_{uuid}.json 取消进行中的请求 */
  async writeCancel(
    requestId: string,
    reason = '',
    cancelledBy = 'operator',
  ): Promise<void> {
    const cancel = makeBridgeCancel({
      request_id: requestId,
      reason,
      cancelled_by: cancelledBy,
      cancelled_at: new Date(this.nowMsFn()).toISOString(),
    });
    const cancelFile = path.join(this.cancelsDir, `cancel_${requestId}.json`);
    try {
      await writeFile(cancelFile, JSON.stringify(cancel, null, 2), 'utf-8');
    } catch (error) {
      throw new TraeBridgeIOError(
        `写入取消文件失败: ${cancelFile}, ${String(error)}`,
        { requestId },
      );
    }
    this.logger.info(`Bridge 取消请求: ${requestId}, reason=${reason}`);
  }

  // ── 归档机制（不变量 4 不丢数据）────────────────────────────────

  /** 归档完成的 request/response 文件到 archive/ */
  async archiveRequestResponse(requestId: string): Promise<void> {
    if (!this.config.archive_completed) {
      return;
    }

    const requestFile = path.join(this.requestsDir, `request_${requestId}.json`);
    const responseFile = path.join(this.responsesDir, `response_${requestId}.json`);
    const cancelFile = path.join(this.cancelsDir, `cancel_${requestId}.json`);
    const ackFile = path.join(this.acksDir, `ack_${requestId}.json`);

    const timestamp = formatArchiveTimestamp(new Date(this.nowMsFn()));
    const archivePrefix = `${timestamp}_${requestId.slice(0, 8)}`;

    for (const src of [requestFile, responseFile, cancelFile, ackFile]) {
      if (existsSync(src)) {
        const dst = path.join(this.archiveDir, `${archivePrefix}_${path.basename(src)}`);
        try {
          renameSync(src, dst);
        } catch (error) {
          this.logger.warn(`归档文件失败: ${src} → ${dst}, ${String(error)}`);
        }
      }
    }

    // 清理归档目录超限文件
    await this.enforceArchiveLimit();
  }

  /** 清理归档目录，保留最近 max_archive_files 个文件（按 mtime 倒序） */
  async enforceArchiveLimit(): Promise<void> {
    try {
      const entries = readdirSync(this.archiveDir)
        .map((name) => {
          const filePath = path.join(this.archiveDir, name);
          try {
            return { filePath, mtimeMs: statSync(filePath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { filePath: string; mtimeMs: number } => item !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      if (entries.length <= this.config.max_archive_files) {
        return;
      }
      const excess = entries.slice(this.config.max_archive_files);
      for (const item of excess) {
        try {
          await unlink(item.filePath);
        } catch (error) {
          this.logger.warn(`清理归档文件失败: ${item.filePath}, ${String(error)}`);
        }
      }
      this.logger.info(`清理归档目录：删除 ${excess.length} 个旧文件`);
    } catch (error) {
      this.logger.warn(`enforce_archive_limit 异常: ${String(error)}`);
    }
  }

  // ── 状态总览（不变量 7 operator 可见性）────────────────────────

  /** 更新 status.json 计数器（失败仅 warning，不影响主流程） */
  async bumpStatus(deltas: {
    pendingDelta?: number | undefined;
    processingDelta?: number | undefined;
    completedDelta?: number | undefined;
    timeoutDelta?: number | undefined;
    cancelledDelta?: number | undefined;
  }): Promise<void> {
    try {
      const status = this.readStatus();
      const next: BridgeStatus = {
        pending_count: Math.max(0, status.pending_count + (deltas.pendingDelta ?? 0)),
        processing_count: Math.max(0, status.processing_count + (deltas.processingDelta ?? 0)),
        completed_total: Math.max(0, status.completed_total + (deltas.completedDelta ?? 0)),
        timeout_total: Math.max(0, status.timeout_total + (deltas.timeoutDelta ?? 0)),
        cancelled_total: Math.max(0, status.cancelled_total + (deltas.cancelledDelta ?? 0)),
        last_activity_at: new Date(this.nowMsFn()).toISOString(),
      };
      await writeFile(this.statusFile, JSON.stringify(next, null, 2), 'utf-8');
    } catch (error) {
      this.logger.warn(`更新 status.json 失败: ${String(error)}`);
    }
  }

  /** 读取 status.json，不存在/损坏则返回空状态 */
  readStatus(): BridgeStatus {
    const data = readJsonFile(this.statusFile);
    return data === null ? makeBridgeStatus() : parseBridgeStatus(data);
  }

  // ── 辅助方法 ────────────────────────────────────────────────────

  /** 从 request 文件读取 timeout_seconds（缺失返回 null） */
  readRequestTimeout(requestId: string): number | null {
    const requestFile = path.join(this.requestsDir, `request_${requestId}.json`);
    try {
      if (existsSync(requestFile)) {
        const data = readJsonFile(requestFile);
        const value = data?.['timeout_seconds'];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          return value;
        }
      }
    } catch (error) {
      this.logger.warn(`读取请求超时失败: ${requestFile}, ${String(error)}`);
    }
    return null;
  }

  /** 更新 request 文件的 status 字段（timeout/cancelled 附加时间戳；失败仅 warning） */
  async updateRequestStatus(
    requestId: string,
    status: BridgeRequestStatus,
  ): Promise<void> {
    const requestFile = path.join(this.requestsDir, `request_${requestId}.json`);
    try {
      if (!existsSync(requestFile)) {
        return;
      }
      const data = JSON.parse(readFileSync(requestFile, 'utf-8')) as Record<string, unknown>;
      data['status'] = status;
      if (status === BridgeRequestStatus.TIMEOUT) {
        data['timeout_at'] = new Date(this.nowMsFn()).toISOString();
      } else if (status === BridgeRequestStatus.CANCELLED) {
        data['cancelled_at'] = new Date(this.nowMsFn()).toISOString();
      }
      await writeFile(requestFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      this.logger.warn(`更新请求状态失败: ${requestFile}, ${String(error)}`);
    }
  }

  /** 读取 cancel 文件（解析失败兜底 reason="解析失败: ..."） */
  readCancelFile(cancelFile: string, requestId: string): BridgeCancel {
    try {
      const data = JSON.parse(readFileSync(cancelFile, 'utf-8'));
      return parseBridgeCancel(data, requestId);
    } catch (error) {
      this.logger.warn(`解析 cancel 文件失败: ${cancelFile}, ${String(error)}`);
      return makeBridgeCancel({
        request_id: requestId,
        reason: `解析失败: ${String(error)}`,
        cancelled_by: 'operator',
      });
    }
  }

  // ── 健康检查 ────────────────────────────────────────────────────

  /** 检查桥接目录是否可读写（.health_check 写-读-删） */
  async healthCheck(): Promise<boolean> {
    try {
      const testFile = path.join(this.requestsDir, '.health_check');
      await writeFile(testFile, 'ok', 'utf-8');
      const content = await readFile(testFile, 'utf-8');
      await unlink(testFile);
      return content === 'ok';
    } catch (error) {
      this.logger.warn(`桥接健康检查失败: ${String(error)}`);
      return false;
    }
  }

  // ── 查询方法（供 operator/调试用）──────────────────────────────

  /** 列出所有 pending 状态的请求（按 created_at 升序，最该处理的优先） */
  listPendingRequests(): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    try {
      for (const name of readdirSync(this.requestsDir)) {
        if (!name.startsWith('request_') || !name.endsWith('.json')) {
          continue;
        }
        const filePath = path.join(this.requestsDir, name);
        const data = readJsonFile(filePath);
        if (data === null) {
          continue;
        }
        if (data['status'] !== BridgeRequestStatus.PENDING) {
          continue;
        }
        const context = typeof data['context'] === 'object' && data['context'] !== null
          ? (data['context'] as Record<string, unknown>)
          : {};
        result.push({
          request_id: typeof data['request_id'] === 'string' ? data['request_id'] : '',
          forgekin_id: typeof context['forgekin_id'] === 'string' ? context['forgekin_id'] : '',
          task_type: typeof context['task_type'] === 'string' ? context['task_type'] : '',
          task_summary: typeof context['task_summary'] === 'string'
            ? context['task_summary']
            : '',
          created_at: typeof data['created_at'] === 'string' ? data['created_at'] : '',
          timeout_seconds: typeof data['timeout_seconds'] === 'number'
            ? data['timeout_seconds']
            : 0,
          file: name,
        });
      }
    } catch (error) {
      this.logger.warn(`list_pending_requests 异常: ${String(error)}`);
    }
    result.sort((a, b) => String(a['created_at'] ?? '').localeCompare(String(b['created_at'] ?? '')));
    return result;
  }

  /** 获取当前桥接状态总览 */
  getStatus(): BridgeStatus {
    return this.readStatus();
  }

  // ── Watcher 生命周期管理（F045 §3.2 Phase 3）──────────────────

  /** watcher 是否已启用（已启动且可用） */
  get watcherEnabled(): boolean {
    return this.watcher !== null && this.watcher.started && this.watcher.available;
  }

  /** 启动文件监听器（失败返回 False，调用方继续使用轮询模式自动降级） */
  async startWatcher(): Promise<boolean> {
    if (this.watcher === null) {
      this.logger.info('watcher 未配置，跳过启动（使用轮询模式）');
      return false;
    }
    if (this.watcher.started) {
      return true;
    }
    if (!this.watcher.available) {
      this.logger.warn('watcher 不可用，无法启动（使用轮询模式）');
      return false;
    }
    try {
      await this.watcher.start();
      this.logger.info('TraeBridgeWatcher 已启动，pollResponse 切换到事件驱动模式');
      return true;
    } catch (error) {
      this.logger.warn(`启动 TraeBridgeWatcher 失败，回退到轮询模式: ${String(error)}`);
      this.watcher = null;
      return false;
    }
  }

  /** 停止文件监听器（仅停止本实例管理的；外部注入的不归本实例管理） */
  async stopWatcher(): Promise<void> {
    if (this.watcher === null || !this.watcher.started) {
      return;
    }
    if (!this.watcherOwned) {
      return;
    }
    try {
      await this.watcher.stop();
      this.logger.info('TraeBridgeWatcher 已停止');
    } catch (error) {
      this.logger.warn(`停止 TraeBridgeWatcher 异常: ${String(error)}`);
    }
  }
}

/** 归档时间戳格式 {YYYYMMDD_HHMMSS}（UTC） */
function formatArchiveTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** 目录可写性预检（供 health_check_on_init 使用，不抛错只返回布尔） */
export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir);
    return true;
  } catch {
    return false;
  }
}
