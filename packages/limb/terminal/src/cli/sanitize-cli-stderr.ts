/**
 * CLI stderr 消毒 — 本地化自 clowder-ai `src/utils/sanitize-cli-stderr.ts`（F212 Phase A）。
 *
 * 顺序契约：结构化块（JWT/PEM）先于 token 正则，具体 token 先于通用，
 * 已知路径先于高熵回退。KD-2：本函数不截断，调用方在 sanitize 之后截断，
 * 防止 token 中部截断绕过黑名单（AC-A3）。
 *
 * @module @flowforge/terminal/cli/sanitize-cli-stderr
 */

import { getPathPatterns, SANITIZER_PATTERNS } from './cli-error-patterns.js';

export interface CliStderrSanitizerOptions {
  /** 子 CLI 进程使用的额外 HOME 根（隔离 HOME/profile），与 process.env.HOME 相同处理 */
  additionalHomePaths?: readonly string[];
}

/** 粗略 Shannon 风格熵估计：32 字符且 ≥50% 唯一字符极可能是 token */
function looksHighEntropy(s: string): boolean {
  if (s.length < 32) return false;
  const unique = new Set(s).size;
  return unique / s.length >= 0.5 && unique >= 16;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHomePathPattern(homePath: string): RegExp | null {
  const trimmed = homePath.trim().replace(/[\\/]+$/, '');
  if (trimmed.length <= 1) return null;
  return new RegExp(`${escapeRegex(trimmed)}(?=[\\\\/:\\s'"]|$)`, 'g');
}

export function sanitizeCliStderr(input: string, options: CliStderrSanitizerOptions = {}): string {
  if (!input) return '';

  // 1. NFKC normalize (defeat fullwidth/homograph token bypass)
  let out = input.normalize('NFKC');

  // 2. Control sequences (clean output noise)
  out = out.replace(SANITIZER_PATTERNS.ansiCsi, '');
  out = out.replace(SANITIZER_PATTERNS.osc, '');

  // 3. Structured secret blobs (JWT/PEM — must come before piecewise token regex)
  out = out.replace(SANITIZER_PATTERNS.jwt, '[JWT_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.pem, '[PEM_REDACTED]');

  // 4. Cookie headers (before URL query)
  out = out.replace(SANITIZER_PATTERNS.cookieHeader, (_match, name: string) => `${name}: [COOKIE_REDACTED]`);

  // 5. URL query / fragment strings
  out = out.replace(SANITIZER_PATTERNS.urlQuery, '$1[QUERY_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.urlFragment, '$1[FRAGMENT_REDACTED]');

  // 6. Provider tokens (specific first to avoid generic pattern eating prefix)
  out = out.replace(SANITIZER_PATTERNS.openaiAnthropic, '[TOKEN_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.githubPat, '[TOKEN_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.githubClassic, '[TOKEN_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.npmToken, '[TOKEN_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.googleAIza, '[TOKEN_REDACTED]');
  out = out.replace(SANITIZER_PATTERNS.bearer, 'Bearer [TOKEN_REDACTED]');

  // 7. Generic key=value pattern: preserve key name + delimiter, redact value
  out = out.replace(
    SANITIZER_PATTERNS.genericTokenKv,
    (_full, key: string, delim: string) => `${key}${delim}[TOKEN_REDACTED]`,
  );

  // 8. Paths before high-entropy fallback (random HOME segments would become opaque)
  const paths = getPathPatterns();
  if (paths.homeUnix) out = out.replace(paths.homeUnix, '~');
  if (paths.userProfileWin) out = out.replace(paths.userProfileWin, '~');
  for (const homePath of options.additionalHomePaths ?? []) {
    const pattern = buildHomePathPattern(homePath);
    if (pattern) out = out.replace(pattern, '~');
  }
  out = out.replace(SANITIZER_PATTERNS.winUserPath, '~');
  out = out.replace(SANITIZER_PATTERNS.tmpPath, '/tmp/[REDACTED]');

  // 9. High-entropy fallback (last-resort for anything that survived above)
  out = out.replace(SANITIZER_PATTERNS.highEntropy, (m: string) => (looksHighEntropy(m) ? '[REDACTED]' : m));

  return out;
}
