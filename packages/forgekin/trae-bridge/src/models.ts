/**
 * @flowforge/forgekin-trae-bridge — 数据模型（TS 移植自 `llm/trae/models.py`）
 *
 * F045 §2.2 桥接协议数据结构：
 *   - BridgeRequest:  Forgekin → Trae 的请求文件 (request_{uuid}.json)
 *   - BridgeResponse: Trae → Forgekin 的响应文件 (response_{uuid}.json)
 *   - BridgeCancel:   operator 取消请求 (cancel_{uuid}.json) — 不变量 8 逃生舱
 *   - BridgeAck:      operator 确认收到请求 (ack_{uuid}.json)
 *   - BridgeStatus:   桥接状态总览 (status.json)
 *
 * 注意：接口字段保持 snake_case——这些结构是 F045 文件协议的线缆格式，
 * 与 Python 端 operator（`llm/trae/bridge_operator.py`）跨进程共享，
 * 字段名必须与 JSON 文件一一对应（不变量 1/2/7 依赖字段名配对）。
 */

/** 工厂入参辅助类型：全部可选且显式允许 undefined（exactOptionalPropertyTypes） */
type PartialWithUndefined<T> = { [K in keyof T]?: T[K] | undefined };

// ──────────────────────────────────────────────────────────────────
// 枚举定义
// ──────────────────────────────────────────────────────────────────

/** 请求文件状态（Forgekin 写入后到收到响应前的状态机） */
export const BridgeRequestStatus = {
  /** 刚写入，等待 operator 处理 */
  PENDING: 'pending',
  /** operator 已确认收到（ack 文件存在） */
  ACKED: 'acked',
  /** operator 正在调用 LLM */
  PROCESSING: 'processing',
  /** 已收到响应（response 文件存在） */
  COMPLETED: 'completed',
  /** 超时未收到响应 */
  TIMEOUT: 'timeout',
  /** operator 主动取消 */
  CANCELLED: 'cancelled',
} as const;

export type BridgeRequestStatus = (typeof BridgeRequestStatus)[keyof typeof BridgeRequestStatus];

/** 响应文件状态（operator 写入 response 文件时标记） */
export const BridgeResponseStatus = {
  /** 正常完成 */
  COMPLETED: 'completed',
  /** LLM 调用失败 */
  ERROR: 'error',
  /** 流式响应的部分片段（预留） */
  PARTIAL: 'partial',
  /** LLM 调用超时 */
  TIMEOUT: 'timeout',
} as const;

export type BridgeResponseStatus = (typeof BridgeResponseStatus)[keyof typeof BridgeResponseStatus];

export function isBridgeRequestStatus(value: string): value is BridgeRequestStatus {
  return Object.values(BridgeRequestStatus).includes(value as BridgeRequestStatus);
}

export function isBridgeResponseStatus(value: string): value is BridgeResponseStatus {
  return Object.values(BridgeResponseStatus).includes(value as BridgeResponseStatus);
}

// ──────────────────────────────────────────────────────────────────
// 核心模型
// ──────────────────────────────────────────────────────────────────

/** OpenAI 兼容的消息结构（role 仅限 system | user | assistant） */
export interface BridgeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const VALID_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);

/** 校验消息结构（对齐 Pydantic BridgeMessage：role 正则 ^(system|user|assistant)$） */
export function validateBridgeMessage(value: unknown): BridgeMessage {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`消息格式非法（必须是对象）: ${String(value)}`);
  }
  const record = value as Record<string, unknown>;
  const role = record['role'];
  const content = record['content'];
  if (typeof role !== 'string' || !VALID_MESSAGE_ROLES.has(role)) {
    throw new TypeError(`消息格式非法（role 必须是 system/user/assistant）: ${String(role)}`);
  }
  if (typeof content !== 'string') {
    throw new TypeError(`消息格式非法（content 必须是字符串）: ${String(content)}`);
  }
  return { role: role as BridgeMessage['role'], content };
}

/** 请求上下文 — F045 §2.3 不变量 7（operator 可见性）；允许扩展字段（extra="allow"） */
export interface BridgeRequestContext {
  /** 发起请求的可进化智能体 ID（如 forgemind:luban），必填非空 */
  forgekin_id: string;
  /** 任务类型：chat | complete_code | review_code | generate_tests | write_doc */
  task_type: string;
  /** 任务摘要（一句话，operator 快速浏览用） */
  task_summary: string;
  /** 期望模型名 */
  model: string;
  /** 采样温度（0.0-2.0） */
  temperature: number;
  /** 最大 token 数（≥1） */
  max_tokens: number;
  /** 可选工具定义（OpenAI function-calling 格式） */
  tools: Record<string, unknown>[] | null;
  /** 扩展字段（extra="allow"） */
  [key: string]: unknown;
}

