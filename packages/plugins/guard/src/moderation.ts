/**
 * Content moderation — five-layer safety chain plus contract errors.
 *
 * Maps flowforge Python legacy core/moderation.py (contract only — the
 * external moderation API client itself stays host-injected) and
 * security/moderation.py (L5 publish-gate checker) (F25).
 *
 * Five-layer security architecture:
 * - L1 input sanitization: keyword matching
 * - L2 permission check: regex pattern rules
 * - L3 architecture constraint: general rules
 * - L4 tool sandbox / LLM review: injected provider
 * - L5 content moderation: injected platform provider
 *
 * Domain-specific rule sets are intentionally NOT bundled here; hosts
 * inject keywords/rules/providers appropriate for their deployment.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Contract errors (from core/moderation.py)
// ---------------------------------------------------------------------------

/** Moderation invocation failure (network/HTTP/parse errors). */
export class ModerationError extends Error {
  override readonly cause: unknown

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'ModerationError'
    this.cause = options.cause
  }
}

/**
 * Business-level rejection: content hit a blocking risk label. Callers
 * should catch this and halt downstream flows (publish, persist, ...).
 */
export class ModerationBlockedError extends Error {
  readonly content: string
  readonly riskLabels: string[]

  constructor(content: string, riskLabels: string[]) {
    const preview = content.slice(0, 200)
    super(`Content blocked: risk_labels=${JSON.stringify(riskLabels)}, preview=${JSON.stringify(preview.slice(0, 80))}`)
    this.name = 'ModerationBlockedError'
    this.content = preview
    this.riskLabels = [...riskLabels]
  }
}

/** All moderation retries timed out; callers decide the fallback action. */
export class ModerationTimeoutError extends Error {
  readonly timeoutSeconds: number

  constructor(message: string, timeoutSeconds: number) {
    super(message)
    this.name = 'ModerationTimeoutError'
    this.timeoutSeconds = timeoutSeconds
  }
}

// ---------------------------------------------------------------------------
// Levels / severities / actions
// ---------------------------------------------------------------------------

export const MODERATION_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const
export type ModerationLevel = (typeof MODERATION_LEVELS)[number]

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'
export type ModerationAction = 'allow' | 'warn' | 'block' | 'review'

export interface ModerationRule {
  name: string
  level: ModerationLevel
  category: string
  /** Literal substring (string) or regex test. */
  pattern: string | RegExp
  action: ModerationAction
  severity: ModerationSeverity
  enabled: boolean
}

export interface ModerationResult {
  passed: boolean
  level: ModerationLevel
  category: string
  severity: ModerationSeverity
  reason: string
  details: string[]
  action: ModerationAction
  cacheHit?: boolean
}

/** Injected provider outcome (L4 llm / L5 platform). */
export interface ModerationProviderOutcome {
  passed: boolean
  reason?: string
  category?: string
  severity?: ModerationSeverity
  details?: string[]
}

export interface ModerationProvider {
  check(content: string): Promise<ModerationProviderOutcome>
}

// ---------------------------------------------------------------------------
// Five-layer chain
// ---------------------------------------------------------------------------

export interface ContentModerationLayerOptions {
  /** L1: category → keyword list. */
  keywords?: Record<string, string[]>
  /** L2: regex pattern rules. */
  regexes?: ModerationRule[]
  /** L3: general rules. */
  rules?: ModerationRule[]
  /** L4: LLM-based review (host-injected). */
  llm?: ModerationProvider
  /** L5: platform moderation service (host-injected). */
  platform?: ModerationProvider
  /** Cache TTL for verdicts, seconds. */
  cacheTtlSeconds?: number
  /** Injectable clock (epoch seconds) for tests. */
  now?: () => number
}

interface CacheEntry {
  result: ModerationResult
  expiresAt: number
}

