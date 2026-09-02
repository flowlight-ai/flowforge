/**
 * F202 Phase 2D: Issue fix readiness 判定 — 从 issue 评论事件提取/校验修复证据。
 *
 * TS 移植自 clowder-ai `domains/community/issue-analysis/issue-fix-evidence.ts`
 * （community 域自包含纯函数，随 IssueCommentRouter 移植）。
 */

export interface LinkedPullRequestEvidenceProjection {
  readonly repo: string;
  readonly type: 'pr';
  readonly number: number;
  readonly subjectKey: string;
  readonly state: string;
}

export type IssueFixEvidence =
  | { readonly kind: 'pull_request'; readonly url: string; readonly number: number }
  | { readonly kind: 'commit'; readonly sha: string; readonly url?: string }
  | { readonly kind: 'release'; readonly tag: string; readonly url: string }
  | { readonly kind: 'reproduction'; readonly evidence: string };

export type IssueFixReadinessDecision =
  | { readonly kind: 'ready'; readonly evidence: IssueFixEvidence }
  | { readonly kind: 'waiting'; readonly reason: 'fix_claim_without_evidence' | 'invalid_evidence' }
  | { readonly kind: 'ignore'; readonly reason: 'no_fix_claim' };

export interface SelectIssueFixReadinessInput {
  readonly events: readonly CommunityEventLike[];
  readonly linkedPullRequests?: readonly LinkedPullRequestEvidenceProjection[];
}

/** community 事件的最小结构（payload.body/fixEvidence 供判定）。 */
export interface CommunityEventLike {
  readonly kind: string;
  readonly payload?: { readonly body?: unknown; readonly fixEvidence?: unknown };
}

const FIX_CLAIM_PATTERN = /(?:\b(?:fix(?:ed|es)?|resolv(?:ed|es)?|shipped|released)\b|已修|修复|已解决|已发布)/iu;
const CRITICAL_SIGNAL_PATTERNS = [
  /\bP0\b/iu,
  /\b(?:security|vulnerability|CVE-\d{4}-\d+|remote code execution|RCE|auth(?:entication|orization)? bypass)\b/iu,
  /\bdata[ -]?loss\b/iu,
  /(?:安全漏洞|远程代码执行|鉴权绕过|认证绕过|数据丢失|无法恢复)/u,
] as const;

function parseGitHubUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname.toLowerCase() !== 'github.com' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function decodeUrlComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function pathSegments(url: URL): string[] | null {
  const segments: string[] = [];
  for (const segment of url.pathname.split('/').filter(Boolean)) {
    const decoded = decodeUrlComponent(segment);
    if (decoded === null) return null;
    segments.push(decoded);
  }
  return segments;
}

function validatePullRequestEvidence(value: Record<string, unknown>): IssueFixEvidence | null {
  const url = parseGitHubUrl(value.url);
  if (!url || typeof value.number !== 'number' || !Number.isInteger(value.number) || value.number <= 0) return null;
  const segments = pathSegments(url);
  if (!segments || segments.length !== 4 || segments[2] !== 'pull' || segments[3] !== String(value.number)) return null;
  return { kind: 'pull_request', url: url.toString(), number: value.number };
}

function validateCommitEvidence(value: Record<string, unknown>): IssueFixEvidence | null {
  if (typeof value.sha !== 'string' || !/^[a-f0-9]{7,64}$/iu.test(value.sha)) return null;
  const sha = value.sha.toLowerCase();
  if (value.url === undefined) return { kind: 'commit', sha };
  const url = parseGitHubUrl(value.url);
  if (!url) return null;
  const segments = pathSegments(url);
  if (!segments || segments.length !== 4 || segments[2] !== 'commit' || !segments[3]?.toLowerCase().startsWith(sha)) {
    return null;
  }
  return { kind: 'commit', sha, url: url.toString() };
}

function validateReleaseEvidence(value: Record<string, unknown>): IssueFixEvidence | null {
  if (typeof value.tag !== 'string' || value.tag.trim().length === 0) return null;
  const url = parseGitHubUrl(value.url);
  if (!url) return null;
  const segments = pathSegments(url);
  const tag = value.tag.trim();
  if (!segments || segments.length < 5 || segments[2] !== 'releases' || segments[3] !== 'tag') return null;
  if (segments.slice(4).join('/') !== tag) return null;
  return { kind: 'release', tag, url: url.toString() };
}