export interface BridgeRequestContextInit {
  forgekin_id: string;
  task_type?: string | undefined;
  task_summary?: string | undefined;
  model?: string | undefined;
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  tools?: Record<string, unknown>[] | null | undefined;
}

/** 创建 BridgeRequestContext（forgekin_id 必填非空，对齐 Pydantic min_length=1） */
export function makeBridgeRequestContext(init: BridgeRequestContextInit): BridgeRequestContext {
  if (!init.forgekin_id || init.forgekin_id.length < 1) {
    throw new TypeError('forgekin_id 不能为空');
  }
  const temperature = init.temperature ?? 0.7;
  if (!(temperature >= 0.0 && temperature <= 2.0)) {
    throw new TypeError(`temperature 必须在 [0, 2] 区间，得到: ${temperature}`);
  }
  const maxTokens = init.max_tokens ?? 4096;
  if (!(maxTokens >= 1)) {
    throw new TypeError(`max_tokens 必须 ≥1，得到: ${maxTokens}`);
  }
  return {
    forgekin_id: init.forgekin_id,
    task_type: init.task_type ?? 'chat',
    task_summary: init.task_summary ?? '',
    model: init.model ?? 'trae',
    temperature,
    max_tokens: maxTokens,
    tools: init.tools ?? null,
  };
}

/** 请求文件 request_{uuid}.json 的模型（F045 §2.1 协议流程步骤 2） */
export interface BridgeRequest {
  /** UUID4 请求 ID，与文件名中的 {uuid} 一致（不变量 1） */
  request_id: string;
  /** 会话 ID（可选，用于保持上下文） */
  session_id: string;
  /** 消息列表（OpenAI 兼容格式，至少 1 条） */
  messages: BridgeMessage[];
  /** 请求上下文（不变量 7 operator 可见性） */
  context: BridgeRequestContext;
  /** 本次请求的超时秒数（不变量 3） */
  timeout_seconds: number;
  /** 创建时间（ISO 8601 UTC） */
  created_at: string;
  /** 请求状态 */
  status: BridgeRequestStatus;
}

export type BridgeRequestInit = Pick<BridgeRequest, 'request_id' | 'messages' | 'context'> &
  PartialWithUndefined<Omit<BridgeRequest, 'request_id' | 'messages' | 'context'>>;

/** 创建 BridgeRequest（created_at 默认 now，status 默认 pending，messages 至少 1 条） */
export function makeBridgeRequest(init: BridgeRequestInit): BridgeRequest {
  if (!init.request_id || init.request_id.length < 1) {
    throw new TypeError('request_id 不能为空');
  }
  if (init.messages.length < 1) {
    throw new TypeError('messages 不能为空');
  }
  const timeoutSeconds = init.timeout_seconds ?? 300;
  if (!(timeoutSeconds >= 1)) {
    throw new TypeError(`timeout_seconds 必须 ≥1，得到: ${timeoutSeconds}`);
  }
  return {
    request_id: init.request_id,
    session_id: init.session_id ?? '',
    messages: [...init.messages],
    context: init.context,
    timeout_seconds: timeoutSeconds,
    created_at: init.created_at ?? new Date().toISOString(),
    status: init.status ?? BridgeRequestStatus.PENDING,
  };
}

/** 响应文件 response_{uuid}.json 的模型（F045 §2.1 协议流程步骤 5；允许扩展字段） */
export interface BridgeResponse {
  /** 关联的请求 ID（不变量 2 请求-响应配对） */
  request_id: string;
  /** LLM 响应内容 */
  content: string;
  /** 响应状态 */
  status: BridgeResponseStatus;
  /** 实际使用的模型名 */
  model: string;
  /** token 用量等元信息 */
  usage: Record<string, unknown>;
  /** 工具调用列表 */
  tool_calls: Record<string, unknown>[] | null;
  /** 错误信息（status=error 时必填） */
  error: string;
  /** 完成时间（ISO 8601 UTC） */
  completed_at: string;
  /** 扩展字段（extra="allow"） */
  [key: string]: unknown;
}

/** 从文件 JSON 解析 BridgeResponse（校验字段，非法时抛错由调用方包装为 ProtocolError） */
export function parseBridgeResponse(data: unknown): BridgeResponse {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError('响应数据必须是 JSON 对象');
  }
  const record = data as Record<string, unknown>;
  const requestId = record['request_id'];
  if (typeof requestId !== 'string' || requestId.length < 1) {
    throw new TypeError('响应缺少 request_id 字段');
  }
  const status = record['status'];
  if (typeof status !== 'string' || !isBridgeResponseStatus(status)) {
    throw new TypeError(`响应 status 非法: ${String(status)}`);
  }
  const toolCalls = record['tool_calls'];
  return {
    ...record,
    request_id: requestId,
    content: typeof record['content'] === 'string' ? record['content'] : '',
    status,
    model: typeof record['model'] === 'string' ? record['model'] : 'trae',
    usage:
      typeof record['usage'] === 'object' && record['usage'] !== null
        ? (record['usage'] as Record<string, unknown>)
        : {},
    tool_calls: Array.isArray(toolCalls) ? (toolCalls as Record<string, unknown>[]) : null,
    error: typeof record['error'] === 'string' ? record['error'] : '',
    completed_at: typeof record['completed_at'] === 'string'
      ? record['completed_at']
      : new Date().toISOString(),
  };
}