export class ContentModerationLayer {
  private readonly keywords: Record<string, string[]>
  private readonly regexes: ModerationRule[]
  private readonly rules: ModerationRule[]
  private readonly llm: ModerationProvider | undefined
  private readonly platform: ModerationProvider | undefined
  private readonly cacheTtlSeconds: number
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(options: ContentModerationLayerOptions = {}) {
    this.keywords = options.keywords ?? {}
    this.regexes = options.regexes ?? []
    this.rules = options.rules ?? []
    this.llm = options.llm
    this.platform = options.platform
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300
    this.now = options.now ?? (() => Date.now() / 1000)
  }

  /** Run the five-layer chain; any blocking layer short-circuits. */
  async moderate(content: string): Promise<ModerationResult> {
    const key = createHash('sha256').update(content).digest('hex')
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.now()) {
      return { ...cached.result, cacheHit: true }
    }

    const warnings: string[] = []

    // L1 keyword scan — one hit per category is enough to block.
    for (const [category, words] of Object.entries(this.keywords)) {
      const hit = words.find(word => content.includes(word))
      if (hit) {
        return this.finish(key, {
          passed: false,
          level: 'L1',
          category,
          severity: 'high',
          reason: `keyword '${hit}' matched`,
          details: [`keyword:${category}`],
          action: 'block',
        })
      }
    }

    // L2 regex rules.
    for (const rule of this.regexes) {
      const outcome = this.applyRule(content, rule, 'L2')
      if (outcome?.action === 'block') return this.finish(key, outcome)
      if (outcome) warnings.push(outcome.reason)
    }

    // L3 general rules.
    for (const rule of this.rules) {
      const outcome = this.applyRule(content, rule, 'L3')
      if (outcome?.action === 'block') return this.finish(key, outcome)
      if (outcome) warnings.push(outcome.reason)
    }

    // L4 LLM review.
    const llmOutcome = await this.runProvider(this.llm, content, 'L4')
    if (llmOutcome && !llmOutcome.passed) {
      return this.finish(key, this.providerResult(llmOutcome, 'L4'))
    }

    // L5 platform moderation.
    const platformOutcome = await this.runProvider(this.platform, content, 'L5')
    if (platformOutcome && !platformOutcome.passed) {
      return this.finish(key, this.providerResult(platformOutcome, 'L5'))
    }

    return this.finish(key, {
      passed: true,
      level: 'L5',
      category: '',
      severity: warnings.length > 0 ? 'low' : 'none',
      reason: warnings.length > 0 ? warnings.join('; ') : 'all layers passed',
      details: warnings,
      action: warnings.length > 0 ? 'warn' : 'allow',
    })
  }

  get cacheSize(): number {
    return this.cache.size
  }

  private applyRule(
    content: string,
    rule: ModerationRule,
    level: ModerationLevel,
  ): ModerationResult | null {
    if (!rule.enabled) return null
    const matched =
      typeof rule.pattern === 'string'
        ? content.includes(rule.pattern)
        : rule.pattern.test(content)
    if (!matched) return null
    return {
      passed: rule.action !== 'block',
      level,
      category: rule.category,
      severity: rule.severity,
      reason: `rule '${rule.name}' matched`,
      details: [`rule:${rule.name}`],
      action: rule.action,
    }
  }

  private async runProvider(
    provider: ModerationProvider | undefined,
    content: string,
    level: ModerationLevel,
  ): Promise<ModerationProviderOutcome | null> {
    if (!provider) return null
    try {
      return await provider.check(content)
    } catch (error) {
      throw new ModerationError(`Moderation provider ${level} failed`, { cause: error })
    }
  }

  private providerResult(
    outcome: ModerationProviderOutcome,
    level: ModerationLevel,
  ): ModerationResult {
    return {
      passed: false,
      level,
      category: outcome.category ?? '',
      severity: outcome.severity ?? 'high',
      reason: outcome.reason ?? `provider ${level} rejected content`,
      details: outcome.details ?? [],
      action: 'block',
    }
  }

  private finish(key: string, result: ModerationResult): ModerationResult {
    this.cache.set(key, { result, expiresAt: this.now() + this.cacheTtlSeconds })
    return result
  }
}

