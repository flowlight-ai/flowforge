/**
 * Discussion Summary Types (拍立得照片墙)
 * 猫猫讨论纪要 — 记录讨论的结论和待解决问题
 */

import type { CatId } from './ids.ts';

export interface ThreadSummary {
  readonly id: string;
  readonly threadId: string;
  readonly topic: string;
  readonly conclusions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly createdAt: number;
  readonly createdBy: CatId | 'user' | 'system';
}

export type CreateSummaryInput = {
  threadId: string;
  topic: string;
  conclusions: readonly string[];
  openQuestions: readonly string[];
  createdBy: CatId | 'user' | 'system';
};
