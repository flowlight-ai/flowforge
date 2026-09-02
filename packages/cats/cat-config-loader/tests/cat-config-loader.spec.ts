/**
 * cats-cat-config-loader 测试 — C38/C40。
 *
 * 覆盖：schema v1/v2 解析 + 后置校验（defaultVariantId/mentionPatterns）；
 * deepMergeConfig（原子键/递归/数组按键合并）；loader（模板+catalog overlay、
 * 模板 breed 过滤、显式文件）；accessors（roster/coCreator/sessionChain）；
 * runtime-json（accounts/capabilities 校验读写 + 缺失 null）；Service。
 */

import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import CatConfigLoaderService, {
  RuntimeJsonStore,
  deepMergeConfig,
  getCoCreatorMentionPatterns,
  getReviewPolicy,
  isCatAvailable,
  isCatLead,
  isSessionChainEnabled,
  loadResolvedCatConfig,
  parseCatConfig,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

const TEMPLATE_JSON = JSON.stringify({
  version: 2,
  breeds: [
    {
      id: 'ragdoll',
      relationshipKey: 'ragdoll',
      catId: 'opus',
      name: 'Ragdoll',
      displayName: '布偶',
      avatar: 'cat.png',
      color: { primary: '#fff', secondary: '#000' },
      mentionPatterns: ['@ragdoll', '@布偶'],
      roleDescription: 'architect',
      defaultVariantId: 'opus',
      variants: [
        {
          id: 'opus',
          catId: 'opus',
          clientId: 'anthropic',
          defaultModel: 'claude-sonnet',
          mcpSupport: true,
          cli: { command: 'claude', outputFormat: 'json' },
          mentionPatterns: ['@ragdoll', '@布偶'],
        },
      ],
      features: { sessionChain: true },
    },
  ],
  roster: { opus: { family: 'ragdoll', roles: ['architect'], lead: true, available: true, evaluation: 'x' } },
  reviewPolicy: {
    requireDifferentFamily: true,
    preferActiveInThread: true,
    preferLead: true,
    excludeUnavailable: true,
  },
});

const CATALOG_JSON = JSON.stringify({
  breeds: [
    {
      id: 'ragdoll',
      catId: 'opus',
      variants: [
        {
          id: 'opus',
          catId: 'opus',
          clientId: 'anthropic',
          defaultModel: 'claude-opus',
          mcpSupport: true,
        },
        {
          id: 'opus-pro',
          catId: 'opus-pro',
          clientId: 'anthropic',
          defaultModel: 'claude-opus-4',
          mcpSupport: true,
        },
      ],
    },
  ],
  roster: {
    opus: { family: 'ragdoll', roles: ['architect'], lead: true, available: true, evaluation: 'x' },
    'opus-pro': { family: 'ragdoll', roles: ['architect'], lead: false, available: true, evaluation: 'x' },
  },
});

describe('parseCatConfig', () => {
  it('v2 配置解析通过', () => {
    const config = parseCatConfig(TEMPLATE_JSON);
    expect(config.version).toBe(2);
    if (config.version === 2) {
      expect(config.breeds[0]?.defaultVariantId).toBe('opus');
      expect(config.roster.opus?.available).toBe(true);
    }
  });

  it('defaultVariantId 未命中 → 抛错', () => {
    const bad = JSON.parse(TEMPLATE_JSON) as Record<string, unknown>;
    (bad.breeds as Array<{ defaultVariantId: string }>)[0]!.defaultVariantId = 'nope';
    expect(() => parseCatConfig(JSON.stringify(bad))).toThrow(/defaultVariantId "nope" not found/);
  });

  it('mentionPatterns 不以 @ 开头 → schema 拒绝', () => {
    const bad = JSON.parse(TEMPLATE_JSON) as Record<string, unknown>;
    (bad.breeds as Array<{ mentionPatterns: string[] }>)[0]!.mentionPatterns = ['ragdoll'];
    expect(() => parseCatConfig(JSON.stringify(bad))).toThrow(/Invalid cat config/);
  });

  it('legacy owner 迁移到 coCreator', () => {
    const v2 = JSON.parse(TEMPLATE_JSON) as Record<string, unknown>;
    v2.coCreator = { name: 'me', aliases: [], mentionPatterns: ['@me'] };
    v2.owner = { name: 'old', aliases: [], mentionPatterns: ['@old'] };
    const config = parseCatConfig(JSON.stringify(v2));
    expect(config.version === 2 && config.coCreator?.name).toBe('me');
  });
});

describe('deepMergeConfig', () => {
  it('原子键整替换 + 递归对象 + 原始值覆盖', () => {
    const merged = deepMergeConfig(
      { a: { x: 1, y: 2 }, cli: { command: 'claude', effort: 'max' }, list: [1, 2] },
      { a: { y: 9 }, cli: { command: 'codex' }, list: [3] },
    );
    expect(merged).toEqual({
      a: { x: 1, y: 9 },
      cli: { command: 'codex' }, // 原子键整替换，effort 不残留
      list: [3],
    });
  });

  it('id 数组按键合并（overlay 在前，base-only 追加）', () => {
    const merged = deepMergeConfig(
      { breeds: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] },
      { breeds: [{ id: 'a', v: 9 }, { id: 'c', v: 3 }] },
    );
    expect(merged.breeds).toEqual([{ id: 'a', v: 9 }, { id: 'c', v: 3 }, { id: 'b', v: 2 }]);
  });
});