/** 取消文件 cancel_{uuid}.json 的模型（不变量 8 逃生舱） */
export interface BridgeCancel {
  /** 要取消的请求 ID */
  request_id: string;
  /** 取消原因 */
  reason: string;
  /** 取消者（默认 operator） */
  cancelled_by: string;
  /** 取消时间（ISO 8601 UTC） */
  cancelled_at: string;
}

export type BridgeCancelInit = Pick<BridgeCancel, 'request_id'> &
  PartialWithUndefined<Omit<BridgeCancel, 'request_id'>>;

/** 创建 BridgeCancel（cancelled_at 默认 now，cancelled_by 默认 operator） */
export function makeBridgeCancel(init: BridgeCancelInit): BridgeCancel {
  return {
    request_id: init.request_id,
    reason: init.reason ?? '',
    cancelled_by: init.cancelled_by ?? 'operator',
    cancelled_at: init.cancelled_at ?? new Date().toISOString(),
  };
}

/** 从文件 JSON 解析 BridgeCancel（宽松解析：字段缺失时用默认值兜底） */
export function parseBridgeCancel(data: unknown, requestId: string): BridgeCancel {
  if (typeof data !== 'object' || data === null) {
    return makeBridgeCancel({ request_id: requestId });
  }
  const record = data as Record<string, unknown>;
  return {
    request_id: typeof record['request_id'] === 'string' ? record['request_id'] : requestId,
    reason: typeof record['reason'] === 'string' ? record['reason'] : '',
    cancelled_by: typeof record['cancelled_by'] === 'string' ? record['cancelled_by'] : 'operator',
    cancelled_at: typeof record['cancelled_at'] === 'string'
      ? record['cancelled_at']
      : new Date().toISOString(),
  };
}

/** 确认文件 ack_{uuid}.json 的模型（可选实现，用于检测 operator 是否在线） */
export interface BridgeAck {
  /** 关联的请求 ID */
  request_id: string;
  /** 确认者（默认 operator） */
  acked_by: string;
  /** 确认时间（ISO 8601 UTC） */
  acked_at: string;
}

export type BridgeAckInit = Pick<BridgeAck, 'request_id'> &
  PartialWithUndefined<Omit<BridgeAck, 'request_id'>>;

/** 创建 BridgeAck（acked_at 默认 now，acked_by 默认 operator） */
export function makeBridgeAck(init: BridgeAckInit): BridgeAck {
  return {
    request_id: init.request_id,
    acked_by: init.acked_by ?? 'operator',
    acked_at: init.acked_at ?? new Date().toISOString(),
  };
}

/** 桥接状态总览 status.json 的模型（不变量 7 operator 可见性） */
export interface BridgeStatus {
  /** 等待处理的请求数 */
  pending_count: number;
  /** 处理中的请求数 */
  processing_count: number;
  /** 累计完成数 */
  completed_total: number;
  /** 累计超时数 */
  timeout_total: number;
  /** 累计取消数 */
  cancelled_total: number;
  /** 最后活动时间（ISO 8601 UTC，无活动时为 null） */
  last_activity_at: string | null;
}

/** 创建 BridgeStatus（全零计数 + 无活动时间） */
export function makeBridgeStatus(init: PartialWithUndefined<BridgeStatus> = {}): BridgeStatus {
  return {
    pending_count: init.pending_count ?? 0,
    processing_count: init.processing_count ?? 0,
    completed_total: init.completed_total ?? 0,
    timeout_total: init.timeout_total ?? 0,
    cancelled_total: init.cancelled_total ?? 0,
    last_activity_at: init.last_activity_at ?? null,
  };
}

/** 从文件 JSON 解析 BridgeStatus（宽松解析：非法字段回退默认值） */
export function parseBridgeStatus(data: unknown): BridgeStatus {
  if (typeof data !== 'object' || data === null) {
    return makeBridgeStatus();
  }
  const record = data as Record<string, unknown>;
  const asCount = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  return {
    pending_count: asCount(record['pending_count']),
    processing_count: asCount(record['processing_count']),
    completed_total: asCount(record['completed_total']),
    timeout_total: asCount(record['timeout_total']),
    cancelled_total: asCount(record['cancelled_total']),
    last_activity_at: typeof record['last_activity_at'] === 'string'
      ? record['last_activity_at']
      : null,
  };
}
