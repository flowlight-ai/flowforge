/**
 * @flowforge/cats-projects — reflux pattern store（F076 方法论经验沉淀）。
 *
 * TS 移植自 clowder-ai `domains/projects/reflux-pattern-store.ts`。
 *
 * @module @flowforge/cats-projects/reflux-pattern-store
 */

import type { CreateRefluxPatternInput, RefluxCategory, RefluxPattern } from './types.js';
import { generateSortableId } from './types.js';

/** F076 方法论经验内存存储（按项目 / 类别查询）。 */
export class RefluxPatternStore {
  private readonly patterns = new Map<string, RefluxPattern>();

  create(projectId: string, input: CreateRefluxPatternInput): RefluxPattern {
    const now = Date.now();
    const pattern: RefluxPattern = {
      id: `rfx-${generateSortableId(now)}`,
      projectId,
      category: input.category,
      title: input.title,
      insight: input.insight,
      evidence: input.evidence,
      createdAt: now,
    };
    this.patterns.set(pattern.id, pattern);
    return pattern;
  }

  listByProject(projectId: string): RefluxPattern[] {
    return [...this.patterns.values()]
      .filter((p) => p.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listByCategory(projectId: string, category: RefluxCategory): RefluxPattern[] {
    return this.listByProject(projectId).filter((p) => p.category === category);
  }

  getById(id: string): RefluxPattern | undefined {
    return this.patterns.get(id);
  }

  delete(id: string): boolean {
    return this.patterns.delete(id);
  }
}
