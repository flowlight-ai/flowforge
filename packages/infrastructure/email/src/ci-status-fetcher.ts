/**
 * #320: 独立 CI 状态获取器（纯 gh CLI 调用 — 无 store 依赖）。
 *
 * CI bucket/state 解释的单一事实源，CiCdCheckTaskSpec 消费。
 * TS 移植自 clowder-ai `infrastructure/email/ci-status-fetcher.ts`。
 *
 * 插件化改造：clowder 直接 execFile → 经 `infrastructure-github`
 * buildGhCliEnv/withHiddenGhCliWindow（token 解析 + Windows 隐藏控制台）。
 */

import type { CiBucket, CiCheckDetail, CiPollResult } from './index.ts';
import { buildGhCliEnv, withHiddenGhCliWindow } from '@flowforge/infrastructure-github';
import { enrichGitHubExecutionFailures } from './ci-execution-failure.ts';

export { classifyGitHubExecutionFailure, type GitHubExecutionFailureEvidence } from './ci-execution-failure.ts';

const GH_TIMEOUT_MS = 15_000;

export type GhExecFileAsync = (file: string, args: readonly string[], options: unknown) => Promise<{ stdout: string }>;

export interface FetchPrCiStatusOptions {
  readonly ghToken?: string;
  /** Scheduler cancellation for every gh process in this poll generation. */
  readonly signal?: AbortSignal;
  /** Test seam at the real gh JSON boundary; production always uses node:child_process. */
  readonly execFileAsync?: GhExecFileAsync;
}

export interface MinimalLog {
  warn: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

/** 执行 gh 子进程（signal 中止传播 + windowsHide）。 */
export async function executeGh(args: readonly string[], options: FetchPrCiStatusOptions): Promise<{ stdout: string }> {
  options.signal?.throwIfAborted();
  const execute = options.execFileAsync ?? defaultExecFileAsync;
  return execute(
    'gh',
    args,
    withHiddenGhCliWindow({
      timeout: GH_TIMEOUT_MS,
      env: buildGhCliEnv({ token: options.ghToken ?? null }),
      signal: options.signal,
    }),
  );
}

async function defaultExecFileAsync(file: string, args: readonly string[], options: unknown): Promise<{ stdout: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile) as unknown as (
    file: string,
    args: readonly string[],
    options: unknown,
  ) => Promise<{ stdout: string }>;
  return execFileAsync(file, args, options);
}

export async function ghApiJson<T>(path: string, options: FetchPrCiStatusOptions): Promise<T> {
  const { stdout } = await executeGh(['api', path], options);
  return JSON.parse(stdout) as T;
}

