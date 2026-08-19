/**
 * buildThreadMemory — F065 Phase B + F148 VG-3 + Phase G
 * Pure function: merges existing ThreadMemory with a new extractive digest,
 * producing an updated rolling summary. Rule-based (no LLM).
 *
 * 移植自 clowder-ai
 * `packages/api/src/domains/cats/services/session/buildThreadMemory.ts`
 * （全量移植；依赖差异收敛）：
 * - `ThreadMemoryV1` / `ThreadMemorySourceRef` 类型随本模块落地（clowder
 *   定义在 ThreadStore 端口，flowforge cats-stores 尚未提供该契约，此处
 *   作为类型源头 re-export 给 SessionSealer 消费）
 * - `estimateTokens`：clowder 用 js-tiktoken cl100k 估算；flowforge 未
 *   vendored 该依赖，改用 ~4 chars/token 启发式近似（预算裁剪语义不变）
 * - `formatPromptTimeRange`：内联 UTC 版（对齐 clowder format-time.ts 的
 *   无 timeZone 分支输出 `YYYY-MM-DD HH:mm — YYYY-MM-DD HH:mm UTC`）
 *
 * Merge strategy:
 * 1. Format new digest as single session summary line
 * 2. Prepend to existing summary
 * 3. Trim oldest lines from end if over maxTokens
 * 4. Increment sessionsIncorporated
 * 5. VG-3: Merge DecisionSignals into structured decisions/openQuestions/artifacts
 * 6. G1: Artifact ledger — append+dedup+cap (cumulative, not overwrite)
 *
 * @module @flowforge/cats-session/thread-memory
 */

import type { DecisionSignals } from './decision-signals.ts'
import type { ExtractiveDigestV1 } from './transcript-writer.ts'

/** F065 Phase B + F148 VG-3: Rolling thread-level memory across sealed sessions. */
export interface ThreadMemorySourceRef {
  threadId: string;
  sessionId?: string;
  eventNo?: number;
  invocationId?: string;
  messageId?: string;
}

export interface ThreadMemoryV1 {
  v: 1;
  /** Rolling summary text */
  summary: string;
  /** Number of sealed sessions incorporated into this memory */
  sessionsIncorporated: number;
  /** Unix timestamp of last update */
  updatedAt: number;
  /** VG-3: Key decisions extracted from sessions (max 8) */
  decisions?: string[];
  /** Drill coordinates aligned by index with decisions. */
  decisionRefs?: ThreadMemorySourceRef[];
  /** VG-3: Open questions extracted from sessions (max 5) */
  openQuestions?: string[];
  /** Drill coordinates aligned by index with openQuestions. */
  openQuestionRefs?: ThreadMemorySourceRef[];
  /** VG-3: Referenced artifacts — ADRs, Feature IDs (max 8) */
  artifacts?: string[];
  /** F148 Phase H: Deterministic file/PR artifacts from session seal (max 5) */
  recentArtifacts?: Array<{
    type: string;
    ref: string;
    label: string;
    updatedAt: number;
    updatedBy: string;
    ops?: string[];
  }>;
}

const MAX_FILES_PER_CATEGORY = 10;

/** Op priority: create > edit > delete > read */
const OP_PRIORITY: Record<string, number> = { create: 0, edit: 1, delete: 2, read: 3 };
const OP_LABELS: Record<string, string> = { create: 'Created', edit: 'Modified', delete: 'Deleted', read: 'Read' };
const OP_ORDER = ['create', 'edit', 'delete', 'read'];

/**
 * 近似 token 估算。clowder-ai 用 js-tiktoken cl100k；flowforge 未引入该
 * 依赖，退化为 ~4 chars/token 启发式（中英混排下的常见近似），仅用于
 * ThreadMemory 预算裁剪，不要求精确计费。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** UTC `YYYY-MM-DD HH:mm` rendering (对齐 clowder dateTimeInZone('UTC')). */
