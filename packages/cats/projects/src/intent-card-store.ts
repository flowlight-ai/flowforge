/**
 * @flowforge/cats-projects — intent card store（F076 Stage 1-2）。
 *
 * TS 移植自 clowder-ai `domains/projects/intent-card-store.ts`：
 * Intent Card 内存存储 + triage 分桶（computeBucket 纯函数见 ./triage.js）。
 *
 * @module @flowforge/cats-projects/intent-card-store
 */

import type {
  CreateIntentCardInput,
  IntentCard,
  TriageBucket,
  TriageIntentCardInput,
  TriageResult,
} from './types.js';
import { generateSortableId } from './types.js';
import { computeBucket } from './triage.js';

export { computeBucket };
export type { TriageBucketDecision } from './triage.js';

/** F076 Intent Card 内存存储（Stage 1 创建 / Stage 2 triage）。 */
export class IntentCardStore {
  private readonly cards = new Map<string, IntentCard>();

  create(input: CreateIntentCardInput): IntentCard {
    const now = Date.now();
    const card: IntentCard = {
      id: `ic-${generateSortableId(now)}`,
      projectId: input.projectId,
      actor: input.actor,
      contextTrigger: input.contextTrigger,
      goal: input.goal,
      objectState: input.objectState,
      successSignal: input.successSignal,
      nonGoal: input.nonGoal,
      sourceTag: input.sourceTag,
      sourceDetail: input.sourceDetail,
      decisionOwner: input.decisionOwner,
      confidence: input.confidence,
      dependencyTags: input.dependencyTags ? [...input.dependencyTags] : [],
      riskSignals: input.riskSignals ? [...input.riskSignals] : [],
      triage: null,
      originalText: input.originalText,
      createdAt: now,
      updatedAt: now,
    };
    this.cards.set(card.id, card);
    return card;
  }

  listByProject(projectId: string, bucket?: TriageBucket): IntentCard[] {
    return [...this.cards.values()]
      .filter((c) => c.projectId === projectId)
      .filter((c) => (bucket ? c.triage?.bucket === bucket : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getById(id: string): IntentCard | null {
    return this.cards.get(id) ?? null;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        IntentCard,
        | 'actor'
        | 'contextTrigger'
        | 'goal'
        | 'objectState'
        | 'successSignal'
        | 'nonGoal'
        | 'sourceTag'
        | 'sourceDetail'
        | 'decisionOwner'
        | 'confidence'
        | 'dependencyTags'
        | 'riskSignals'
        | 'originalText'
      >
    >,
  ): IntentCard | null {
    const existing = this.cards.get(id);
    if (!existing) return null;
    const updated: IntentCard = { ...existing, ...patch, updatedAt: Date.now() };
    this.cards.set(id, updated);
    return updated;
  }

  triage(id: string, scores: TriageIntentCardInput): IntentCard | null {
    const existing = this.cards.get(id);
    if (!existing) return null;

    const { bucket, resolutionPath } = computeBucket(scores, existing.sourceTag);
    const triage: TriageResult = {
      clarity: scores.clarity,
      groundedness: scores.groundedness,
      necessity: scores.necessity,
      coupling: scores.coupling,
      sizeBand: scores.sizeBand,
      bucket,
      resolutionPath,
    };

    const updated: IntentCard = { ...existing, triage, updatedAt: Date.now() };
    this.cards.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.cards.delete(id);
  }
}
