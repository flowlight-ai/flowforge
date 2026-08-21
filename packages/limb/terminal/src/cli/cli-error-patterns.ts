/**
 * CLI 错误模式池 — 本地化自 clowder-ai `src/utils/cli-error-patterns.ts`（F212 Phase A）。
 *
 * 两个消费者：
 * - `sanitize-cli-stderr.ts`：暴露前消毒密钥/路径/控制序列
 * - `cli-diagnostics.ts`：将 stderr / NDJSON stream error 文本分类为 reasonCode
 *
 * 顺序契约：结构化块（JWT/PEM）先于 token 正则，具体 token 先于通用，
 * 已知路径先于高熵回退。
 *
 * @module @flowforge/terminal/cli/cli-error-patterns
 */

import type { CliErrorReasonCode } from '../types.js';

// ── Sanitizer regex pool（按固定顺序应用于 sanitize-cli-stderr.ts）──────────────

// Control sequences (ANSI CSI / OSC). \x1b is ESC. OSC ends at BEL (\x07) or ST (\x1b\\).
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// JWT: 3 base64url segments separated by '.', first 2 begin with 'eyJ'
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// PEM block: -----BEGIN ... PRIVATE KEY----- to matching END
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// URL query — everything after ? until whitespace or closing quote/paren
const URL_QUERY = /(\?)([^\s'"<>)]+)/g;
// URL fragment — redact only fragments carrying sensitive keys so issue anchors stay readable
const URL_FRAGMENT = /(#)(?=[^\s'"<>)\n]*(?:access_token|id_token|refresh_token|state|code)=)([^\s'"<>)]+)/gi;

// Cookie / set-cookie header value (case-insensitive, until ; or newline)
const COOKIE_HEADER = /((?:set-)?cookie)\s*:\s*[^;\n\r]+/gi;

// Provider tokens (specific patterns first; order matters in sanitizer)
const OPENAI_ANTHROPIC = /sk-[A-Za-z0-9_-]{20,}/g;
const GITHUB_PAT = /github_pat_[A-Za-z0-9_]{82,}/g;
const GITHUB_CLASSIC = /gh[pousr]_[A-Za-z0-9]{36,}/g;
const NPM_TOKEN = /npm_[A-Za-z0-9]{36,}/g;
const GOOGLE_AIZA = /AIza[0-9A-Za-z_-]{35}/g;
// HTTP auth schemes are case-insensitive (RFC 7235) — stderr from proxies often lowercases
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9_.\-+/=]+/gi;

// Generic key=value: `"api_key": "xxx"`, `token=xxx`, `password: xxx` (value ≥ 8 chars)
const GENERIC_TOKEN_KV =
  /(token|api[_-]?key|secret|password|callbackToken)(["']?\s*[:=]\s*["']?)([^\s,}"';\n\r]{8,})/gi;

// High-entropy fallback: ≥32 chars in [A-Za-z0-9+/=_-], applied LAST and filtered by entropy
const HIGH_ENTROPY = /[A-Za-z0-9+/=_-]{32,}/g;

// Path patterns are dynamic (depend on env). See getPathPatterns().
const WIN_USER_PATH = /C:\\Users\\[^\\\s'"]+/g;
const TMP_PATH = /\/tmp\/[^\s'"<>)]+/g;

export const SANITIZER_PATTERNS = {
  ansiCsi: ANSI_CSI,
  osc: OSC,
  jwt: JWT,
  pem: PEM,
  urlQuery: URL_QUERY,
  urlFragment: URL_FRAGMENT,
  cookieHeader: COOKIE_HEADER,
  openaiAnthropic: OPENAI_ANTHROPIC,
  githubPat: GITHUB_PAT,
  githubClassic: GITHUB_CLASSIC,
  npmToken: NPM_TOKEN,
  googleAIza: GOOGLE_AIZA,
  bearer: BEARER_TOKEN,
  genericTokenKv: GENERIC_TOKEN_KV,
  highEntropy: HIGH_ENTROPY,
  winUserPath: WIN_USER_PATH,
  tmpPath: TMP_PATH,
} as const;

/**
 * Build runtime-dependent path patterns. Re-compute on each sanitize call because
 * tests / multi-tenant envs may mutate process.env.HOME.
 */
export function getPathPatterns(): { homeUnix: RegExp | null; userProfileWin: RegExp | null } {
  const home = process.env.HOME;
  const userprofile = process.env.USERPROFILE;
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    homeUnix: home && home.length > 1 ? new RegExp(`${escapeRegex(home)}(?=[/\\s'"]|$)`, 'g') : null,
    userProfileWin:
      userprofile && userprofile.length > 1 ? new RegExp(`${escapeRegex(userprofile)}(?=[\\\\/\\s'"]|$)`, 'g') : null,
  };
}

// ── Classifier patterns（cli-diagnostics.classifyCliError 使用）───────────────────

export const CLASSIFIER_PATTERNS: Array<{ code: CliErrorReasonCode; regex: RegExp }> = [
  // Existing (must regress — predates F212)
  {
    code: 'invalid_thinking_signature',
    regex: /Invalid [`'"]?signature[`'"]? in [`'"]?thinking[`'"]? block/i,
  },
  { code: 'missing_rollout', regex: /no rollout found/i },
  // opencode resumed a stale --session after its session DB was recreated/cleared
  { code: 'session_not_found', regex: /Session not found/i },
  // F212 Phase H: upstream provider (Codex 0.98+) policy engine rejects prompt
  {
    code: 'upstream_policy_reject',
    regex: /flagged for possible cybersecurity risk/i,
  },
  // New 7 (AC-A4) — ordered most-specific first to avoid mis-classification
  {
    code: 'model_not_found',
    regex:
      /(model.*not found|Unknown model|supported API model names|model.*not supported|deployment.*not found|neither PlanModel nor RequestedModel specified|Please use the \/model command|没有可用的账号侧默认模型)/i,
  },
  {
    code: 'auth_failed',
    regex:
      /(\b401\b|Unauthorized|invalid api key|authentication failed|forbidden.*api|profile is not authenticated|Authentication required\. Please visit the URL to log in|authentication interrupted)/i,
  },
  // F212 Phase E: server-side temporary throttling is NOT a user quota problem —
  // MUST come BEFORE quota_exceeded (specific-first ordering so "(not your usage limit)" wins)
  {
    code: 'server_overloaded',
    regex: /(temporarily limiting requests|not your usage limit|server is (overloaded|busy)|\b529\b|\bOverloaded\b)/i,
  },
  {
    code: 'quota_exceeded',
    regex: /(\b429\b|quota|rate limit|too many requests|usage limit)/i,
  },
  {
    code: 'network_error',
    regex:
      /(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|socket hang up|fetch failed|connect ECONN|getaddrinfo|stream disconnected before completion|error sending request for url)/i,
  },
  {
    code: 'invalid_config',
    regex: /(Error loading config\.toml|invalid transport|Failed to parse config|config.*(invalid|malformed))/i,
  },
  {
    code: 'spawn_failed',
    regex: /(spawn.*ENOENT|spawn.*EACCES|ENOENT.*spawn|EACCES.*spawn)/i,
  },
  {
    code: 'context_window_exceeded',
    regex: /(context length|maximum context|context_length_exceeded|tokens? exceed|prompt too long)/i,
  },
  // F212 Phase D: Claude CLI result error — model tool-call parse failure
  {
    code: 'tool_call_parse_failed',
    regex: /tool calls? could not be parsed|could not parse[^.\n]{0,30}tool call/i,
  },
];