function utcDateTime(epochMs: number): string {
  const iso = new Date(epochMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Format a from–to range for prompt injection (UTC-only branch of clowder formatPromptTimeRange). */
export function formatPromptTimeRange(fromMs: number, toMs: number): string {
  return `${utcDateTime(fromMs)} — ${utcDateTime(toMs)} UTC`;
}

function formatSessionLine(digest: ExtractiveDigestV1, sessionNumber: number): string {
  const duration = Math.round((digest.time.sealedAt - digest.time.createdAt) / 60000);
  const timeRange = formatPromptTimeRange(digest.time.createdAt, digest.time.sealedAt);

  // Group files by highest-priority op
  const groups = new Map<string, string[]>();
  for (const file of digest.filesTouched) {
    if (file.ops.length === 0) continue;
    const bestOp = file.ops.reduce((a, b) => ((OP_PRIORITY[a] ?? 99) <= (OP_PRIORITY[b] ?? 99) ? a : b));
    const list = groups.get(bestOp) ?? [];
    list.push(file.path);
    groups.set(bestOp, list);
  }

  // Format each group in priority order
  const parts: string[] = [];
  for (const op of OP_ORDER) {
    const files = groups.get(op);
    if (!files || files.length === 0) continue;
    const label = OP_LABELS[op] ?? op;
    const display = files.slice(0, MAX_FILES_PER_CATEGORY).join(', ');
    const extra = files.length > MAX_FILES_PER_CATEGORY ? ` +${files.length - MAX_FILES_PER_CATEGORY} more` : '';
    parts.push(`${label}: ${display}${extra}`);
  }

  // Errors
  const errorPart =
    digest.errors.length > 0 ? ` ${digest.errors.length} error${digest.errors.length > 1 ? 's' : ''}.` : '';

  const body = parts.length > 0 ? parts.join('. ') : 'No file ops';
  return `Session #${sessionNumber} (${timeRange}, ${duration}min): ${body}.${errorPart}`;
}

const MAX_DECISIONS = 8;
const MAX_OPEN_QUESTIONS = 5;
const MAX_ARTIFACTS = 8;
const MAX_LEDGER_ENTRIES = 20;

type LedgerEntry = NonNullable<ThreadMemoryV1['recentArtifacts']>[number];

function mergeArtifactLedger(
  existing: ThreadMemoryV1['recentArtifacts'],
  incoming: ThreadMemoryV1['recentArtifacts'],
): LedgerEntry[] | undefined {
  const existingArr = existing ?? [];
  const incomingArr = incoming ?? [];
  if (existingArr.length === 0 && incomingArr.length === 0) return undefined;

  const byRef = new Map<string, LedgerEntry>();
  for (const a of existingArr) byRef.set(a.ref, a);
  for (const a of incomingArr) {
    const prev = byRef.get(a.ref);
    if (!prev || a.updatedAt >= prev.updatedAt) byRef.set(a.ref, a);
  }

  return [...byRef.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LEDGER_ENTRIES);
}

/** Deduplicate strings by substring containment */
function dedupStrings(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    const dominated = result.some((e) => (e.length <= item.length ? item.includes(e) : e.includes(item)));
    if (!dominated) result.push(item);
  }
  return result;
}

function mergeReferencedSignals(
  incoming: string[],
  incomingRefs: Array<ThreadMemorySourceRef | null> | undefined,
  existing: string[],
  existingRefs: ThreadMemorySourceRef[] | undefined,
  incomingFallback: ThreadMemorySourceRef,
  existingFallback: ThreadMemorySourceRef,
  limit: number,
): { values: string[]; refs: ThreadMemorySourceRef[] } {
  const candidates = [
    ...incoming.map((value, index) => ({ value, ref: incomingRefs?.[index] ?? incomingFallback })),
    ...existing.map((value, index) => ({ value, ref: existingRefs?.[index] ?? existingFallback })),
  ];
  const values: string[] = [];
  const refs: ThreadMemorySourceRef[] = [];
  for (const candidate of candidates) {
    const dominated = values.some((value) =>
      value.length <= candidate.value.length ? candidate.value.includes(value) : value.includes(candidate.value),
    );
    if (dominated) continue;
    values.push(candidate.value);
    refs.push(candidate.ref);
    if (values.length >= limit) break;
  }
  return { values, refs };
}

export function buildThreadMemory(
  existing: ThreadMemoryV1 | null,
  newDigest: ExtractiveDigestV1,
  maxTokens: number,
  signals?: DecisionSignals,
  recentArtifacts?: ThreadMemoryV1['recentArtifacts'],
): ThreadMemoryV1 {
  // R1 P1-1: session number comes from digest.seq (1-based display), not merge count
  const sessionNumber = newDigest.seq + 1;
  const mergeCount = (existing?.sessionsIncorporated ?? 0) + 1;
  const newLine = formatSessionLine(newDigest, sessionNumber);

  // Prepend new session line to existing summary
  const existingLines = existing?.summary ? existing.summary.split('\n') : [];
  const allLines = [newLine, ...existingLines];

  // Trim oldest lines (from end) until within token budget
  let summary = allLines.join('\n');
  while (estimateTokens(summary) > maxTokens && allLines.length > 1) {
    allLines.pop();
    summary = allLines.join('\n');
  }

  // R1 P2-1 hard-cap: if single remaining line still exceeds maxTokens,
  // truncate it (rough char-level cut, re-estimate)
  if (estimateTokens(summary) > maxTokens) {
    const ratio = maxTokens / Math.max(1, estimateTokens(summary));
    summary = `${summary.slice(0, Math.floor(summary.length * ratio * 0.9))}...`;
  }

  // VG-3: Merge structured decision signals
  const result: ThreadMemoryV1 = {
    v: 1,
    summary,
    sessionsIncorporated: mergeCount,
    updatedAt: Date.now(),
  };

  if (signals) {
    const existDecisions = Array.isArray(existing?.decisions) ? existing.decisions : [];
    const existQuestions = Array.isArray(existing?.openQuestions) ? existing.openQuestions : [];
    const existArtifacts = existing?.artifacts ?? [];

    const incomingFallback: ThreadMemorySourceRef = {
      threadId: newDigest.threadId,
      sessionId: newDigest.sessionId,
      ...(newDigest.invocations[0]?.invocationId ? { invocationId: newDigest.invocations[0].invocationId } : {}),
    };
    const existingFallback: ThreadMemorySourceRef = { threadId: newDigest.threadId };
    const mergedDecisions = mergeReferencedSignals(
      signals.decisions,
      signals.decisionRefs,
      existDecisions,
      existing?.decisionRefs,
      incomingFallback,
      existingFallback,
      MAX_DECISIONS,
    );
    const mergedQuestions = mergeReferencedSignals(
      signals.openQuestions,
      signals.openQuestionRefs,
      existQuestions,
      existing?.openQuestionRefs,
      incomingFallback,
      existingFallback,
      MAX_OPEN_QUESTIONS,
    );
    const mergedArtifacts = dedupStrings([...signals.artifacts, ...existArtifacts]);

    if (mergedDecisions.values.length > 0) {
      result.decisions = mergedDecisions.values;
      result.decisionRefs = mergedDecisions.refs;
    }
    if (mergedQuestions.values.length > 0) {
      result.openQuestions = mergedQuestions.values;
      result.openQuestionRefs = mergedQuestions.refs;
    }
    if (mergedArtifacts.length > 0) result.artifacts = mergedArtifacts.slice(0, MAX_ARTIFACTS);
  } else if (existing) {
    // P1-2 fix: carry forward existing decisions when signals extraction failed
    // Cloud-P2 fix: re-apply caps; Cloud-R2-P1 fix: Array.isArray guard for malformed data
    if (Array.isArray(existing.decisions) && existing.decisions.length > 0) {
      result.decisions = existing.decisions.slice(0, MAX_DECISIONS);
      result.decisionRefs = result.decisions.map(
        (_, index) => existing.decisionRefs?.[index] ?? { threadId: newDigest.threadId },
      );
    }
    if (Array.isArray(existing.openQuestions) && existing.openQuestions.length > 0) {
      result.openQuestions = existing.openQuestions.slice(0, MAX_OPEN_QUESTIONS);
      result.openQuestionRefs = result.openQuestions.map(
        (_, index) => existing.openQuestionRefs?.[index] ?? { threadId: newDigest.threadId },
      );
    }
    if (Array.isArray(existing.artifacts) && existing.artifacts.length > 0)
      result.artifacts = existing.artifacts.slice(0, MAX_ARTIFACTS);
  }

  const ledger = mergeArtifactLedger(existing?.recentArtifacts, recentArtifacts);
  if (ledger) result.recentArtifacts = ledger;

  return result;
}
