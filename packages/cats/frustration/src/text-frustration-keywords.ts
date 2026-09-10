/**
 * F222 Phase B: Text frustration keyword detection（迁移自 clowder-ai 同名文件）。
 */

export const FRUSTRATION_KEYWORDS = ['不对', '错了', '怎么回事', '又来了', '什么情况', '搞什么', '没用', '还是不行'];

export const TEXT_FRUSTRATION_THRESHOLD = 2;

export const TEXT_FRUSTRATION_WINDOW = 5;

export interface TextFrustrationResult {
  matched: boolean;
  matchedKeywords: string[];
  matchCount: number;
}

export function detectTextFrustration(
  userMessages: string[],
  keywords: string[] = FRUSTRATION_KEYWORDS,
): TextFrustrationResult {
  const window = userMessages.slice(-TEXT_FRUSTRATION_WINDOW);

  const allMatchedKeywords = new Set<string>();
  let matchCount = 0;

  for (const msg of window) {
    const msgMatches = keywords.filter((kw) => msg.includes(kw));
    if (msgMatches.length > 0) {
      matchCount++;
      for (const kw of msgMatches) allMatchedKeywords.add(kw);
    }
  }

  return {
    matched: matchCount >= TEXT_FRUSTRATION_THRESHOLD,
    matchedKeywords: [...allMatchedKeywords],
    matchCount,
  };
}