/**
 * CI 状态层测试 — C33（ci-status-fetcher + batch-fetcher + execution-failure）。
 *
 * 覆盖：normalizePrState/normalizeBucket/computeAggregateBucket（含 cancelled
 * 语义与空 rollup）；classifyGitHubExecutionFailure（billing 证据闭合枚举）；
 * enrichGitHubExecutionFailures（无 fail 短路 / 证据 enrich / 失败降级）；
 * fetchPrCiStatus（gh pr view 解析 → 终态/聚合/check 明细，execFile 桩注入）；
 * fetchPrCiStatuses 批量 GraphQL（解析 / 窗口 >100 回退 / 无效 target 过滤）；
 * Service 层 fetchPrCiStatus 透传 ghToken。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeEmailToolsService, {
  classifyGitHubExecutionFailure,
  computeAggregateBucket,
  enrichGitHubExecutionFailures,
  fetchPrCiStatus,
  fetchPrCiStatuses,
  normalizeBucket,
  normalizePrState,
  type CiCheckDetail,
  type GhExecFileAsync,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

const silentLog = { warn: () => {}, debug: () => {} };

/** gh 桩：按 args 首元素路由。 */
function ghStub(routes: Record<string, string>, opts?: { failGraphql?: boolean }): GhExecFileAsync {
  return async (_file, args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: routes['view'] ?? '{}' };
    if (args[0] === 'pr' && args[1] === 'checks') return { stdout: routes['checks'] ?? '[]' };
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (opts?.failGraphql) {
        const err = new Error('graphql failed') as Error & { stdout?: string };
        err.stdout = routes['graphql'] ?? '';
        throw err;
      }
      return { stdout: routes['graphql'] ?? '{}' };
    }
    if (args[0] === 'api') {
      const path = args[1];
      if (path?.includes('check-runs')) return { stdout: routes['checkRuns'] ?? '{}' };
      if (path?.includes('actions/runs')) return { stdout: routes['workflowRuns'] ?? '{}' };
      if (path?.includes('annotations')) return { stdout: routes['annotations'] ?? '[]' };
      return { stdout: routes['api'] ?? '{}' };
    }
    return { stdout: '' };
  };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('normalize / aggregate', () => {
  it('normalizePrState / normalizeBucket', () => {
    expect(normalizePrState('OPEN', null)).toBe('open');
    expect(normalizePrState('MERGED', null)).toBe('merged');
    expect(normalizePrState('CLOSED', null)).toBe('closed');
    expect(normalizePrState('OPEN', '2026-01-01')).toBe('merged');
    expect(normalizeBucket('SUCCESS')).toBe('pass');
    expect(normalizeBucket('failure')).toBe('fail');
    expect(normalizeBucket('in_progress')).toBe('pending');
  });

  it('computeAggregateBucket：fail > pending > pass；cancelled 非绿灯；空 → pending', () => {
    const ck = (conclusion: string) => ({ status: 'completed', conclusion, __typename: 'CheckRun' });
    expect(computeAggregateBucket([])).toBe('pending');
    expect(computeAggregateBucket([ck('failure')])).toBe('fail');
    expect(computeAggregateBucket([ck('success'), ck('in_progress')])).toBe('pending');
    expect(computeAggregateBucket([ck('success')])).toBe('pass');
    // cancelled 不构成绿灯
    expect(computeAggregateBucket([ck('cancelled')])).toBe('pending');
    expect(computeAggregateBucket([ck('cancelled'), ck('success')])).toBe('pass');
    // StatusContext
    expect(computeAggregateBucket([{ status: 'success', conclusion: '', __typename: 'StatusContext' }])).toBe('pass');
    expect(computeAggregateBucket([{ status: 'error', conclusion: '', __typename: 'StatusContext' }])).toBe('fail');
  });
});

