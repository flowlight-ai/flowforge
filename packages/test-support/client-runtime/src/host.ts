/**
 * In-memory host RPC runtime（D42 client-runtime 移植）。
 *
 * 与 @flowforge/client-connection 导出的 HostConnectionRpc /
 * ConnectionRpcHandler 契约**结构同构**的本地实现（避免把整个 client-connection
 * → host-apiproxy → schemastery 依赖图拖入测试支撑包）：
 * handle() 注册逻辑通道，intercept() 抢占 /api 共享通道端点，dispatch() 把
 * client.call 送达 handler，异常折叠为 RpcResult 错误分支。无 socket/HTTP ——
 * 供测试在进程内驱动 host 端点。
 */

export type ConnectionRpcAuthority = 'trusted-host' | 'loopback';

export interface RpcResult<T> {
  ok: true;
  value: T;
}

export interface RpcErrorResult {
  ok: false;
  error: { code: 'internal'; message: string; details: Record<string, never> };
}

export type RpcOutcome<T> = RpcResult<T> | RpcErrorResult;

/** Handler invoked after the transport envelope is decoded. */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcOutcome<unknown>>;

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean;

export interface ConnectionRpcHandlerOptions {
  readonly authority: ConnectionRpcAuthority;
}

/** Fold any thrown value into the error branch (unified error API). */
export function transportError<T>(error: unknown): RpcOutcome<T> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

export interface ChannelRoute {
  channel: string;
  handler: ConnectionRpcHandler;
  authority: ConnectionRpcAuthority;
}

export interface ApiInterceptor extends Omit<ChannelRoute, 'channel'> {
  matches: ConnectionRpcEndpointMatcher;
  sequence: number;
}

/** In-memory host RPC：handle/intercept + 进程内 dispatch。 */
export class MemoryHostConnection {
  private readonly channels = new Map<string, ChannelRoute>();
  private readonly interceptors: ApiInterceptor[] = [];
  private nextInterceptorSequence = 0;

  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): Promise<() => Promise<void>> {
    if (!channel.startsWith('/')) {
      return Promise.reject(new Error(`MemoryHostConnection.handle: channel must start with "/", got "${channel}"`));
    }
    if (this.channels.has(channel)) {
      return Promise.reject(new Error(`MemoryHostConnection.handle: channel "${channel}" already registered`));
    }
    this.channels.set(channel, { channel, handler, authority: options.authority });
    return Promise.resolve(async () => {
      this.channels.delete(channel);
    });
  }

  intercept(
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): Promise<() => Promise<void>> {
    if (channel !== '/api') {
      return Promise.reject(
        new Error(
          `MemoryHostConnection.intercept: only the "/api" shared channel supports intercept, got "${channel}"`,
        ),
      );
    }
    const entry: ApiInterceptor = {
      matches,
      handler,
      authority: options.authority,
      sequence: this.nextInterceptorSequence++,
    };
    this.interceptors.push(entry);
    return Promise.resolve(async () => {
      const index = this.interceptors.indexOf(entry);
      if (index >= 0) this.interceptors.splice(index, 1);
    });
  }

  /** 进程内路由：客户端调用入口。 */
  async dispatch(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcOutcome<unknown>> {
    const abortSignal = signal ?? new AbortController().signal;
    try {
      if (channel === '/api') {
        const interceptor = [...this.interceptors]
          .reverse()
          .find((candidate) => candidate.matches(endpoint));
        if (interceptor) return await interceptor.handler(endpoint, payload, abortSignal);
      }
      const route = this.channels.get(channel);
      if (!route) {
        return {
          ok: false,
          error: {
            code: 'internal',
            message: `no channel "${channel}" registered on this host runtime`,
            details: {},
          },
        };
      }
      return await route.handler(endpoint, payload, abortSignal);
    } catch (error) {
      return transportError(error);
    }
  }
}
