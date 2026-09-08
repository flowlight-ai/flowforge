/**
 * Token estimation (self-contained).
 *
 * clowder uses js-tiktoken with cl100k_base. To keep this package free of that
 * runtime dependency, we approximate with a deterministic heuristic:
 *   - CJK / full-width-ish characters ≈ 1 token each (single-glyph-token languages)
 *   - continuation/ASCII runs ≈ chars/4 (≈ 4 chars/token, cl100k average)
 * This is monotonic and non-zero for non-empty input — sufficient for the
 * ContextAssembler budget walk and guard checks. Actual token counts come from
 * the CLI usage data at EP2 wiring time.
 */

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  let asciiRun = 0;
  const flush = () => {
    tokens += Math.ceil(asciiRun / 4);
    asciiRun = 0;
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      flush();
      tokens += 1;
    } else {
      asciiRun += 1;
    }
  }
  flush();
  return tokens;
}