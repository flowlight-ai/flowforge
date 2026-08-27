/**
 * @flowforge/cats-guides — ConciergeInvestigationWorker（F229 Phase B2）。
 *
 * Executes bounded async investigation:
 *   1. Claim job queued → running (CAS, fail if race-lost)
 *   2. Check deadline — cancel if expired (INV I3)
 *   3. Run search_evidence via ConciergeEvidenceStore
 *   4. Build report with R-handle anchors
 *   5. Write report + transition to done
 *
 * KD-23: No HandleMapStore sync. Investigation anchors live in the report
 * and are rendered directly by InvestigationReportCard (frontend).
 * The reply validator uses per-invocation flowing handle tables from
 * buildConciergeSearchContext — no shared mutable state.
 *
 * Fire-and-forget from dispatchInvestigateTriage — errors never propagate to HTTP.
 *
 * 插件化改造：clowder createModuleLogger → 可选注入 log（缺省 console）。
 *
 * @module @flowforge/cats-guides/concierge/investigation-worker
 */

import type { InvestigationAnchor, InvestigationReport } from '../models.js';
import type { ConciergeEvidenceItem, ConciergeEvidenceStore } from '../models.js';
import type { IConciergeInvestigationJobStore } from './investigation-job-store.js';
import { isJobExpired } from './investigation-job-store.js';
import type { IConciergeTriagePlanStore } from './triage-plan-store.js';

/** 可选日志注入（缺省 console；宿主可传 ctx.logger 风格适配器）。 */
export interface ConciergeWorkerLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const fallbackLog: ConciergeWorkerLog = {
  info: (m) => console.info(`[cats-guides:investigation-worker] ${m}`),
  warn: (m) => console.warn(`[cats-guides:investigation-worker] ${m}`),
  error: (m) => console.error(`[cats-guides:investigation-worker] ${m}`),
};

// ---------------------------------------------------------------------------
// Anchor parsing（复用 concierge-search-context parseAnchor 逻辑）
// ---------------------------------------------------------------------------

function evidenceToAnchor(item: ConciergeEvidenceItem, index: number): InvestigationAnchor {
  const handle = `R${index + 1}`;
  const base = { handle, title: item.title, relevance: item.summary ?? '' };

  // Thread items: drillDown.params.threadId > anchor prefix "thread-"
  if (item.drillDown?.params?.threadId) {
    return {
      ...base,
      kind: 'thread',
      threadId: item.drillDown.params.threadId,
      ...(item.drillDown.params.messageId ? { messageId: item.drillDown.params.messageId } : {}),
    };
  }

  // Non-thread evidence kinds → path-based anchor (AC-B2: 路径/URL/编号)
  if (item.kind === 'doc' || item.kind === 'feature' || item.kind === 'github') {
    return { ...base, kind: item.kind, path: item.anchor };
  }

  // Thread anchor from prefix
  if (item.anchor.startsWith('thread-')) {
    return { ...base, kind: 'thread', threadId: item.anchor.slice('thread-'.length) };
  }

  // Fallback: unknown kind with path
  return { ...base, kind: 'unknown', path: item.anchor };
}

// ---------------------------------------------------------------------------
// Parent plan propagation
// ---------------------------------------------------------------------------

