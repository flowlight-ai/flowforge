/**
 * @flowforge/cats-guides — GuideDismissTracker（B-6，clowder GuideDismissTracker.ts 直译）。
 *
 * 记录用户对某 guide 的显式 dismiss（offer 阶段取消），阻止 bootcamp 桥自动 re-offer。
 * 运行期仅内存（重启即清空，对齐 clowder InMemory 实现语义）。
 *
 * @module @flowforge/cats-guides/dismiss-tracker
 */

/** Port 接口：按 user+guide 查询 dismiss 计数。 */
export interface IGuideDismissTracker {
  getDismissCounts(userId: string, guideIds: string[]): Promise<Record<string, number>>;
  incrementDismiss(userId: string, guideId: string): Promise<void>;
}

/** 内存实现：key = `${userId}:${guideId}`。 */
export class InMemoryGuideDismissTracker implements IGuideDismissTracker {
  private readonly counts = new Map<string, number>();

  async getDismissCounts(userId: string, guideIds: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const guideId of guideIds) {
      result[guideId] = this.counts.get(`${userId}:${guideId}`) ?? 0;
    }
    return result;
  }

  async incrementDismiss(userId: string, guideId: string): Promise<void> {
    const key = `${userId}:${guideId}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
}