describe('loadResolvedCatConfig', () => {
  it('模板 + catalog overlay：模板 model 被 catalog 覆盖、模板-only breed 剔除', () => {
    const files = new Map<string, string>([['/tpl/cat-template.json', TEMPLATE_JSON]]);
    const config = loadResolvedCatConfig({
      defaultTemplatePath: '/tpl/cat-template.json',
      readFile: (filePath) => files.get(filePath) ?? '',
      readCatalogRaw: () => CATALOG_JSON,
    });
    expect(config.version).toBe(2);
    if (config.version === 2) {
      // catalog 添加了 opus-pro variant；模板默认 variant 的 model 被 catalog 覆盖
      expect(config.breeds).toHaveLength(1);
      expect(config.breeds[0]?.variants.map((v) => v.id)).toContain('opus-pro');
      const opusVariant = config.breeds[0]?.variants.find((v) => v.id === 'opus');
      // cli 是原子键：catalog 未提供 cli → 模板 cli 保留；defaultModel 被 catalog 覆盖
      expect(opusVariant?.cli?.command).toBe('claude');
      expect(opusVariant?.defaultModel).toBe('claude-opus');
    }
  });

  it('无 catalog → 只读模板', () => {
    const config = loadResolvedCatConfig({
      defaultTemplatePath: '/tpl/cat-template.json',
      readFile: (filePath) => (filePath === '/tpl/cat-template.json' ? TEMPLATE_JSON : ''),
      readCatalogRaw: () => null,
    });
    expect(config.breeds).toHaveLength(1);
  });

  it('模板路径未配置 → 抛错', () => {
    expect(() => loadResolvedCatConfig({ env: {} })).toThrow(/not configured/);
  });
});

describe('accessors', () => {
  it('getReviewPolicy / isCatAvailable / roster 访问器（注入 cfg）', () => {
    const config = parseCatConfig(TEMPLATE_JSON);
    expect(getReviewPolicy(config).requireDifferentFamily).toBe(true);
    expect(isCatAvailable('opus', config)).toBe(true);
    expect(isCatAvailable('ghost', config)).toBe(true); // 不在 roster → 默认可用
    expect(isCatLead('opus', config)).toBe(true);
    expect(config.version === 2 && config.roster.opus?.family).toBe('ragdoll');
  });

  it('isSessionChainEnabled：variant 显式 > breed features', () => {
    const config = parseCatConfig(TEMPLATE_JSON);
    expect(isSessionChainEnabled('opus', config)).toBe(true);

    const disabled = JSON.parse(TEMPLATE_JSON) as Record<string, unknown>;
    (disabled.breeds as Array<{ features?: { sessionChain?: boolean } }>)[0]!.features = { sessionChain: false };
    const config2 = parseCatConfig(JSON.stringify(disabled));
    expect(isSessionChainEnabled('opus', config2)).toBe(false);
  });

  it('getCoCreatorMentionPatterns：未配置回落 @co-creator', () => {
    const config = parseCatConfig(TEMPLATE_JSON);
    expect(getCoCreatorMentionPatterns(config)).toContain('@co-creator');
  });
});

describe('RuntimeJsonStore', () => {
  const mem = new Map<string, string>();
  const base = '/cat-cafe';

  it('readTyped accounts：校验通过 / 缺失 null / 非法拒绝', () => {
    mem.set(join(base, 'accounts.json'), JSON.stringify([{ id: 'a1', catId: 'opus', clientId: 'anthropic' }]));
    const store = new RuntimeJsonStore(base, {
      readFile: (filePath) => mem.get(filePath) ?? null,
      writeFile: async (filePath, content) => {
        mem.set(filePath, content);
      },
    });
    const accounts = store.readTyped('accounts') as Array<{ id: string }>;
    expect(accounts[0]?.id).toBe('a1');

    expect(store.readTyped('capabilities')).toBeNull();

    mem.set(join(base, 'capabilities.json'), JSON.stringify([{ bogus: true }]));
    expect(() => store.readTyped('capabilities')).toThrow();
  });

  it('write：落盘 JSON + 可回读', async () => {
    const store = new RuntimeJsonStore(base, {
      readFile: (filePath) => mem.get(filePath) ?? null,
      writeFile: async (filePath, content) => {
        mem.set(filePath, content);
      },
    });
    const target = await store.write('user-preferences', { preferredCats: ['opus'], timeZone: 'Asia/Shanghai' });
    expect(target).toBe(join(base, 'user-preferences.json'));
    const parsed = JSON.parse(mem.get(target) ?? '{}') as { preferredCats: string[] };
    expect(parsed.preferredCats).toEqual(['opus']);
  });
});

describe('CatConfigLoaderService（Cordis 插件）', () => {
  it('挂载 ctx.forgeCatConfigLoader + loadResolved + loadFrom', async () => {
    const files = new Map<string, string>([['/tpl/cat-template.json', TEMPLATE_JSON]]);
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatConfigLoaderService, {
      loader: {
        defaultTemplatePath: '/tpl/cat-template.json',
        readFile: (filePath) => files.get(filePath) ?? '',
        readCatalogRaw: () => null,
      },
      runtimeJsonBaseDir: '/cat-cafe',
      runtimeJson: {
        readFile: () => null,
        writeFile: async () => {},
      },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeCatConfigLoader;
    expect(svc).toBeDefined();
    const config = svc.loadResolved();
    expect(config.breeds[0]?.id).toBe('ragdoll');

    files.set('/x/cfg.json', TEMPLATE_JSON);
    const direct = svc.loadFrom('/x/cfg.json');
    expect(direct.breeds[0]?.defaultVariantId).toBe('opus');
  });
});
