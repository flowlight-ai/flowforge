/**
 * @flowforge/cats-projects — resolution store（F076 Stage 3 澄清队列）。
 *
 * TS 移植自 clowder-ai `domains/projects/resolution-store.ts`：
 * open → answered / escalated 状态机 + 按项目/卡片查询。
 *
 * @module @flowforge/cats-projects/resolution-store
 */

import type { AnswerResolutionInput, CreateResolutionInput, ResolutionItem } from './types.js';
import { generateSortableId } from './types.js';

/** F076 Stage 3 澄清队列内存存储。 */
export class ResolutionStore {
  private readonly items = new Map<string, ResolutionItem>();

  create(projectId: string, input: CreateResolutionInput): ResolutionItem {
    const now = Date.now();
    const item: ResolutionItem = {
      id: `res-${generateSortableId(now)}`,
      projectId,
      cardId: input.cardId,
      path: input.path,
      question: input.question,
      options: input.options ? [...input.options] : [],
      recommendation: input.recommendation ?? '',
      status: 'open',
      answer: '',
      answeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return item;
  }

  listByProject(projectId: string): ResolutionItem[] {
    return [...this.items.values()].filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }

  listByCard(cardId: string): ResolutionItem[] {
    return [...this.items.values()].filter((r) => r.cardId === cardId).sort((a, b) => b.createdAt - a.createdAt);
  }

  getById(id: string): ResolutionItem | undefined {
    return this.items.get(id);
  }

  answer(id: string, input: AnswerResolutionInput): ResolutionItem | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated: ResolutionItem = {
      ...existing,
      answer: input.answer,
      status: 'answered',
      answeredAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.items.set(id, updated);
    return updated;
  }

  escalate(id: string): ResolutionItem | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated: ResolutionItem = {
      ...existing,
      status: 'escalated',
      updatedAt: Date.now(),
    };
    this.items.set(id, updated);
    return updated;
  }

  listOpen(projectId: string): ResolutionItem[] {
    return [...this.items.values()]
      .filter((r) => r.projectId === projectId && r.status === 'open')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}