// ---------------------------------------------------------------------------
// L5 publish-gate checker (from security/moderation.py)
// ---------------------------------------------------------------------------

export interface ContentCheckResult {
  safe: boolean
  level: ModerationLevel
  riskTags: string[]
  reason: string
  confidence: number
}

export interface ContentModerationCheckerOptions {
  /** category → words; hosts load real word lists from config. */
  sensitiveCategories?: Record<string, string[]>
  /** False-advertising style compliance keywords. */
  complianceWords?: string[]
  /** Enable built-in PII (phone/id/bank-card) regex checks. */
  privacyChecks?: boolean
}

const PRIVACY_PATTERNS: Array<[string, RegExp]> = [
  ['privacy:phone_number', /1[3-9]\d{9}/],
  ['privacy:id_number', /\d{17}[\dXx]/],
  ['privacy:bank_card', /\d{16,19}/],
]

/**
 * Publish-time content check across three dimensions: sensitive words,
 * privacy leakage and compliance. Word lists are host-injected; only
 * neutral PII regexes ship by default.
 */
export class ContentModerationChecker {
  private readonly sensitiveCategories: Record<string, string[]>
  private readonly complianceWords: string[]
  private readonly privacyChecks: boolean

  constructor(options: ContentModerationCheckerOptions = {}) {
    // copy per-category lists so addSensitiveWords never mutates caller data
    this.sensitiveCategories = Object.fromEntries(
      Object.entries(options.sensitiveCategories ?? {}).map(([category, words]) => [
        category,
        [...words],
      ]),
    )
    this.complianceWords = options.complianceWords ?? []
    this.privacyChecks = options.privacyChecks ?? true
  }

  async check(content: string, checkTypes?: string[]): Promise<ContentCheckResult> {
    const types = checkTypes ?? ['sensitive_words', 'privacy', 'compliance']
    const riskTags: string[] = []

    if (types.includes('sensitive_words')) {
      riskTags.push(...this.checkSensitiveWords(content))
    }
    if (types.includes('privacy') && this.privacyChecks) {
      riskTags.push(...this.checkPrivacyLeak(content))
    }
    if (types.includes('compliance')) {
      riskTags.push(...this.checkCompliance(content))
    }

    const safe = riskTags.length === 0
    return {
      safe,
      level: 'L5',
      riskTags,
      reason: safe ? 'content safety check passed' : riskTags.join('; '),
      confidence: safe ? 0.95 : 0.85,
    }
  }

  private checkSensitiveWords(content: string): string[] {
    const tags: string[] = []
    for (const [category, words] of Object.entries(this.sensitiveCategories)) {
      // one tag per category
      if (words.some(word => content.includes(word))) tags.push(`sensitive:${category}`)
    }
    return tags
  }

  private checkPrivacyLeak(content: string): string[] {
    const tags: string[] = []
    for (const [tag, pattern] of PRIVACY_PATTERNS) {
      if (pattern.test(content)) tags.push(tag)
    }
    return tags
  }

  private checkCompliance(content: string): string[] {
    return this.complianceWords.some(word => content.includes(word))
      ? ['compliance:false_advertising']
      : []
  }

  addSensitiveWords(category: string, words: string[]): void {
    if (!this.sensitiveCategories[category]) this.sensitiveCategories[category] = []
    this.sensitiveCategories[category].push(...words)
  }

  getStatus(): Record<string, unknown> {
    return {
      level: 'L5',
      categories: Object.keys(this.sensitiveCategories),
      category_word_counts: Object.fromEntries(
        Object.entries(this.sensitiveCategories).map(([cat, words]) => [cat, words.length]),
      ),
    }
  }
}
