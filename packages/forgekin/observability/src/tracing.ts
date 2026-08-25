/**
 * @flowforge/forgekin-observability — T7.12 追踪基础：trace_id 全链路传播 + TraceLogger。
 *
 * TS 重写自 `core/tracing.py`：
 *   - trace_id 用 AsyncLocalStorage 传播（对齐 Python ContextVar 语义：异步上下文隔离）
 *   - TraceLogger 输出带 [trace_id=...] 前缀，供日志链路串联
 *   - Python 侧的 logging 文件/控制台 handler 基础设施由宿主环境承担，此处保留
 *     核心价值（链路 id 传播 + 结构化日志接口），不重复造日志系统
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const traceStorage = new AsyncLocalStorage<string>();

/**
 * 生成新的 trace_id（UUID）。
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * 在当前异步上下文设置 trace_id（返回设置后的值）。
 *
 * @param traceId 缺省时自动生成。
 */
export function setTraceId(traceId?: string): string {
  const tid = traceId ?? generateTraceId();
  traceStorage.enterWith(tid);
  return tid;
}

/**
 * 读取当前异步上下文的 trace_id（未设置时返回 'unknown'）。
 */
export function getTraceId(): string {
  return traceStorage.getStore() ?? 'unknown';
}

/**
 * 在指定 trace_id 上下文中执行异步函数（用于恢复/传递外部链路 id）。
 */
export async function withTraceId<T>(
  traceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(traceId, fn);
}

/**
 * 轻量 TraceLogger — 对齐 Python TraceLogger 的 info/warning/error/debug/exception
 * 接口，输出带 [trace_id=...] 便于全链路串联。
 */
export class TraceLogger {
  constructor(private readonly name: string) {}

  private log(level: string, msg: string, args: unknown[]): void {
    const prefix = `[${level.toUpperCase()}] ${this.name}: [trace_id=${getTraceId()}] ${msg}`;
    const fn =
      level === 'error' || level === 'warning' ? console.error
      : level === 'debug' ? console.debug
      : console.info;
    fn(prefix, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log('info', msg, args);
  }

  warning(msg: string, ...args: unknown[]): void {
    this.log('warning', msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log('error', msg, args);
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log('debug', msg, args);
  }

  /** 记录异常（等价 error，语义对齐 Python exception()）。 */
  exception(msg: string, ...args: unknown[]): void {
    this.log('error', msg, args);
  }
}

/** 获取指定名字的 TraceLogger（对齐 Python get_logger）。 */
export function getLogger(name: string): TraceLogger {
  return new TraceLogger(name);
}