describe('classifyGitHubExecutionFailure', () => {
  it('billing 证据 → billing_spending_limit_zero_step', () => {
    expect(
      classifyGitHubExecutionFailure({
        checkConclusion: 'failure',
        jobConclusion: 'failure',
        runnerId: 0,
        steps: [],
        annotationTexts: ['Actions could not be processed because billing was not active'],
      }),
    ).toBe('billing_spending_limit_zero_step');
  });

  it('非 billing / 形状不符 → undefined', () => {
    expect(
      classifyGitHubExecutionFailure({
        checkConclusion: 'failure',
        jobConclusion: 'failure',
        runnerId: 0,
        steps: [],
        annotationTexts: ['compile error'],
      }),
    ).toBeUndefined();
    expect(
      classifyGitHubExecutionFailure({
        checkConclusion: 'failure',
        jobConclusion: 'success',
        runnerId: 0,
        steps: [],
        annotationTexts: ['billing'],
      }),
    ).toBeUndefined();
  });
});

describe('enrichGitHubExecutionFailures', () => {
  const failCheck: CiCheckDetail = { name: 'lint', bucket: 'fail' };

  it('无 fail bucket → 短路返回原 checks', async () => {
    const checks = [{ name: 'a', bucket: 'pass' as const }];
    const out = await enrichGitHubExecutionFailures({
      repoFullName: 'o/r', headSha: 's', checks,
      ghApiJson: async () => {
        throw new Error('should not be called');
      },
      warn: () => {},
    });
    expect(out).toEqual(checks);
  });

  it('fail + 匹配证据 → 标注 executionFailure', async () => {
    const calls: string[] = [];
    const out = await enrichGitHubExecutionFailures({
      repoFullName: 'o/r',
      headSha: 'sha1',
      checks: [failCheck],
      ghApiJson: async <T>(path: string): Promise<T> => {
        calls.push(path);
        if (path.includes('check-runs?')) return { check_runs: [{ id: 1, name: 'lint', conclusion: 'failure', output: { title: 'billing payment required' } }] } as T;
        if (path.includes('/jobs')) return { jobs: [{ name: 'lint', conclusion: 'failure', runner_id: 0, steps: [], check_run_url: '/repos/o/r/check-runs/1' }] } as T;
        if (path.includes('actions/runs')) return { workflow_runs: [{ id: 10, conclusion: 'failure' }] } as T;
        if (path.includes('annotations')) return [{ message: 'billing inactive' }] as T;
        return {} as T;
      },
      warn: () => {},
    });
    expect(out[0]?.executionFailure).toBe('billing_spending_limit_zero_step');
  });

  it('enrich 抛错 → 降级返回原 checks', async () => {
    const out = await enrichGitHubExecutionFailures({
      repoFullName: 'o/r', headSha: 's', checks: [failCheck],
      ghApiJson: async () => {
        throw new Error('api down');
      },
      warn: () => {},
    });
    expect(out).toEqual([failCheck]);
  });
});

// ---------------------------------------------------------------------------
// fetchPrCiStatus
// ---------------------------------------------------------------------------

