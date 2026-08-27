/**
 * @flowforge/cats-taste — Taste 信号路由建议守卫（F221 Phase B）。
 *
 * TS 移植自 clowder-ai `domains/taste/services/taste-routing-guard.ts`（原样保留）：
 * 在 propose_profile_update 内容中检测品味信号关键词，返回路由建议
 * （建议改用 cat_cafe_propose_taste）。ADVISORY — 不阻止提案创建（KD-8）。
 *
 * @module @flowforge/cats-taste/taste-routing-guard
 */

export interface TasteRoutingAdvisory {
  suggestedTool: 'cat_cafe_propose_taste';
  reason: string;
}

const TASTE_KEYWORDS_ZH = [
  '品味',
  '审美',
  '太客服',
  '不美',
  '活人感',
  '脚手架',
  '第一性原理',
  '数学之美',
  '这就是我要的',
];
const TASTE_KEYWORDS_EN = ['aha', 'ai slop'];

export function detectTasteSignal(input: { rationale?: string; afterContent?: string }): TasteRoutingAdvisory | null {
  const corpus = `${input.rationale ?? ''} ${input.afterContent ?? ''}`.toLowerCase();
  if (corpus.trim().length === 0) return null;

  const matchZh = TASTE_KEYWORDS_ZH.find((kw) => corpus.includes(kw));
  const matchEn = TASTE_KEYWORDS_EN.find((kw) => corpus.includes(kw));
  const match = matchZh ?? matchEn;

  if (!match) return null;

  return {
    suggestedTool: 'cat_cafe_propose_taste',
    reason: `Content contains taste signal keyword "${match}". Consider using cat_cafe_propose_taste to capture this as a taste vignette instead of a profile update.`,
  };
}
