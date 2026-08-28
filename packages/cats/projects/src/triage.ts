/**
 * @flowforge/cats-projects — triage 纯函数（F076 Stage 2）。
 *
 * TS 移植自 clowder-ai `domains/projects/intent-card-store.ts#computeBucket`：
 * A-tag 硬门控（AI 推断卡片不得进入 build_now）+ 5 维评分映射五桶。
 *
 * @module @flowforge/cats-projects/triage
 */

import type { ResolutionPath, SourceTag, TriageBucket, TriageIntentCardInput } from './types.js';

/** Triage 桶决策：桶 + Stage 3 澄清路径。 */
export interface TriageBucketDecision {
  readonly bucket: TriageBucket;
  readonly resolutionPath: ResolutionPath;
}

/**
 * 计算 Intent Card 的 triage 桶。
 *
 * 规则（顺序敏感）：
 * 1. A-tag 硬门控 → validate_first / evidence（AI 推断无证据，必须验证）；
 * 2. 5 维全达标（clarity/groundedness/necessity ≥ 2、coupling ≤ 2、size S|M）→ build_now；
 * 3. necessity ≥ 2 但 clarity < 2 → clarify_first / confirmation；
 * 4. clarity ≥ 2 但 groundedness < 2 → validate_first / evidence；
 * 5. clarity+groundedness ≥ 2 但 necessity < 2 → challenge / escalation；
 * 6. 其余 → later。
 */
export function computeBucket(
  scores: TriageIntentCardInput,
  sourceTag: SourceTag,
): TriageBucketDecision {
  // Hard gate: A-tagged cards cannot enter build_now
  if (sourceTag === 'A') {
    return { bucket: 'validate_first', resolutionPath: 'evidence' };
  }

  const { clarity, groundedness, necessity, coupling, sizeBand } = scores;

  if (clarity >= 2 && groundedness >= 2 && necessity >= 2 && coupling <= 2 && (sizeBand === 'S' || sizeBand === 'M')) {
    return { bucket: 'build_now', resolutionPath: null };
  }

  if (necessity >= 2 && clarity < 2) {
    return { bucket: 'clarify_first', resolutionPath: 'confirmation' };
  }

  if (clarity >= 2 && groundedness < 2) {
    return { bucket: 'validate_first', resolutionPath: 'evidence' };
  }

  if (clarity >= 2 && groundedness >= 2 && necessity < 2) {
    return { bucket: 'challenge', resolutionPath: 'escalation' };
  }

  return { bucket: 'later', resolutionPath: null };
}
