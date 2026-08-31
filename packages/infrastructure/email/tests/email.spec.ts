/**
 * email 插件包测试 — C33（email 域核心层）。
 *
 * 覆盖：severity-parser（三格式解析 + 全扫描取最高 + 代码块/引用 FP 守卫）；
 * setup-noise-filter（bot+conversation+setup-only 三条件 + 动态 thunk）；
 * github-feedback-filter（Rule A 自反馈 + late-bound thunk）；
 * MemoryPrTrackingStore（register/get/remove/listAll + CI/Conflict 独立 patch
 * KD-7/KD-12）；ci-message-content（CI 通知 + 终态生命周期）；
 * getConnectorDeliveryTarget；Cordis 插件挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeEmailToolsService, {
  buildCiMessageContent,
  buildLifecycleMessageContent,
  createGitHubFeedbackFilter,
  createSetupNoiseFilter,
  getConnectorDeliveryTarget,
  getMaxSeverity,
  MemoryPrTrackingStore,
  parseSeverity,
  PrTrackingKeys,
  type CiPollResult,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('parseSeverity', () => {
  it('三格式：徽章 / 行首方括号 / 行首冒号', () => {
    expect(parseSeverity('![x](https://img.shields.io/badge/P1-critical-red)')).toBe('P1');
    expect(parseSeverity('[P2] 次要问题')).toBe('P2');
    expect(parseSeverity('**P0**: 崩溃')).toBe('P0');
    expect(parseSeverity('P1: 无行首锚点')).toBe('P1');
  });

  it('全扫描取最高（多严重级 body）', () => {
    // 曾因首个 regex 命中而下调（`[P2]` 先于 `**P0**:`）
    expect(parseSeverity('[P2] 次要\n\n**P0**: 崩溃')).toBe('P0');
    expect(parseSeverity('**P2**: a\n[P1] b')).toBe('P1');
  });

  it('FP 守卫：代码块 / 引用行内标记不触发', () => {
    expect(parseSeverity('```\nP0: 示例代码\n```')).toBeNull();
    expect(parseSeverity('> P1: 引用旧发现')).toBeNull();
    expect(parseSeverity('这是句子中间的 P1 不算')).toBeNull();
    expect(parseSeverity('')).toBeNull();
  });

  it('getMaxSeverity 跨 comments + decisions 聚合', () => {
    expect(getMaxSeverity([{ body: '[P2] a' }], [{ body: '**P1**: b' }])).toBe('P1');
    expect(getMaxSeverity([{ body: '无标记' }], [])).toBeNull();
  });
});

describe('createSetupNoiseFilter', () => {
  const setupBody = 'To use Codex here, create an environment for this repo.';
  const reviewBody = 'To use Codex here, create an environment for this repo.\n\ncodex review 结果如下';

  it('bot + conversation + setup-only → 噪声；含真实 review 内容 → 不抑制', () => {
    const isNoise = createSetupNoiseFilter(['codex-bot']);
    expect(isNoise({ author: 'codex-bot', body: setupBody, commentType: 'conversation' })).toBe(true);
    expect(isNoise({ author: 'codex-bot', body: reviewBody, commentType: 'conversation' })).toBe(false);
  });

  it('非 bot / 非 conversation / 无 setup 句 → 不抑制', () => {
    const isNoise = createSetupNoiseFilter(['codex-bot']);
    expect(isNoise({ author: 'human', body: setupBody, commentType: 'conversation' })).toBe(false);
    expect(isNoise({ author: 'codex-bot', body: setupBody, commentType: 'inline' })).toBe(false);
    expect(isNoise({ author: 'codex-bot', body: '普通评论', commentType: 'conversation' })).toBe(false);
  });

  it('thunk 形式支持运行时配置变更（P2-3）', () => {
    let logins: string[] = ['bot-a'];
    const isNoise = createSetupNoiseFilter(() => logins);
    expect(isNoise({ author: 'bot-a', body: setupBody, commentType: 'conversation' })).toBe(true);
    logins = ['bot-b'];
    expect(isNoise({ author: 'bot-a', body: setupBody, commentType: 'conversation' })).toBe(false);
    expect(isNoise({ author: 'bot-b', body: setupBody, commentType: 'conversation' })).toBe(true);
  });
});

describe('createGitHubFeedbackFilter', () => {
  it('Rule A：自反馈跳过；非自反馈保留', () => {
    const f = createGitHubFeedbackFilter({ selfGitHubLogin: 'me' });
    expect(f.isSelfAuthored('me')).toBe(true);
    expect(f.isSelfAuthored('other')).toBe(false);
    expect(f.shouldSkipComment({ author: 'me' })).toBe(true);
    expect(f.shouldSkipComment({ author: 'other' })).toBe(false);
    expect(f.shouldSkipReview({ author: 'me' })).toBe(true);
  });

  it('late-bound thunk 覆盖静态值（运行时凭据变更）', () => {
    let login: string | undefined = 'startup-me';
    const f = createGitHubFeedbackFilter({ selfGitHubLogin: 'stale', getSelfGitHubLogin: () => login });
    expect(f.isSelfAuthored('startup-me')).toBe(true);
    login = 'later-me';
    expect(f.isSelfAuthored('startup-me')).toBe(false);
    expect(f.isSelfAuthored('later-me')).toBe(true);
  });

  it('无 login → 过滤禁用（不做任何跳过）', () => {
    const f = createGitHubFeedbackFilter({});
    expect(f.shouldSkipComment({ author: 'anyone' })).toBe(false);
  });
});

describe('MemoryPrTrackingStore', () => {
  function input(prNumber = 1, repo = 'o/r'): import('../src/index.ts').PrTrackingInput {
    return { repoFullName: repo, prNumber, catId: 'cat-a', threadId: 't1', userId: 'u1' };
  }

  it('register → get → listAll → remove', () => {
    const store = new MemoryPrTrackingStore();
    store.register(input(1));
    store.register(input(2));
    // 同 repo+pr 覆盖
    store.register(input(1, 'o/r'));
    expect(store.get('o/r', 1)?.catId).toBe('cat-a');
    expect(store.get('o/r', 9)).toBeNull();
    expect(store.listAll().length).toBe(2);
    // listAll 按 registeredAt 倒序
    expect(store.listAll()[0]?.registeredAt).toBeGreaterThanOrEqual(store.listAll()[1]!.registeredAt);
    expect(store.remove('o/r', 1)).toBe(true);
    expect(store.remove('o/r', 1)).toBe(false);
    expect(store.listAll().length).toBe(1);
  });

  it('KD-7 / KD-12：CI 与 Conflict 状态域独立 patch，不动 registeredAt', () => {
    const store = new MemoryPrTrackingStore();
    const entry = store.register(input());
    store.patchCiState('o/r', 1, { headSha: 'abc123', lastCiBucket: 'fail', ciTrackingEnabled: true });
    store.patchConflictState('o/r', 1, { mergeState: 'dirty', lastConflictFingerprint: 'fp1' });

    const after = store.get('o/r', 1)!;
    expect(after.registeredAt).toBe(entry.registeredAt);
    expect(after.headSha).toBe('abc123');
    expect(after.lastCiBucket).toBe('fail');
    expect(after.ciTrackingEnabled).toBe(true);
    expect(after.mergeState).toBe('dirty');
    expect(after.lastConflictFingerprint).toBe('fp1');
    // patch 不清 CI 状态，反之亦然
    store.patchConflictState('o/r', 1, { mergeState: 'clean' });
    expect(store.get('o/r', 1)!.lastCiBucket).toBe('fail');
  });

  it('patch 未登记条目为空操作', () => {
    const store = new MemoryPrTrackingStore();
    store.patchCiState('o/r', 404, { headSha: 'x' });
    expect(store.get('o/r', 404)).toBeNull();
  });

  it('PrTrackingKeys 键格式', () => {
    expect(PrTrackingKeys.detail('o/r', 7)).toBe('pr-tracking:o/r#7');
    expect(PrTrackingKeys.all()).toBe('pr-tracking:all');
  });
});

describe('ci-message-content', () => {
  const poll: CiPollResult = {
    repoFullName: 'o/r',
    prNumber: 42,
    headSha: 'abcdef1234567890',
    prState: 'open',
    aggregateBucket: 'fail',
    checks: [
      { name: 'lint', bucket: 'fail' },
      { name: 'test', bucket: 'pass' },
    ],
  };

  it('CI 通知含 bucket + 失败数 + 短 sha', () => {
    const content = buildCiMessageContent(poll);
    expect(content).toContain('o/r#42');
    expect(content).toContain('CI fail (1 blockers)');
    expect(content).toContain('abcdef1');
  });

  it('终态：merged 与 closed 文案分支', () => {
    const merged = buildLifecycleMessageContent({ repoFullName: 'o/r', prNumber: 42, prState: 'merged' });
    expect(merged).toContain('已 merge');
    expect(merged).toContain('post-merge 收尾');
    const closed = buildLifecycleMessageContent({ repoFullName: 'o/r', prNumber: 42, prState: 'closed' });
    expect(closed).toContain('未合并');
    expect(closed).not.toContain('post-merge 收尾');
  });
});

describe('getConnectorDeliveryTarget', () => {
  it('缺失 userId/ownerCatId → 空串填充', () => {
    expect(getConnectorDeliveryTarget({ threadId: 't', userId: 'u', ownerCatId: 'c' })).toEqual({
      threadId: 't', userId: 'u', catId: 'c',
    });
    expect(getConnectorDeliveryTarget({ threadId: 't', ownerCatId: null })).toEqual({
      threadId: 't', userId: '', catId: '',
    });
  });
});

describe('ForgeEmailToolsService（Cordis 插件）', () => {
  it('挂载 ctx.forgeEmailTools + 过滤器 + store 协同', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeEmailToolsService, {
      setupNoiseBotLogins: ['codex-bot'],
      selfGitHubLogin: 'me',
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeEmailTools;
    expect(svc).toBeDefined();
    expect(svc.isSetupNoise({ author: 'codex-bot', body: 'To use Codex here, create an environment for this repo.', commentType: 'conversation' })).toBe(true);
    expect(svc.feedbackFilter.isSelfAuthored('me')).toBe(true);
    expect(parseSeverity('**P0**: x')).toBe('P0');

    svc.prTracking.register({ repoFullName: 'o/r', prNumber: 1, catId: 'c', threadId: 't', userId: 'u' });
    svc.prTracking.patchCiState('o/r', 1, { headSha: 'sha1' });
    expect(svc.prTracking.get('o/r', 1)?.headSha).toBe('sha1');
  });
});
