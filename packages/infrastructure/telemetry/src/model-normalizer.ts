/**
 * F152: 模型名归一化——有界指标基数（TS 移植自 clowder-ai `model-normalizer.ts`）。
 *
 * runtime-cat-catalog 的 defaultModel 是自由字符串——原始值作为 metric 属性
 * 会导致基数爆炸。本模块把模型名分桶到 provider+family 组。
 */

const MODEL_BUCKETS: ReadonlyArray<readonly [string, string]> = [
  ['claude-opus', 'claude-opus'],
  ['claude-sonnet', 'claude-sonnet'],
  ['claude-haiku', 'claude-haiku'],
  ['gpt-4o', 'gpt-4o'],
  ['gpt-4', 'gpt-4'],
  ['gpt-5', 'gpt-5'],
  ['o3', 'o3'],
  ['o4', 'o4'],
  ['gemini-2.5', 'gemini-2.5'],
  ['gemini-2.0', 'gemini-2.0'],
  ['qwen', 'qwen'],
];

/**
 * Normalize a raw model string into a bounded bucket.
 * Unknown models map to `'other'`.
 */
export function normalizeModel(raw: string): string {
  const lowered = raw.toLowerCase();
  for (const [prefix, bucket] of MODEL_BUCKETS) {
    if (lowered.includes(prefix)) return bucket;
  }
  return 'other';
}