/** 校验任意形态的 fix evidence 值（pull_request/commit/release/reproduction）。 */
export function validateIssueFixEvidence(value: unknown): IssueFixEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'pull_request') return validatePullRequestEvidence(candidate);
  if (candidate.kind === 'commit') return validateCommitEvidence(candidate);
  if (candidate.kind === 'release') return validateReleaseEvidence(candidate);
  if (candidate.kind === 'reproduction') {
    if (typeof candidate.evidence !== 'string' || candidate.evidence.trim().length === 0) return null;
    return { kind: 'reproduction', evidence: candidate.evidence.trim() };
  }
  return null;
}

export function hasIssueFixClaim(body: string): boolean {
  return FIX_CLAIM_PATTERN.test(body);
}

export function isCriticalIssueSignal(body: string): boolean {
  return CRITICAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(body));
}

/** 从评论 body 提取 fix evidence（PR URL / commit SHA / release tag）。 */
export function extractIssueFixEvidence(body: string): IssueFixEvidence | null {
  const pullRequest = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/iu.exec(body);
  if (pullRequest) {
    return validateIssueFixEvidence({
      kind: 'pull_request',
      url: pullRequest[0],
      number: Number(pullRequest[1]!),
    });
  }
  const commit = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/([a-f0-9]{7,64})/iu.exec(body);
  if (commit) {
    return validateIssueFixEvidence({ kind: 'commit', sha: commit[1]!, url: commit[0]! });
  }
  const release = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\/([^\s)#?]+)/iu.exec(body);
  if (release) {
    const tag = decodeUrlComponent(release[1]!);
    if (tag === null) return null;
    return validateIssueFixEvidence({ kind: 'release', tag, url: release[0]! });
  }
  return null;
}

function linkedPullRequestEvidence(
  projections: readonly LinkedPullRequestEvidenceProjection[] | undefined,
): IssueFixEvidence | null {
  const merged = projections?.find((projection) => projection.type === 'pr' && projection.state === 'fixed');
  if (!merged) return null;
  return {
    kind: 'pull_request',
    url: `https://github.com/${merged.repo}/pull/${merged.number}`,
    number: merged.number,
  };
}

interface EvidenceEventInspection {
  readonly decision?: IssueFixReadinessDecision;
  readonly sawFixClaim: boolean;
}

function inspectEvidenceEvent(event: CommunityEventLike): EvidenceEventInspection {
  if (event.kind === 'case.fix_evidence_recorded') {
    const evidence = validateIssueFixEvidence(event.payload?.fixEvidence);
    return {
      decision: evidence ? { kind: 'ready', evidence } : { kind: 'waiting', reason: 'invalid_evidence' },
      sawFixClaim: true,
    };
  }
  if (event.kind !== 'issue.commented') return { sawFixClaim: false };
  const body = typeof event.payload?.body === 'string' ? event.payload.body : '';
  if (event.payload?.fixEvidence !== undefined) {
    const evidence = validateIssueFixEvidence(event.payload.fixEvidence);
    return {
      decision: evidence ? { kind: 'ready', evidence } : { kind: 'waiting', reason: 'invalid_evidence' },
      sawFixClaim: true,
    };
  }
  if (!hasIssueFixClaim(body)) return { sawFixClaim: false };
  const extracted = extractIssueFixEvidence(body);
  return {
    ...(extracted ? { decision: { kind: 'ready' as const, evidence: extracted } } : {}),
    sawFixClaim: true,
  };
}

/** 最新事件优先：ready → waiting → ignore（fix claim 但无证据）。 */
export function selectIssueFixReadiness(input: SelectIssueFixReadinessInput): IssueFixReadinessDecision {
  let sawFixClaim = false;
  for (const event of [...input.events].reverse()) {
    const inspected = inspectEvidenceEvent(event);
    if (inspected.decision) return inspected.decision;
    sawFixClaim ||= inspected.sawFixClaim;
  }
  if (sawFixClaim) {
    const linked = linkedPullRequestEvidence(input.linkedPullRequests);
    return linked ? { kind: 'ready', evidence: linked } : { kind: 'waiting', reason: 'fix_claim_without_evidence' };
  }
  return { kind: 'ignore', reason: 'no_fix_claim' };
}
