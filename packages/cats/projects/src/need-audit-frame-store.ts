/**
 * @flowforge/cats-projects — need audit frame store（F076，每项目一帧）。
 *
 * TS 移植自 clowder-ai `domains/projects/need-audit-frame-store.ts`：
 * sponsor / successMetric 必填校验 + 按 projectId 单帧 upsert。
 *
 * @module @flowforge/cats-projects/need-audit-frame-store
 */

import type { CreateNeedAuditFrameInput, NeedAuditFrame } from './types.js';
import { generateSortableId } from './types.js';

/** F076 Need Audit Frame 内存存储（每项目一帧，upsert 语义）。 */
export class NeedAuditFrameStore {
  private readonly frames = new Map<string, NeedAuditFrame>();

  upsert(projectId: string, input: CreateNeedAuditFrameInput): NeedAuditFrame {
    if (!input.sponsor) {
      throw new Error('sponsor is required');
    }
    if (!input.successMetric) {
      throw new Error('successMetric is required');
    }

    const existing = this.getByProject(projectId);
    const now = Date.now();

    if (existing) {
      const updated: NeedAuditFrame = {
        ...existing,
        ...input,
        updatedAt: now,
      };
      this.frames.set(projectId, updated);
      return updated;
    }

    const frame: NeedAuditFrame = {
      id: `frame-${generateSortableId(now)}`,
      projectId,
      sponsor: input.sponsor,
      motivation: input.motivation,
      successMetric: input.successMetric,
      constraints: input.constraints,
      currentWorkflow: input.currentWorkflow,
      provenanceMap: input.provenanceMap,
      createdAt: now,
      updatedAt: now,
    };
    this.frames.set(projectId, frame);
    return frame;
  }

  getByProject(projectId: string): NeedAuditFrame | null {
    return this.frames.get(projectId) ?? null;
  }
}