async function propagatePlanStatus(
  triagePlanStore: IConciergeTriagePlanStore | undefined,
  triagePlanId: string,
  status: 'completed' | 'failed' | 'cancelled',
  log: ConciergeWorkerLog,
): Promise<void> {
  if (!triagePlanStore) return;
  try {
    await triagePlanStore.updateStatus(triagePlanId, status);
  } catch (err) {
    // Best-effort: plan propagation failure must not mask job outcome
    log.warn(`Failed to propagate status to parent TriagePlan: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

export interface ExecuteInvestigationOptions {
  jobId: string;
  jobStore: IConciergeInvestigationJobStore;
  evidenceStore?: ConciergeEvidenceStore;
  /** Optional: propagate job terminal state to parent TriagePlan */
  triagePlanStore?: IConciergeTriagePlanStore;
  /** Optional logger（缺省 console）。 */
  log?: ConciergeWorkerLog;
}

/**
 * Execute a single investigation job. Designed to be called fire-and-forget.
 * Never throws — all errors are caught and result in job → failed transition.
 */
export async function executeInvestigation(opts: ExecuteInvestigationOptions): Promise<void> {
  const { jobId, jobStore, evidenceStore, triagePlanStore, log = fallbackLog } = opts;

  // 1. Fetch job
  const job = await jobStore.get(jobId);
  if (!job) {
    log.warn(`InvestigationJob not found, skipping (jobId=${jobId})`);
    return;
  }

  // 2. Check deadline before even trying to claim
  if (isJobExpired(job)) {
    const expired = await jobStore.claimTransition(jobId, job.status, 'cancelled');
    if (expired) await propagatePlanStatus(triagePlanStore, job.triagePlanId, 'cancelled', log);
    log.info(`InvestigationJob expired before execution, cancelled (jobId=${jobId})`);
    return;
  }

  // 3. Claim queued → running (CAS — if another worker or cancel won, we bail)
  const claimed = await jobStore.claimTransition(jobId, 'queued', 'running');
  if (!claimed) {
    log.info(`InvestigationJob claim failed (already running/cancelled, jobId=${jobId})`);
    return;
  }

  try {
    // 4. Execute search
    let items: ConciergeEvidenceItem[] = [];
    if (evidenceStore) {
      items = await evidenceStore.search(job.query, {
        limit: 10,
        scope: 'all',
        mode: 'hybrid',
        depth: 'raw',
      });
    }

    // 4b. Post-search deadline recheck (INV I3 fail-closed — cloud P1)
    if (isJobExpired(job)) {
      const expired = await jobStore.claimTransition(jobId, 'running', 'cancelled');
      if (expired) await propagatePlanStatus(triagePlanStore, job.triagePlanId, 'cancelled', log);
      log.info(`InvestigationJob expired after search completed, cancelled (jobId=${jobId})`);
      return;
    }

    // 5. Build report
    const report = buildReport(job.query, items);

    // 6. Atomic CAS + report write (INV I2: done ⇒ report).
    const transitioned = await jobStore.claimDoneWithReport(jobId, report);
    if (transitioned) {
      await propagatePlanStatus(triagePlanStore, job.triagePlanId, 'completed', log);
      // KD-23: No HandleMapStore sync needed. Investigation report anchors are
      // rendered directly by InvestigationReportCard (which uses report.anchors).
      // The reply validator now uses per-invocation handle tables from
      // buildConciergeSearchContext — zero shared mutable state.
      log.info(`InvestigationJob completed (jobId=${jobId}, anchorCount=${report.anchors.length})`);
    } else {
      log.warn(`InvestigationJob was cancelled during execution, report discarded (jobId=${jobId})`);
    }
  } catch (err) {
    log.error(`InvestigationJob execution failed: ${String(err)} (jobId=${jobId})`);
    // CAS: only transition if still running — cancelled takes precedence
    const failedOk = await jobStore.claimTransition(jobId, 'running', 'failed');
    if (failedOk) await propagatePlanStatus(triagePlanStore, job.triagePlanId, 'failed', log);
  }
}

function buildReport(query: string, items: ConciergeEvidenceItem[]): InvestigationReport {
  if (items.length === 0) {
    return {
      summary: `关于「${query}」没有找到相关记录。`,
      anchors: [],
    };
  }

  const anchors = items.map((item, i) => evidenceToAnchor(item, i));
  const summaryParts = anchors.map((a) => {
    switch (a.kind) {
      case 'thread':
        return `[跳过去 ${a.handle}] ${a.title}`;
      case 'doc':
        return `[查看 ${a.handle}] ${a.path ?? a.title}`;
      case 'feature':
        return `[${a.handle}] ${a.title}`;
      case 'github':
        return `[链接 ${a.handle}] ${a.title}`;
      default:
        return `[${a.handle}] ${a.title}`;
    }
  });
  const summary = `关于「${query}」找到 ${anchors.length} 条相关记录：\n${summaryParts.join('\n')}`;

  return { summary, anchors };
}