export function normalizePrState(state: string, mergedAt: string | null): 'open' | 'merged' | 'closed' {
  if (mergedAt || state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return 'open';
}

export function normalizeBucket(bucket: string): CiBucket {
  const lower = bucket.toLowerCase();
  if (lower === 'pass' || lower === 'success') return 'pass';
  if (lower === 'fail' || lower === 'failure' || lower === 'error') return 'fail';
  return 'pending';
}

export function computeAggregateBucket(
  rollup: Array<{ status: string; conclusion: string; __typename: string }>,
): CiBucket {
  // 单个空 rollup 有歧义：GitHub 可能尚未为新 HEAD 创建 check run。
  // CiCdRouter 持有所在 same-HEAD 稳定性守卫，最终把真正的空 rollup 提升为 pass。
  if (rollup.length === 0) return 'pending';
  let hasFailure = false;
  let hasPending = false;
  let hasSuccess = false; // 至少一个真实正向结果（success/skipped/neutral）
  for (const item of rollup) {
    if (item.__typename === 'StatusContext') {
      const state = item.status?.toLowerCase();
      if (state === 'failure' || state === 'error') hasFailure = true;
      else if (state === 'success') hasSuccess = true;
      else hasPending = true; // pending / expected
    } else {
      const conclusion = item.conclusion?.toLowerCase();
      // 'cancelled' 是被 superseded/aborted 的非结果：既非 failure 也非 success
      // （GitHub 的成功态是 success/skipped/neutral，不含 cancelled）。
      if (conclusion === 'failure' || conclusion === 'timed_out') hasFailure = true;
      else if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral') hasSuccess = true;
      else if (conclusion !== 'cancelled') hasPending = true; // in-progress / no conclusion / unknown
    }
  }
  if (hasFailure) return 'fail';
  if (hasPending) return 'pending';
  return hasSuccess ? 'pass' : 'pending'; // 仅 cancelled / 无正向结果 → 不放行绿灯
}

/**
 * 拉取单个 PR 的 CI 状态。merged/closed → 终态（checks=[]）。
 * open → rollup 聚合 + fail/pass 时取 check 明细 + typed 证据 enrich。
 */
export async function fetchPrCiStatus(
  repoFullName: string,
  prNumber: number,
  log: MinimalLog,
  options: FetchPrCiStatusOptions = {},
): Promise<CiPollResult | null> {
  let prViewJson: string;
  try {
    const { stdout } = await executeGh(
      ['pr', 'view', String(prNumber), '-R', repoFullName, '--json', 'headRefOid,state,mergedAt,mergedBy,statusCheckRollup'],
      options,
    );
    prViewJson = stdout;
  } catch (err) {
    options.signal?.throwIfAborted();
    log.warn(`[ci-status] gh pr view failed for ${repoFullName}#${prNumber}: ${String(err)}`);
    return null;
  }

  let prView: {
    headRefOid: string;
    state: string;
    mergedAt: string | null;
    mergedBy: { login: string } | null;
    statusCheckRollup: Array<{ name: string; status: string; conclusion: string; __typename: string }>;
  };
  try {
    prView = JSON.parse(prViewJson);
  } catch {
    log.warn(`[ci-status] Failed to parse gh pr view output for ${repoFullName}#${prNumber}`);
    return null;
  }

  const prState = normalizePrState(prView.state, prView.mergedAt);
  if (prState === 'merged' || prState === 'closed') {
    return {
      repoFullName,
      prNumber,
      headSha: prView.headRefOid,
      prState,
      aggregateBucket: 'pending',
      checks: [],
      ...(prView.mergedBy?.login ? { mergedByLogin: prView.mergedBy.login } : {}),
    };
  }

  const rollup = prView.statusCheckRollup ?? [];
  const aggregateBucket = computeAggregateBucket(rollup);
  let checks: CiCheckDetail[] = [];
  if (aggregateBucket !== 'pending') {
    checks = await fetchCheckDetails(repoFullName, prNumber, prView.headRefOid, log, options);
  }
  return {
    repoFullName,
    prNumber,
    headSha: prView.headRefOid,
    prState,
    aggregateBucket,
    checkRollup: rollup.length === 0 ? 'empty' : 'present',
    checks,
  };
}

async function fetchCheckDetails(
  repoFullName: string,
  prNumber: number,
  headSha: string,
  log: MinimalLog,
  options: FetchPrCiStatusOptions,
): Promise<CiCheckDetail[]> {
  let checks = await fetchRequiredFailingChecks(repoFullName, prNumber, options);
  if (!checks) {
    try {
      checks = await fetchGhCheckDetails(repoFullName, prNumber, false, options);
    } catch (err) {
      options.signal?.throwIfAborted();
      log.warn(`[ci-status] gh pr checks failed for ${repoFullName}#${prNumber}: ${String(err)}`);
      return [];
    }
  }
  return enrichGitHubExecutionFailures({
    repoFullName,
    headSha,
    checks,
    ghApiJson: (path) => ghApiJson(path, options),
    warn: (message) => log.warn(message),
  });
}

async function fetchGhCheckDetails(
  repoFullName: string,
  prNumber: number,
  requiredOnly: boolean,
  options: FetchPrCiStatusOptions,
): Promise<CiCheckDetail[]> {
  const args = ['pr', 'checks', String(prNumber), '-R', repoFullName, '--json', 'name,bucket,link,workflow,description'];
  if (requiredOnly) args.push('--required');
  const { stdout } = await executeGh(args, options);
  const parsed = JSON.parse(stdout) as Array<{
    name: string;
    bucket: string;
    link?: string;
    workflow?: string;
    description?: string;
  }>;
  return parsed.map((check) => ({
    name: check.name,
    bucket: normalizeBucket(check.bucket),
    ...(check.link !== undefined ? { link: check.link } : {}),
    ...(check.workflow !== undefined ? { workflow: check.workflow } : {}),
    ...(check.description !== undefined ? { description: check.description } : {}),
  }));
}

/** 保留历史 `gh pr checks --required` 失败投影。 */
export async function fetchRequiredFailingChecks(
  repoFullName: string,
  prNumber: number,
  options: FetchPrCiStatusOptions,
): Promise<CiCheckDetail[] | null> {
  try {
    const checks = await fetchGhCheckDetails(repoFullName, prNumber, true, options);
    return checks.some((check) => check.bucket === 'fail') ? checks : null;
  } catch {
    options.signal?.throwIfAborted();
    return null;
  }
}
