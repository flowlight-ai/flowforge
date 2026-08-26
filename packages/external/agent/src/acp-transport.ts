/**
 * @flowforge/external-agent acp-transport — ACP 统一传输层（F241 CL-016）。
 *
 * TS 重写自 flowforge/core/external_agent/acp_transport.py：
 *   - ACPMessage: message_id / provider / method / params / timestamp
 *   - ACPResponse: 响应封装
 *   - TransportBackend Protocol: sendAndReceive / stream
 *   - ACPTransport: call（失败抛 RuntimeError 语义）/ stream /
 *     _genMessageId = {provider}-{method}-{ts}
 */

/** ACP 消息（acp_transport.py ACPMessage）。 */
export interface ACPMessage {
  /** 消息 ID（格式 {provider}-{method}-{ts}）。 */
  readonly message_id: string;
  /** Provider 名称。 */
  readonly provider: string;
  /** 方法名。 */
  readonly method: string;
  /** 参数。 */
  readonly params: Record<string, unknown>;
  /** 时间戳（ISO 8601）。 */
  readonly timestamp: string;
}

/** ACP 响应（acp_transport.py ACPResponse）。 */
export interface ACPResponse {
  /** 消息 ID（与请求对应）。 */
  readonly message_id: string;
  /** 是否成功。 */
  readonly success: boolean;
  /** 结果（成功时）。 */
  readonly result?: unknown;
  /** 错误信息（失败时）。 */
  readonly error?: string;
}

/** 传输后端协议（acp_transport.py TransportBackend）。 */
export interface TransportBackend {
  /** 发送并接收响应（失败抛错）。 */
  sendAndReceive(
    provider: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<ACPResponse>;
  /** 流式传输。 */
  stream(
    provider: string,
    method: string,
    params: Record<string, unknown>,
  ): AsyncIterable<string>;
}

/** 内存传输后端（测试/参考用：可预置响应）。 */
export class InMemoryTransportBackend implements TransportBackend {
  /** 预置响应队列（provider:method -> 响应）。 */
  private readonly _responses = new Map<string, ACPResponse[]>();

  /** 预置一个响应（后续 call 依次弹出）。 */
  enqueueResponse(provider: string, method: string, response: ACPResponse): void {
    const key = `${provider}:${method}`;
    const queue = this._responses.get(key) ?? [];
    queue.push(response);
    this._responses.set(key, queue);
  }

  async sendAndReceive(
    provider: string,
    method: string,
    _params: Record<string, unknown>,
  ): Promise<ACPResponse> {
    const key = `${provider}:${method}`;
    const queue = this._responses.get(key) ?? [];
    const response = queue.shift();
    if (!response) {
      throw new Error(`InMemoryTransportBackend: no response for ${key}`);
    }
    return response;
  }

  async *stream(
    provider: string,
    method: string,
    _params: Record<string, unknown>,
  ): AsyncIterable<string> {
    yield `[acp:${provider}:${method}] chunk`;
  }
}

/** ACP 统一传输层（acp_transport.py ACPTransport）。 */
export class ACPTransport {
  private readonly _backend: TransportBackend;

  constructor(backend: TransportBackend) {
    this._backend = backend;
  }

  /**
   * 调用三方 Agent（acp_transport.py call）。
   *
   * @throws {Error} 后端失败或响应 success=false 时（RuntimeError 语义）。
   */
  async call(
    provider: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this._backend.sendAndReceive(provider, method, params);
    if (!response.success) {
      throw new Error(
        `ACP call failed: ${provider}.${method} — ${response.error ?? 'unknown error'}`,
      );
    }
    return {
      message_id: response.message_id,
      result: response.result,
    };
  }

  /** 流式调用（acp_transport.py stream）。 */
  async *stream(
    provider: string,
    method: string,
    params: Record<string, unknown>,
  ): AsyncIterable<string> {
    yield* this._backend.stream(provider, method, params);
  }

  /** 生成消息 ID（acp_transport.py _gen_message_id）。 */
  static genMessageId(provider: string, method: string): string {
    return `${provider}-${method}-${Date.now()}`;
  }
}
