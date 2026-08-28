/**
 * @flowforge/cats-projects — execution digest store（F070 Phase 3）。
 *
 * TS 移植自 clowder-ai `domains/projects/execution-digest-store.ts`：
 * dispatch 执行摘要的内存存储，按 project / thread / user 倒序查询。
 *
 * @module @flowforge/cats-projects/execution-digest-store
 */

import type { DispatchExecutionDigest } from './types.js';
import { generateSortableId } from './types.js';

export type CreateDigestInput = Omit<DispatchExecutionDigest, 'id'>;

/** F070 Phase 3: dispatch 执行摘要内存存储（持久实现由宿主按需注入）。 */
export class ExecutionDigestStore {
  private readonly digests = new Map<string, DispatchExecutionDigest>();

  create(input: CreateDigestInput): DispatchExecutionDigest {
    const digest: DispatchExecutionDigest = {
      ...input,
      id: `ed-${generateSortableId(input.completedAt)}`,
    };
    this.digests.set(digest.id, digest);
    return digest;
  }

  getById(id: string): DispatchExecutionDigest | undefined {
    return this.digests.get(id);
  }

  listByProject(projectPath: string, userId: string): DispatchExecutionDigest[] {
    return [...this.digests.values()]
      .filter((d) => d.projectPath === projectPath && d.userId === userId)
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  listByThread(threadId: string, userId: string): DispatchExecutionDigest[] {
    return [...this.digests.values()]
      .filter((d) => d.threadId === threadId && d.userId === userId)
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  listAll(userId: string): DispatchExecutionDigest[] {
    return [...this.digests.values()].filter((d) => d.userId === userId).sort((a, b) => b.completedAt - a.completedAt);
  }
}
