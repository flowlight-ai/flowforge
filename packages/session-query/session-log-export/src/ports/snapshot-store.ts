/**
 * 快照存储端口 seam（对应 dsh 的 `createSnapshotStore`）及其真实内存实现。
 *
 * 下载状态机通过该端口读取最新快照并以不可变方式提交增量更新，契约测试直接
 * 使用 {@link MemorySnapshotStore}（铁律 T9，无 mock）。
 */

/**
 * 类 uSES 的无状态快照源：读取当前快照，或以回调就地修改后提交一次新快照。
 * 实现应保证 `getSnapshot` 稳定返回同一引用直到下一次 `update`。
 */
export interface SnapshotStorePort<S> {
  getSnapshot(): S
  update(fn: (state: S) => void): void
}

/**
 * 真实内存快照存储：每次 `update` 克隆草稿、执行变更后提交并通知订阅者。
 * 状态须可被 `structuredClone`（本包所有状态均为纯 JSON 对象）。
 */
export class MemorySnapshotStore<S> implements SnapshotStorePort<S> {
  private state: S
  private readonly listeners = new Set<() => void>()

  constructor(initial: S) {
    this.state = initial
  }

  getSnapshot(): S {
    return this.state
  }

  update(fn: (state: S) => void): void {
    const draft = structuredClone(this.state)
    fn(draft)
    this.state = draft
    for (const listener of this.listeners) listener()
  }

  /** 订阅快照更新；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}