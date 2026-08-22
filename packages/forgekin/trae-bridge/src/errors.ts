/**
 * Trae 桥接异常定义 — F045 §3.1 协议层骨架（TS 移植自 `llm/trae/exceptions.py`）.
 *
 * 异常层次：
 *   TraeBridgeError（基类）
 *   ├── TraeBridgeTimeoutError    — 超时（不变量 3）
 *   ├── TraeBridgeCancelledError  — operator 取消（不变量 8 逃生舱）
 *   ├── TraeBridgeProtocolError   — 协议层错误（文件格式/解析）
 *   ├── TraeBridgeIOError         — 文件 I/O 错误
 *   └── TraeBridgeConfigError     — 配置错误
 *
 * 向后兼容：保留旧别名（TraeLLMError / TraeLLMTimeoutError 等）。
 */

export interface TraeBridgeErrorOptions {
  /** 关联的请求 ID（UUID4），可用于排查归档文件 */
  readonly requestId?: string | undefined;
  /** 桥接模式（bridge/cli/api），向后兼容 */
  readonly mode?: string | undefined;
  /** 任务 ID，向后兼容（等于 requestId） */
  readonly taskId?: string | undefined;
}

export class TraeBridgeError extends Error {
  /** 关联的请求 ID（requestId 缺省时回退 taskId） */
  readonly requestId: string;
  /** 桥接模式（向后兼容） */
  readonly mode: string;
  /** 任务 ID（向后兼容，等于 requestId） */
  readonly taskId: string;

  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message);
    this.name = 'TraeBridgeError';
    const requestId = options.requestId || options.taskId || '';
    this.requestId = requestId;
    this.mode = options.mode ?? '';
    this.taskId = requestId;
  }
}

/** 桥接超时 — F045 §2.3 不变量 3（operator 未在 timeout 秒内回写 response） */
export class TraeBridgeTimeoutError extends TraeBridgeError {
  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message, options);
    this.name = 'TraeBridgeTimeoutError';
  }
}

/** operator 主动取消 — F045 §2.3 不变量 8（逃生舱，cancel_{uuid}.json） */
export class TraeBridgeCancelledError extends TraeBridgeError {
  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message, options);
    this.name = 'TraeBridgeCancelledError';
  }
}

/** 协议层错误 — 文件格式/字段缺失/状态非法 */
export class TraeBridgeProtocolError extends TraeBridgeError {
  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message, options);
    this.name = 'TraeBridgeProtocolError';
  }
}

/** 文件 I/O 错误 — 目录创建/读写失败 */
export class TraeBridgeIOError extends TraeBridgeError {
  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message, options);
    this.name = 'TraeBridgeIOError';
  }
}

/** 配置错误 — 路径/参数非法 */
export class TraeBridgeConfigError extends TraeBridgeError {
  constructor(message: string, options: TraeBridgeErrorOptions = {}) {
    super(message, options);
    this.name = 'TraeBridgeConfigError';
  }
}

// ── 向后兼容别名（旧 TraeLLMError API）─────────────────────────────
export const TraeLLMError = TraeBridgeError;
export const TraeLLMTimeoutError = TraeBridgeTimeoutError;
export const TraeLLMCliError = TraeBridgeError; // CLI 模式未实现，归一到基类
export const TraeLLMApiError = TraeBridgeError; // API 模式未实现，归一到基类