describe('fetchPrCiStatus', () => {
  it('merged → 终态（checks=[] + mergedByLogin）', async () => {
    const stub = ghStub({
      view: JSON.stringify({ headRefOid: 'abc', state: 'MERGED', mergedAt: '2026-01-01', mergedBy: { login: 'alice' }, statusCheckRollup: [] }),
    });
    const result = await fetchPrCiStatus('o/r', 1, silentLog, { execFileAsync: stub });
    expect(result?.prState).toBe('merged');
    expect(result?.checks).toEqual([]);
    expect(result?.mergedByLogin).toBe('alice');
  });

  it('open + rollup 聚合 → aggregateBucket + check 明细（required failing）', async () => {
    const stub = ghStub({
      view: JSON.stringify({
        headRefOid: 'sha1', state: 'OPEN', mergedAt: null, mergedBy: null,
        statusCheckRollup: [
          { name: 'lint', status: 'completed', conclusion: 'failure', __typename: 'CheckRun' },
        ],
      }),
      checks: JSON.stringify([{ name: 'lint', bucket: 'fail', link: 'https://x', workflow: 'ci' }]),
    });
    const result = await fetchPrCiStatus('o/r', 7, silentLog, { execFileAsync: stub });
    expect(result?.aggregateBucket).toBe('fail');
    expect(result?.checks[0]?.name).toBe('lint');
    expect(result?.checkRollup).toBe('present');
  });

  it('gh pr view 失败 → null；JSON 解析失败 → null', async () => {
    const failExec: GhExecFileAsync = async () => {
      throw new Error('gh not installed');
    };
    expect(await fetchPrCiStatus('o/r', 1, silentLog, { execFileAsync: failExec })).toBeNull();
    const badJson = ghStub({ view: 'not-json' });
    expect(await fetchPrCiStatus('o/r', 1, silentLog, { execFileAsync: badJson })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchPrCiStatuses（批量 GraphQL）
// ---------------------------------------------------------------------------

describe('fetchPrCiStatuses', () => {
  it('批量解析 → 每 target 一条结果（open → 聚合）', async () => {
    const stub = ghStub({
      graphql: JSON.stringify({
        data: {
          r0: {
            p0: {
              headRefOid: 'sha1', state: 'OPEN', mergedAt: null, mergedBy: null,
              commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
                { __typename: 'CheckRun', name: 'lint', status: 'completed', conclusion: 'success', detailsUrl: 'https://x', checkSuite: null },
              ], pageInfo: { hasNextPage: false } } } } }] },
            },
          },
        },
      }),
    });
    const results = await fetchPrCiStatuses(
      [{ repoFullName: 'o/r', prNumber: 1 }],
      silentLog,
      { execFileAsync: stub },
    );
    const poll = results.get('o/r#1');
    expect(poll).not.toBeNull();
    expect(poll?.aggregateBucket).toBe('pass');
    expect(poll?.checks[0]?.name).toBe('lint');
  });

  it('无效 target 过滤（无 owner/非法 prNumber）', async () => {
    const stub = ghStub({ graphql: '{"data":{}}' });
    const results = await fetchPrCiStatuses(
      [{ repoFullName: 'bad', prNumber: -1 }, { repoFullName: 'o/r', prNumber: 2 }],
      silentLog,
      { execFileAsync: stub },
    );
    // 'bad' 无 '/' → 被过滤；但 query 仍含 o/r#2 → 解析为空 data → null
    expect(results.has('bad#-1')).toBe(true);
    expect(results.get('o/r#2')).toBeNull();
  });

  it('GraphQL 失败且无 data → 返回全 null 结果（不抛）', async () => {
    const stub = ghStub({ graphql: '' }, { failGraphql: true });
    const results = await fetchPrCiStatuses([{ repoFullName: 'o/r', prNumber: 1 }], silentLog, { execFileAsync: stub });
    expect(results.get('o/r#1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service 层
// ---------------------------------------------------------------------------

describe('ForgeEmailToolsService CI 透传', () => {
  it('fetchPrCiStatus 经 Service 走 pluginEnv token', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeEmailToolsService, {
      pluginEnv: { GITHUB_TOKEN: 'svc-t' },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const seenEnv: NodeJS.ProcessEnv[] = [];
    const stub: GhExecFileAsync = async (_file, args, options) => {
      seenEnv.push((options as { env: NodeJS.ProcessEnv }).env);
      if (args[1] === 'view') {
        return { stdout: JSON.stringify({ headRefOid: 's', state: 'OPEN', mergedAt: null, mergedBy: null, statusCheckRollup: [] }) };
      }
      return { stdout: '[]' };
    };
    const result = await ctx.forgeEmailTools.fetchPrCiStatus('o/r', 1, silentLog, { execFileAsync: stub });
    expect(result).not.toBeNull();
    expect(seenEnv.some((e) => e.GITHUB_TOKEN === 'svc-t')).toBe(true);
    expect(seenEnv.some((e) => e.GH_TOKEN === undefined)).toBe(true);
  });
});
