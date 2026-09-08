/**
 * 本地确定性 token 估算（近似 BPE，供会议产物续页预算使用）。
 *
 * clowder-ai 原实现依赖 js-tiktoken 的 cl100k_base；为避免重依赖，
 * 本包以单调、可测的本地近似实现 `estimateTokens`。它刻意是**近似**：
 * 在 `meeting-artifact-read-budget.ts` 中只用于在 maxChars 与 maxTokens
 * 之间二分选择整页，绝不作为精确计费依据（文档已标注为本地近似）。
 *
 * 单调性保证：字符数增加 ⇒ 估算 token 数不减（逐字符累加）。
 *
 * @flowforge/cats-signal-intake — extract/token-estimate
 */

const ASCII_BYTE_TOKENS = 0.27
const NON_ASCII_CHAR_TOKENS = 1.2
const CONTROL_TOKEN = 1

/**
 * Estimate a monotone token count for a text string.
 * Returns 0 for empty/falsy input.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let tokens = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) {
      tokens += CONTROL_TOKEN
    } else if (code < 0x80) {
      tokens += ASCII_BYTE_TOKENS
    } else {
      tokens += NON_ASCII_CHAR_TOKENS
    }
  }
  return Math.ceil(tokens)
}