/**
 * In-memory client RPC 调用器（D42 client-runtime 移植）。
 *
 * 与 @flowforge/client-connection 的 ClientConnectionRpc 同构的 client 侧：
 * call(channel, endpoint, payload, signal) → RpcOutcome。进程内直接打到
 * MemoryHostConnection.dispatch，无传输层。供测试扮演浏览器/远端 client。
 */

import type { MemoryHostConnection, RpcOutcome } from './host.ts';

export interface ClientRuntimeCallOptions {
  channel: string;
  endpoint: string;
  payload?: unknown;
  signal?: AbortSignal;
}

/** 进程内 client：直接对 host dispatch 发起调用。 */
export class MemoryClientRpc {
  constructor(private readonly host: MemoryHostConnection) {}

  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcOutcome<unknown>> {
    return this.host.dispatch(channel, endpoint, payload, signal);
  }

  /** 便捷封装（含可取消）。 */
  request(options: ClientRuntimeCallOptions): Promise<RpcOutcome<unknown>> {
    return this.host.dispatch(options.channel, options.endpoint, options.payload, options.signal);
  }
}
