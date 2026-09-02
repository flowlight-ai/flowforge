/**
 * @flowforge/client-runtime — client 运行态测试支撑（D42）。
 *
 * 阶段 3 client/host 域落地后补齐：提供与 @flowforge/client-connection
 * HostConnectionRpc / ConnectionRpcHandler 契**约结构同构**的进程内 host RPC
 * 路由（handle/intercept + dispatch）+ 同构 client 调用器，使测试无需
 * socket/HTTP 即可驱动 host 端点（round-trip / 拦截优先级 / 异常折叠 /
 * 取消 / disposer 移除）。
 *
 * @module @flowforge/client-runtime
 */

import { MemoryClientRpc } from './client.ts';
import { MemoryHostConnection } from './host.ts';

export {
  MemoryHostConnection,
  transportError,
  type ApiInterceptor,
  type ChannelRoute,
  type ConnectionRpcAuthority,
  type ConnectionRpcEndpointMatcher,
  type ConnectionRpcHandler,
  type ConnectionRpcHandlerOptions,
  type RpcErrorResult,
  type RpcOutcome,
  type RpcResult,
} from './host.ts';
export { MemoryClientRpc, type ClientRuntimeCallOptions } from './client.ts';

export interface ClientRuntimeBus {
  host: MemoryHostConnection;
  client: MemoryClientRpc;
}

/** 建立进程内 host↔client 运行态。 */
export function createClientRuntime(): ClientRuntimeBus {
  const host = new MemoryHostConnection();
  const client = new MemoryClientRpc(host);
  return { host, client };
}
