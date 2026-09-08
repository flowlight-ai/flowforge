/**
 * 活跃会话存储 seam（替代 dsh 的 `SessionStore` 注入）及其真实内存实现。
 *
 * 导出流程在读取每个（可能）存活会话的日志前，需要先穿越该会话的持久化屏障
 * 使内存中尚未落盘的事件变为持久。冷会话（从未加载进内存）没有可刷写的工作。
 * `MemoryLiveSessionStore` 是可供契约测试使用的真实实现，并记录每次刷写。
 */

/** 一个可被刷写的活跃会话。对导出流程而言只需 id 与是否存在内存工作。 */
export interface LiveSession {
  readonly id: string
}

/**
 * 活跃会话存取 seam：按 id 取回会话（可能在内存、可能已冷），并将单个会话
 * 刷写持久。
 */
export interface LiveSessionStoreSeam {
  get(id: string): LiveSession | undefined
  flush(session: LiveSession): Promise<void>
}

/**
 * 真实内存活跃会话存储：登记一批会话，`get` 返回已登记项，`flush` 记录刷写
 * 轨迹（供断言屏障是否被正确穿越）。
 */
export class MemoryLiveSessionStore implements LiveSessionStoreSeam {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly flushedIds: string[] = []

  /** 登记一个会话，使其对 `get` 可见。 */
  register(session: LiveSession): void {
    this.sessions.set(session.id, session)
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  async flush(session: LiveSession): Promise<void> {
    this.flushedIds.push(session.id)
  }

  /** 按刷写顺序记录的所有会话 id（用于断言持久化屏障被穿越）。 */
  get flushed(): readonly string[] {
    return this.flushedIds
  }
}