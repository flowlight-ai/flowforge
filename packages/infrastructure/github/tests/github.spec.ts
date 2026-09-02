/**
 * github 插件包测试 — C33 gh CLI 工具。
 *
 * 覆盖：token 解析优先级 + env 构建（GH_TOKEN 剥离 + token 注入）+
 * windowsHide；fetchPaginated 逐页（stub execFile）+ sinceId 过滤 +
 * 空页终止 + 尾页终止；maxGithubId / fetchLatestIssueCommentCursor；
 * self-login resolver（配置优先 / 指纹缓存 / in-flight 去重）；
 * Cordis 插件挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeGithubToolsService, {
  buildGhCliEnv,
  createGitHubSelfLoginResolver,
  fetchLatestIssueCommentCursor,
  fetchPaginated,
  maxGithubId,
  resolveGhCliToken,
  withHiddenGhCliWindow,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('gh-cli-env', () => {
  it('token 解析：pluginEnv 显式优先 → GH_TOKEN → GITHUB_TOKEN', () => {
    expect(resolveGhCliToken({ pluginEnv: { GITHUB_TOKEN: 'plugin-t' }, baseEnv: { GH_TOKEN: 'env-t' } })).toBe('plugin-t');
    expect(resolveGhCliToken({ baseEnv: { GH_TOKEN: 'gh-t', GITHUB_TOKEN: 'ghub-t' } })).toBe('gh-t');
    expect(resolveGhCliToken({ baseEnv: { GITHUB_TOKEN: 'ghub-t' } })).toBe('ghub-t');
    // pluginEnv 显式空值（hasOwn）覆盖 env
    expect(resolveGhCliToken({ pluginEnv: { GITHUB_TOKEN: '' }, baseEnv: { GH_TOKEN: 'env-t' } })).toBeUndefined();
    expect(resolveGhCliToken({})).toBeUndefined();
  });

  it('env 构建：剥 GH_TOKEN + 条件注入 GITHUB_TOKEN', () => {
    const env = buildGhCliEnv({ token: 'tok', baseEnv: { GH_TOKEN: 'ambient', PATH: 'x' } });
    expect(env.GITHUB_TOKEN).toBe('tok');
    expect(env.GH_TOKEN).toBeUndefined();
    const noToken = buildGhCliEnv({ baseEnv: { GITHUB_TOKEN: 'ambient' } });
    expect(noToken.GITHUB_TOKEN).toBeUndefined();
    expect(withHiddenGhCliWindow({ timeout: 1 })).toMatchObject({ timeout: 1, windowsHide: true });
  });
});

describe('fetchPaginated', () => {
  function stubExec(pages: string[][]) {
    let page = 0;
    return async () => {
      const lines = pages[page] ?? [];
      page++;
      return { stdout: lines.join('\n') };
    };
  }

  it('逐页收集 + 尾页（<100）终止', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => JSON.stringify({ id: i + 1 }));
    const page2 = [JSON.stringify({ id: 101 })];
    const items = await fetchPaginated('/repos/x/y/issues/1/comments', {
      execFileAsync: stubExec([page1, page2]),
    });
    expect(items.length).toBe(101);
  });

  it('sinceId 过滤 + 空页终止', async () => {
    const page1 = [JSON.stringify({ id: 5 }), JSON.stringify({ id: 9 }), JSON.stringify({ id: 3 })];
    const items = await fetchPaginated('/repos/x/y/issues/1/comments', {
      sinceId: 4,
      execFileAsync: stubExec([page1, []]),
    });
    expect(items.map((i) => i.id)).toEqual([5, 9]);
  });
});

describe('comment-cursors', () => {
  it('maxGithubId 取最大数值 id；非数值忽略', () => {
    expect(maxGithubId([{ id: 3 }, { id: 10 }, { id: 'x' }, {}])).toBe(10);
    expect(maxGithubId([])).toBe(0);
  });

  it('fetchLatestIssueCommentCursor 走注入 fetcher', async () => {
    const cursor = await fetchLatestIssueCommentCursor('o/r', 7, {
      fetcher: async () => [{ id: 1 }, { id: 42 }],
    });
    expect(cursor).toBe(42);
  });
});

describe('createGitHubSelfLoginResolver', () => {
  it('配置 login 显式优先', async () => {
    const resolver = createGitHubSelfLoginResolver({
      getConfiguredLogin: () => 'configured',
      getTokenFingerprint: () => 'fp1',
      resolveLogin: async () => 'resolved',
    });
    expect(await resolver.refreshIfNeeded()).toBe('configured');
  });

  it('指纹缓存：同指纹不重复解析；in-flight 去重', async () => {
    let calls = 0;
    const resolver = createGitHubSelfLoginResolver({
      getTokenFingerprint: () => 'fp1',
      resolveLogin: async () => {
        calls++;
        return 'login-a';
      },
    });
    expect(resolver.getCurrent()).toBeUndefined();
    const [a, b] = await Promise.all([resolver.refreshIfNeeded(), resolver.refreshIfNeeded()]);
    expect(a).toBe('login-a');
    expect(b).toBe('login-a');
    expect(calls).toBe(1);
    // 同指纹缓存命中
    await resolver.refreshIfNeeded();
    expect(calls).toBe(1);
  });

  it('指纹变化触发重新解析；解析失败清缓存', async () => {
    let fp = 'fp1';
    let fail = false;
    let calls = 0;
    const resolver = createGitHubSelfLoginResolver({
      getTokenFingerprint: () => fp,
      resolveLogin: async () => {
        calls++;
        if (fail) throw new Error('boom');
        return 'login-a';
      },
    });
    expect(await resolver.refreshIfNeeded()).toBe('login-a');
    fp = 'fp2';
    expect(await resolver.refreshIfNeeded()).toBe('login-a');
    expect(calls).toBe(2);
    fail = true;
    fp = 'fp3';
    expect(await resolver.refreshIfNeeded()).toBeUndefined();
    expect(resolver.getCurrent()).toBeUndefined();
  });
});

describe('ForgeGithubToolsService（Cordis 插件）', () => {
  it('挂载 ctx.forgeGithubTools + resolveToken + createSelfLoginResolver', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGithubToolsService, {
      pluginEnv: { GITHUB_TOKEN: 'svc-t' },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeGithubTools;
    expect(svc).toBeDefined();
    expect(svc.resolveToken()).toBe('svc-t');
    expect(svc.buildEnv('x').GITHUB_TOKEN).toBe('x');

    const resolver = svc.createSelfLoginResolver({
      getTokenFingerprint: () => 'fp',
      resolveLogin: async () => 'me',
    });
    expect(await resolver.refreshIfNeeded()).toBe('me');

    const items = await svc.fetchPaginated('/repos/x/y/issues/1/comments', {
      execFileAsync: async () => ({ stdout: JSON.stringify({ id: 1 }) }),
    });
    expect(items.length).toBe(1);
  });
});
