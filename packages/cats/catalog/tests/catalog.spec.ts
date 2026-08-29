/**
 * C37/C38 cats-catalog 包测试（@flowforge/cats-catalog）。
 *
 * 覆盖：
 *  - ctx.plugin(CatsCatalog) → ctx.catsCatalog 挂载 + 端口覆盖
 *  - bootstrap：种子 breed + owner roster / 空模板 / 升级路径（ensureOwner + 回填）
 *  - P5 迁移：provider→clientId / ocProviderName→provider / providerProfileId→accountRef /
 *    降级变体删除 / 幂等
 *  - 模板回填：白名单 variant/breed / 占用 catId 拒绝 / 墓碑阻止复活 / 能力继承钩子
 *  - accounts：写读删 / provider-profiles 迁移（含 secrets）/ 冲突 skip / 损坏备份 /
 *    homedir 跨根迁移（引用账号）
 *  - user-preferences：product/global/thread/onboarding 四态 disposition + 多字段共存
 *  - runtime CRUD：create 查重 / update 默认变体写 breed / 多变体独立 + displayName
 *    快照 name / delete 墓碑 + roster 清理 / co-creator / mention alias 冲突 /
 *    validateCatalogFile（defaultVariantId / mentionPatterns / duplicate catId）
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import type { CatCafeConfig, CatCafeConfigV2, CatId, CatVariant } from '@flowforge/cats-shared';

import CatsCatalog, {
  CatalogService,
  addTemplateVariantTombstone,
  bootstrapCatCatalog,
  catalogPorts,
  createRuntimeCat,
  deleteRuntimeCat,
  isTemplateVariantBackfillAllowed,
  isTemplateVariantTombstoned,
  readCatCatalog,
  readCatCatalogRaw,
  readCatalogAccounts,
  readUserPreferences,
  resetMigrationState,
  resolveMessageDispositionPreference,
  saveMessageDispositionPreference,
  updateRuntimeCat,
  updateRuntimeCoCreator,
  validateCatalogFile,
  writeCatCatalog,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
  resetMigrationState();
  catalogPorts.mcpCapabilitiesInheritor = () => false;
  delete process.env.FF_GLOBAL_CONFIG_ROOT;
  delete process.env.FF_TEMPLATE_PATH;
  delete process.env.FF_DEFAULT_CAT_ID;
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cats-catalog-'));
}

function writeTemplate(root: string, template: unknown): string {
  const templatePath = join(root, 'cat-template.json');
  writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
  return templatePath;
}

function baseTemplate(): CatCafeConfig {
  return {
    version: 2,
    breeds: [
      {
        id: 'ragdoll',
        catId: 'ragdoll' as CatId,
        name: '布偶',
        displayName: 'Ragdoll',
        avatar: 'avatar.png',
        color: { primary: 'ivory', secondary: 'ivory' },
        mentionPatterns: ['@ragdoll'],
        roleDescription: '测试成员',
        defaultVariantId: 'ragdoll-default',
        variants: [
          {
            id: 'ragdoll-default',
            clientId: 'anthropic',
            defaultModel: 'opus',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
        ],
      },
    ],
    roster: {
      ragdoll: {
        family: 'ragdoll',
        roles: ['assistant'],
        lead: false,
        available: true,
        evaluation: 'seed member',
      },
    },
    reviewPolicy: {
      requireDifferentFamily: true,
      preferActiveInThread: true,
      preferLead: true,
      excludeUnavailable: true,
    },
  };
}

// ── 插件入口 ──

describe('cats-catalog 插件入口', () => {
  it('ctx.plugin(CatsCatalog) 挂载 ctx.catsCatalog', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatsCatalog)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    expect(ctx.catsCatalog).toBeInstanceOf(CatalogService);
    expect(ctx.catsCatalog.bootstrap).toBeTypeOf('function');
    expect(ctx.catsCatalog.createCat).toBeTypeOf('function');
  });

  it('端口覆盖：能力继承钩子被回填调用', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatsCatalog)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const inheritor = vi.fn(() => false);
    ctx.catsCatalog.setMcpCapabilitiesInheritor(inheritor);
    const root = tempRoot();
    // 模板含白名单 breed dragon-li（glm52）
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breeds = template.breeds as unknown[];
    breeds.push({
      id: 'dragon-li',
      catId: 'glm52',
      name: '龙鲤',
      displayName: 'Dragon Li',
      avatar: 'd.png',
      color: 'gold',
      mentionPatterns: ['@glm52'],
      roleDescription: '成员',
      defaultVariantId: 'glm52-default',
      variants: [
        {
          id: 'glm52-default',
          clientId: 'kimi',
          defaultModel: 'glm52',
          mcpSupport: true,
        },
      ],
    });
    writeTemplate(root, template);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    expect(inheritor).toHaveBeenCalled();
    expect((inheritor.mock.calls[0] as unknown[])[1]).toContain('glm52');
  });

  it('端口覆盖：缓存清理器被 CRUD 调用', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatsCatalog)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const invalidator = vi.fn();
    ctx.catsCatalog.setCacheInvalidator(invalidator);
    const root = tempRoot();
    writeTemplate(root, baseTemplate());
    createRuntimeCat(root, {
      catId: 'siamese',
      name: '暹罗',
      displayName: 'Siamese',
      avatar: 's.png',
      color: { primary: 'white', secondary: 'white' },
      mentionPatterns: ['@siamese'],
      roleDescription: '成员',
      clientId: 'openai',
      defaultModel: 'gpt-5',
      mcpSupport: true,
    });
    expect(invalidator).toHaveBeenCalled();
  });
});

// ── bootstrap ──

describe('cat-catalog bootstrap', () => {
  it('有种子 breed：生成运行态目录 + owner roster 裁剪', () => {
    const root = tempRoot();
    writeTemplate(root, baseTemplate());
    const path = bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    expect(existsSync(path)).toBe(true);
    const catalog = readCatCatalog(root)! as CatCafeConfigV2;
    expect(catalog.version).toBe(2);
    expect(catalog.breeds.length).toBe(1);
    expect(catalog.breeds[0]!.id).toBe('ragdoll');
    expect(catalog.roster.ragdoll).toBeDefined();
    expect(catalog.roster.owner).toBeDefined();
    expect(catalog.roster.owner!.roles).toContain('owner');
  });

  it('FF_DEFAULT_CAT_ID 优先选取种子 breed', () => {
    process.env.FF_DEFAULT_CAT_ID = 'ragdoll';
    const root = tempRoot();
    writeTemplate(root, baseTemplate());
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const catalog = readCatCatalog(root)!;
    expect(catalog.breeds[0]!.catId).toBe('ragdoll');
  });

  it('空模板：空运行态目录（wizard 引导）', () => {
    const root = tempRoot();
    writeTemplate(root, { version: 2, breeds: [] });
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const catalog = readCatCatalog(root)!;
    expect(catalog.breeds.length).toBe(0);
  });

  it('已存在目录：升级路径幂等（owner 补回 + 无重复回填）', () => {
    const root = tempRoot();
    writeTemplate(root, baseTemplate());
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    // 手工删除 owner 制造升级场景
    const catalog = readCatCatalog(root)!;
    const next = { ...catalog, roster: { ragdoll: (catalog as CatCafeConfigV2).roster.ragdoll } } as CatCafeConfig;
    writeCatCatalog(root, next);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const upgraded = readCatCatalog(root)!;
    expect((upgraded as CatCafeConfigV2).roster.owner).toBeDefined();
    expect(upgraded.breeds.length).toBe(1);
  });
});

// ── P5 迁移 ──

describe('P5 变体迁移', () => {
  it('provider（clientId 值）→ clientId；ocProviderName → provider；providerProfileId → accountRef', () => {
    const root = tempRoot();
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breed = (template.breeds as Record<string, unknown>[])[0]!;
    const variant = (breed.variants as Record<string, unknown>[])[0]!;
    delete variant.clientId;
    variant.provider = 'anthropic';
    variant.ocProviderName = 'anthropic-custom';
    variant.providerProfileId = 'my-profile';
    writeTemplate(root, template);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const migrated = readCatCatalog(root)!;
    const v = migrated.breeds[0]!.variants[0]! as unknown as Record<string, unknown>;
    expect(v.clientId).toBe('anthropic');
    expect(v.provider).toBe('anthropic-custom');
    expect(v.accountRef).toBe('my-profile');
    expect(v.providerProfileId).toBeUndefined();
  });

  it('降级变体：catId 已升级为独立 breed 的遗留变体被删除', () => {
    const root = tempRoot();
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breeds = template.breeds as Record<string, unknown>[];
    // ragdoll 下挂 opus-47 遗留变体；同时 opus-47 是顶层 breed
    const breed = breeds[0]!;
    (breed.variants as Record<string, unknown>[]).push({
      id: 'opus-47-legacy',
      catId: 'opus-47',
      clientId: 'anthropic',
      defaultModel: 'opus',
      mcpSupport: true,
    });
    breeds.push({
      id: 'opus-47',
      catId: 'opus-47',
      name: 'Opus',
      displayName: 'Opus 47',
      avatar: 'o.png',
      color: 'black',
      mentionPatterns: ['@opus-47'],
      roleDescription: '成员',
      defaultVariantId: 'opus-47-default',
      variants: [
        {
          id: 'opus-47-default',
          clientId: 'anthropic',
          defaultModel: 'opus',
          mcpSupport: true,
        },
      ],
    });
    writeTemplate(root, template);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const migrated = readCatCatalog(root)!;
    expect(migrated.breeds[0]!.variants.length).toBe(1);
  });

  it('迁移幂等：二次读取不再重写', () => {
    const root = tempRoot();
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breed = (template.breeds as Record<string, unknown>[])[0]!;
    const variant = (breed.variants as Record<string, unknown>[])[0]!;
    delete variant.clientId;
    variant.provider = 'anthropic';
    writeTemplate(root, template);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const raw1 = readCatCatalogRaw(root)!;
    const raw2 = readCatCatalogRaw(root)!;
    expect(raw1).toBe(raw2);
    const catalog = JSON.parse(raw1) as CatCafeConfig;
    expect((catalog.breeds[0]!.variants[0]! as unknown as Record<string, unknown>).clientId).toBe('anthropic');
  });
});

// ── 模板回填 ──

describe('模板回填（白名单 + 墓碑）', () => {
  function writeTemplateWithVariants(root: string): string {
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breeds = template.breeds as Record<string, unknown>[];
    breeds.push({
      id: 'maine-coon',
      catId: 'maine-coon',
      name: '缅因',
      displayName: 'Maine Coon',
      avatar: 'm.png',
      color: 'brown',
      mentionPatterns: ['@maine-coon'],
      roleDescription: '成员',
      defaultVariantId: 'maine-coon-default',
      variants: [
        {
          id: 'maine-coon-default',
          clientId: 'anthropic',
          defaultModel: 'opus',
          mcpSupport: true,
        },
        {
          id: 'codex-sol',
          catId: 'codex-sol',
          clientId: 'openai',
          defaultModel: 'sol',
          mcpSupport: true,
          mentionPatterns: ['@codex-sol'],
        },
      ],
    });
    // 模板 roster 同步（回填 roster 条目的数据源）
    const roster = template.roster as Record<string, unknown>;
    roster['maine-coon'] = {
      family: 'maine-coon',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: 'template member',
    };
    roster['codex-sol'] = {
      family: 'maine-coon',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: 'template member',
    };
    return writeTemplate(root, template);
  }

  /** 预置 stale 运行态目录：模板去掉 codex-sol variant 与 roster（模拟 pre-F203 状态）。 */
  function writeStaleRuntimeWithoutCodexSol(root: string): void {
    const templateRaw = readFileSync(join(root, 'cat-template.json'), 'utf-8');
    const stale = structuredClone(JSON.parse(templateRaw)) as Record<string, unknown>;
    const maine = (stale.breeds as Record<string, unknown>[]).find((b) => b.id === 'maine-coon')!;
    (maine.variants as Record<string, unknown>[]).splice(1);
    delete (stale.roster as Record<string, unknown>)['codex-sol'];
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), JSON.stringify(stale, null, 2), 'utf-8');
  }

  it('白名单 variant 回填（maine-coon.codex-sol）', () => {
    const root = tempRoot();
    writeTemplateWithVariants(root);
    writeStaleRuntimeWithoutCodexSol(root);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const catalog = readCatCatalog(root)!;
    const breed = catalog.breeds.find((b) => b.id === 'maine-coon')!;
    expect(breed.variants.length).toBe(2);
    expect(breed.variants.map((v) => v.id)).toContain('codex-sol');
    // roster 同步
    expect((catalog as CatCafeConfigV2).roster['codex-sol']).toBeDefined();
  });

  it('非白名单 variant 不回填', () => {
    const root = tempRoot();
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breeds = template.breeds as Record<string, unknown>[];
    breeds.push({
      id: 'bengal',
      catId: 'bengal',
      name: '孟加拉',
      displayName: 'Bengal',
      avatar: 'b.png',
      color: 'gold',
      mentionPatterns: ['@bengal'],
      roleDescription: '成员',
      defaultVariantId: 'bengal-default',
      variants: [
        { id: 'bengal-default', clientId: 'anthropic', defaultModel: 'opus', mcpSupport: true },
        { id: 'bengal-extra', catId: 'bengal-extra', clientId: 'anthropic', defaultModel: 'opus', mcpSupport: true },
      ],
    });
    writeTemplate(root, template);
    // 预置运行态：bengal 已存在但只有 default variant（bengal-extra 是模板新增）
    const stale = structuredClone(JSON.parse(readFileSync(join(root, 'cat-template.json'), 'utf-8'))) as Record<
      string,
      unknown
    >;
    const bengal = (stale.breeds as Record<string, unknown>[]).find((b) => b.id === 'bengal')!;
    (bengal.variants as Record<string, unknown>[]).splice(1);
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), JSON.stringify(stale, null, 2), 'utf-8');
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const catalog = readCatCatalog(root)!;
    const breed = catalog.breeds.find((b) => b.id === 'bengal')!;
    // bengal-extra 不在白名单 → 不回填，仍只有 default
    expect(breed.variants.length).toBe(1);
  });

  it('墓碑阻止变体复活', () => {
    const root = tempRoot();
    writeTemplateWithVariants(root);
    // 运行态完整（含 codex-sol）
    const stale = JSON.parse(readFileSync(join(root, 'cat-template.json'), 'utf-8'));
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), JSON.stringify(stale, null, 2), 'utf-8');
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    // 删除 codex-sol 变体（写墓碑）
    let catalog = readCatCatalog(root)!;
    deleteRuntimeCat(root, 'codex-sol');
    catalog = readCatCatalog(root)!;
    const breed = catalog.breeds.find((b) => b.id === 'maine-coon')!;
    expect(breed.variants.length).toBe(1);
    // 再次 bootstrap：模板里的 codex-sol 不应复活
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    catalog = readCatCatalog(root)!;
    const after = catalog.breeds.find((b) => b.id === 'maine-coon')!;
    expect(after.variants.length).toBe(1);
  });

  it('占用的 catId 拒绝回填（白名单也拒绝）', () => {
    const root = tempRoot();
    writeTemplateWithVariants(root);
    writeStaleRuntimeWithoutCodexSol(root);
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const catalog = readCatCatalog(root)!;
    const breed = catalog.breeds.find((b) => b.id === 'maine-coon')!;
    expect(breed.variants.length).toBe(2);
    // 第二次 bootstrap 幂等：不产生重复
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    const again = readCatCatalog(root)!;
    expect(again.breeds.find((b) => b.id === 'maine-coon')!.variants.length).toBe(2);
  });

  it('isTemplateVariantBackfillAllowed 纯函数：白名单 + 占用检查', () => {
    expect(
      isTemplateVariantBackfillAllowed({
        breedId: 'maine-coon',
        variantId: 'codex-sol',
        catId: 'codex-sol',
      }),
    ).toBe(true);
    expect(
      isTemplateVariantBackfillAllowed(
        {
          breedId: 'maine-coon',
          variantId: 'codex-sol',
          catId: 'codex-sol',
        },
        { catIds: new Set(['codex-sol']) },
      ),
    ).toBe(false);
    expect(
      isTemplateVariantBackfillAllowed({
        breedId: 'bengal',
        variantId: 'unknown',
        catId: 'unknown',
      }),
    ).toBe(false);
  });
});

// ── accounts ──

describe('catalog-accounts', () => {
  it('写读删账号（FF_GLOBAL_CONFIG_ROOT 隔离）', async () => {
    const root = tempRoot();
    process.env.FF_GLOBAL_CONFIG_ROOT = root;
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    const ref = 'custom-account';
    expect(readCatalogAccounts(root)[ref]).toBeUndefined();
    writeFileSync(join(root, '.cat-cafe', 'accounts.json'), '{}', 'utf-8');
    // 直接通过公共 API 写入
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatsCatalog)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    ctx.catsCatalog.writeAccount(root, ref, { authType: 'api_key', baseUrl: 'https://x.example/', models: ['m1'] });
    const accounts = readCatalogAccounts(root);
    expect(accounts[ref]!.authType).toBe('api_key');
    // 原版 writeCatalogAccount 直接落盘不归一化：写什么读什么
    expect(accounts[ref]!.baseUrl).toBe('https://x.example/');
    ctx.catsCatalog.deleteAccount(root, ref);
    expect(readCatalogAccounts(root)[ref]).toBeUndefined();
  });

  it('provider-profiles.json → accounts.json 迁移（含 secrets 0o600）', () => {
    const root = tempRoot();
    process.env.FF_GLOBAL_CONFIG_ROOT = root;
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(
      join(root, '.cat-cafe', 'provider-profiles.json'),
      JSON.stringify({
        providers: [{ id: 'legacy-p', authType: 'api_key', displayName: 'Legacy', models: ['m1'] }],
      }),
      'utf-8',
    );
    writeFileSync(
      join(root, '.cat-cafe', 'provider-profiles.secrets.local.json'),
      JSON.stringify({ profiles: { 'legacy-p': { apiKey: 'sk-test' } } }),
      'utf-8',
    );
    const accounts = readCatalogAccounts(root);
    expect(accounts['legacy-p']!.authType).toBe('api_key');
    expect(accounts['legacy-p']!.displayName).toBe('Legacy');
    const creds = JSON.parse(readFileSync(join(root, '.cat-cafe', 'credentials.json'), 'utf-8')) as Record<
      string,
      { apiKey?: string }
    >;
    expect(creds['legacy-p']!.apiKey).toBe('sk-test');
  });

  it('损坏 accounts.json：备份 .bak + 视为空', () => {
    const root = tempRoot();
    process.env.FF_GLOBAL_CONFIG_ROOT = root;
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(join(root, '.cat-cafe', 'accounts.json'), '{broken json', 'utf-8');
    const accounts = readCatalogAccounts(root);
    expect(accounts).toEqual({});
    expect(existsSync(join(root, '.cat-cafe', 'accounts.json.bak'))).toBe(true);
  });

  it('冲突账号：global 优先（skipConflicts 语义）', () => {
    const root = tempRoot();
    process.env.FF_GLOBAL_CONFIG_ROOT = root;
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(
      join(root, '.cat-cafe', 'accounts.json'),
      JSON.stringify({ dup: { authType: 'api_key', displayName: 'existing' } }),
      'utf-8',
    );
    // 项目段迁移：冲突时 global 胜出且不抛错
    writeFileSync(
      join(root, '.cat-cafe', 'cat-catalog.json'),
      JSON.stringify({
        version: 2,
        breeds: [],
        roster: {},
        reviewPolicy: {
          requireDifferentFamily: true,
          preferActiveInThread: true,
          preferLead: true,
          excludeUnavailable: true,
        },
        accounts: { dup: { authType: 'oauth', displayName: 'incoming' } },
      }),
      'utf-8',
    );
    const accounts = readCatalogAccounts(root);
    expect(accounts.dup!.displayName).toBe('existing');
  });
});

// ── user-preferences ──

describe('user-preferences-store', () => {
  it('缺省 product disposition = next_work', () => {
    const root = tempRoot();
    const snapshot = resolveMessageDispositionPreference(root);
    expect(snapshot.effective).toBe('next_work');
    expect(snapshot.source).toBe('product');
  });

  it('global 保存与解析', () => {
    const root = tempRoot();
    saveMessageDispositionPreference(root, { scope: 'global', disposition: 'continue_current' });
    const snapshot = resolveMessageDispositionPreference(root);
    expect(snapshot.source).toBe('global');
    expect(snapshot.effective).toBe('continue_current');
  });

  it('thread 覆盖 global', () => {
    const root = tempRoot();
    saveMessageDispositionPreference(root, { scope: 'global', disposition: 'continue_current' });
    saveMessageDispositionPreference(root, { scope: 'thread', threadId: 't1', disposition: 'next_work' });
    expect(resolveMessageDispositionPreference(root, 't1').source).toBe('thread');
    expect(resolveMessageDispositionPreference(root, 'other').source).toBe('global');
  });

  it('thread 删除回退 global', () => {
    const root = tempRoot();
    saveMessageDispositionPreference(root, { scope: 'global', disposition: 'continue_current' });
    saveMessageDispositionPreference(root, { scope: 'thread', threadId: 't1', disposition: 'next_work' });
    saveMessageDispositionPreference(root, { scope: 'thread', threadId: 't1', disposition: null });
    expect(resolveMessageDispositionPreference(root, 't1').source).toBe('global');
  });

  it('onboarding 标记与多字段共存（catOrder + messageDisposition）', async () => {
    const root = tempRoot();
    saveMessageDispositionPreference(root, { scope: 'onboarding', seen: true });
    const prefs = readUserPreferences(root);
    expect(prefs.messageDisposition?.onboardingSeen).toBe(true);
    // 另一字段写入不互相覆盖
    const ctx = new Context();
    const fiber = (await ctx.plugin(CatsCatalog)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    ctx.catsCatalog.updatePreferences(root, (current) => ({ ...current, catOrder: ['a', 'b'] }));
    const after = readUserPreferences(root);
    expect(after.catOrder).toEqual(['a', 'b']);
    expect(after.messageDisposition?.onboardingSeen).toBe(true);
  });

  it('非法 disposition 值被清洗', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    const prefs = readUserPreferences(root);
    void prefs;
    writeFileSync(
      join(root, '.cat-cafe', 'user-preferences.json'),
      JSON.stringify({ messageDisposition: { global: 'bogus', threads: { t1: 'bogus' } } }),
      'utf-8',
    );
    const snapshot = resolveMessageDispositionPreference(root, 't1');
    expect(snapshot.effective).toBe('next_work');
  });
});

// ── runtime CRUD ──

describe('runtime-cat-catalog CRUD', () => {
  function setup(root: string): void {
    writeTemplate(root, baseTemplate());
  }

  it('createRuntimeCat：v2 roster 条目 + 持久化', () => {
    const root = tempRoot();
    setup(root);
    const catalog = createRuntimeCat(root, {
      catId: 'siamese',
      name: '暹罗',
      displayName: 'Siamese',
      avatar: 's.png',
      color: { primary: 'white', secondary: 'white' },
      mentionPatterns: ['siamese'],
      roleDescription: '成员',
      clientId: 'openai',
      defaultModel: 'gpt-5',
      mcpSupport: true,
    });
    expect(catalog.breeds.length).toBe(2);
    const siamese = catalog.breeds.find((b) => b.catId === 'siamese')!;
    expect(siamese.mentionPatterns).toEqual(['@siamese']);
    expect(siamese.variants[0]!.clientId).toBe('openai');
    expect((catalog as CatCafeConfigV2).roster.siamese!.roles).toContain('assistant');
    // 从磁盘读回一致
    const persisted = readCatCatalog(root)!;
    expect(persisted.breeds.length).toBe(2);
  });

  it('重复 catId 抛错', () => {
    const root = tempRoot();
    setup(root);
    createRuntimeCat(root, {
      catId: 'siamese',
      name: '暹罗',
      displayName: 'Siamese',
      avatar: 's.png',
      color: { primary: 'white', secondary: 'white' },
      mentionPatterns: ['@siamese'],
      roleDescription: '成员',
      clientId: 'openai',
      defaultModel: 'gpt-5',
      mcpSupport: true,
    });
    expect(() =>
      createRuntimeCat(root, {
        catId: 'siamese',
        name: '重复',
        displayName: 'Dup',
        avatar: 's.png',
        color: { primary: 'white', secondary: 'white' },
        mentionPatterns: ['@siamese'],
        roleDescription: '成员',
        clientId: 'openai',
        defaultModel: 'gpt-5',
        mcpSupport: true,
      }),
    ).toThrow(/already exists/);
  });

  it('updateRuntimeCat：默认变体写 breed 身份（name/displayName/avatar/mentionPatterns）', () => {
    const root = tempRoot();
    setup(root);
    const catalog = updateRuntimeCat(root, 'ragdoll', {
      name: '布偶王',
      displayName: 'Ragdoll King',
      avatar: 'new.png',
      mentionPatterns: ['@ragdoll', '@ragdoll-king'],
    });
    const breed = catalog.breeds[0]!;
    expect(breed.name).toBe('布偶王');
    expect(breed.displayName).toBe('Ragdoll King');
    expect(breed.avatar).toBe('new.png');
    expect(breed.mentionPatterns).toEqual(['@ragdoll', '@ragdoll-king']);
  });

  it('updateRuntimeCat：多变体独立字段 + displayName-only patch 快照 name', () => {
    const root = tempRoot();
    setup(root);
    // 先建两个变体的 breed
    const catalog1 = createRuntimeCat(root, {
      catId: 'bengal',
      name: '孟加拉',
      displayName: 'Bengal',
      avatar: 'b.png',
      color: { primary: 'gold', secondary: 'gold' },
      mentionPatterns: ['@bengal'],
      roleDescription: '成员',
      clientId: 'anthropic',
      defaultModel: 'opus',
      mcpSupport: true,
    });
    const bengal = catalog1.breeds.find((b) => b.catId === 'bengal')!;
    void bengal;
    // 直接往 breed 追加第二个变体（模拟模板/历史数据）
    const catalog2 = readCatCatalog(root)!;
    const breed = catalog2.breeds.find((b) => b.catId === 'bengal')!;
    const extra: CatVariant = {
      id: 'bengal-gpt',
      catId: 'bengal-gpt',
      clientId: 'openai',
      defaultModel: 'gpt-5',
      mcpSupport: true,
      cli: { command: 'bengal-gpt', outputFormat: 'stream-json' },
      mentionPatterns: ['@bengal-gpt'],
      displayName: 'Bengal GPT',
    };
    (breed.variants as CatVariant[]).push(extra);
    writeCatCatalog(root, catalog2);

    // 非默认变体 displayName-only patch：name 快照 + displayName 更新
    const updated = updateRuntimeCat(root, 'bengal-gpt', { displayName: 'GPT Bengal' });
    const gpt = updated.breeds.find((b) => b.catId === 'bengal')!.variants.find((v) => v.id === 'bengal-gpt')!;
    expect(gpt.displayName).toBe('GPT Bengal');
    expect((gpt as unknown as Record<string, unknown>).name).toBe('Bengal GPT');
    // breed 身份不受影响
    const breedAfter = updated.breeds.find((b) => b.catId === 'bengal')!;
    expect(breedAfter.displayName).toBe('Bengal');
  });

  it('updateRuntimeCat：available 更新 roster；accountRef 清空删除字段', () => {
    const root = tempRoot();
    setup(root);
    const catalog = updateRuntimeCat(root, 'ragdoll', { available: false, accountRef: '' });
    expect((catalog as CatCafeConfigV2).roster.ragdoll!.available).toBe(false);
    expect((catalog.breeds[0]!.variants[0]! as unknown as Record<string, unknown>).accountRef).toBeUndefined();
  });

  it('deleteRuntimeCat：单变体删 breed + roster 清理 + 模板墓碑', () => {
    const root = tempRoot();
    const template = baseTemplate() as unknown as Record<string, unknown>;
    const breeds = template.breeds as Record<string, unknown>[];
    breeds.push({
      id: 'maine-coon',
      catId: 'maine-coon',
      name: '缅因',
      displayName: 'Maine Coon',
      avatar: 'm.png',
      color: 'brown',
      mentionPatterns: ['@maine-coon'],
      roleDescription: '成员',
      defaultVariantId: 'maine-coon-default',
      variants: [
        {
          id: 'codex-sol',
          catId: 'codex-sol',
          clientId: 'openai',
          defaultModel: 'sol',
          mcpSupport: true,
          mentionPatterns: ['@codex-sol'],
        },
      ],
    });
    const roster = template.roster as Record<string, unknown>;
    roster['maine-coon'] = {
      family: 'maine-coon',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: 'template member',
    };
    roster['codex-sol'] = {
      family: 'maine-coon',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: 'template member',
    };
    writeTemplate(root, template);
    // 预置运行态：maine-coon（含 codex-sol）已存在
    mkdirSync(join(root, '.cat-cafe'), { recursive: true });
    writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), JSON.stringify(template, null, 2), 'utf-8');
    bootstrapCatCatalog(root, join(root, 'cat-template.json'));
    expect((readCatCatalog(root)! as CatCafeConfigV2).roster['codex-sol']).toBeDefined();
    deleteRuntimeCat(root, 'codex-sol');
    const catalog = readCatCatalog(root)! as CatCafeConfigV2;
    expect(catalog.breeds.find((b) => b.id === 'maine-coon')).toBeUndefined();
    expect(catalog.roster['codex-sol']).toBeUndefined();
    // 墓碑已写
    expect(isTemplateVariantTombstoned(catalog as unknown as Record<string, unknown>, {
      breedId: 'maine-coon',
      variantId: 'codex-sol',
      catId: 'codex-sol',
    })).toBe(true);
  });

  it('deleteRuntimeCat：多变体删变体 + defaultVariantId 移交', () => {
    const root = tempRoot();
    setup(root);
    const catalog = createRuntimeCat(root, {
      catId: 'bengal',
      name: '孟加拉',
      displayName: 'Bengal',
      avatar: 'b.png',
      color: { primary: 'gold', secondary: 'gold' },
      mentionPatterns: ['@bengal'],
      roleDescription: '成员',
      clientId: 'anthropic',
      defaultModel: 'opus',
      mcpSupport: true,
    });
    void catalog;
    const cat2 = readCatCatalog(root)!;
    const breed = cat2.breeds.find((b) => b.catId === 'bengal')!;
    const extra: CatVariant = {
      id: 'bengal-gpt',
      catId: 'bengal-gpt',
      clientId: 'openai',
      defaultModel: 'gpt-5',
      mcpSupport: true,
      cli: { command: 'bengal-gpt', outputFormat: 'stream-json' },
      mentionPatterns: ['@bengal-gpt'],
    };
    (breed.variants as CatVariant[]).push(extra);
    (breed as { defaultVariantId: string }).defaultVariantId = 'bengal-gpt';
    writeCatCatalog(root, cat2);
    const deleted = deleteRuntimeCat(root, 'bengal-gpt');
    const after = deleted.breeds.find((b) => b.catId === 'bengal')!;
    expect(after.variants.length).toBe(1);
    expect(after.defaultVariantId).toBe('bengal-default');
  });

  it('updateRuntimeCoCreator：归一化 + 时间戳/头像/颜色', () => {
    const root = tempRoot();
    setup(root);
    const catalog = updateRuntimeCoCreator(root, {
      name: '大当家',
      aliases: [' L.S. ', 'ls', ' L.S. '],
      mentionPatterns: ['@owner', 'owner'],
      timeZone: 'Asia/Shanghai',
      avatar: 'me.png',
    });
    const owner = (catalog as CatCafeConfigV2).coCreator!;
    expect(owner.name).toBe('大当家');
    expect(owner.aliases).toEqual(['L.S.', 'ls']);
    // 原版 normalizeCoCreatorMentionPatterns 补 @ 前缀 + Set 去重
    expect(owner.mentionPatterns).toEqual(['@owner']);
    expect(owner.timeZone).toBe('Asia/Shanghai');
  });

  it('mention alias 冲突抛错（含 co-creator）', () => {
    const root = tempRoot();
    setup(root);
    expect(() =>
      createRuntimeCat(root, {
        catId: 'dupe',
        name: '重复',
        displayName: 'Dup',
        avatar: 'd.png',
        color: { primary: 'white', secondary: 'white' },
        mentionPatterns: ['@ragdoll'],
        roleDescription: '成员',
        clientId: 'openai',
        defaultModel: 'gpt-5',
        mcpSupport: true,
      }),
    ).toThrow(/already used by cat/);
  });

  it('validateCatalogFile：defaultVariantId 缺失 / mentionPatterns 空 / duplicate catId', () => {
    const root = tempRoot();
    // defaultVariantId 缺失
    const bad = baseTemplate() as unknown as Record<string, unknown>;
    const breed = (bad.breeds as Record<string, unknown>[])[0]!;
    breed.defaultVariantId = 'missing-variant';
    const p1 = join(root, 'bad1.json');
    writeFileSync(p1, JSON.stringify(bad), 'utf-8');
    expect(() => validateCatalogFile(p1)).toThrow(/defaultVariantId/);
    // mentionPatterns 空
    const bad2 = baseTemplate() as unknown as Record<string, unknown>;
    (bad2.breeds as Record<string, unknown>[])[0]!.mentionPatterns = [];
    const p2 = join(root, 'bad2.json');
    writeFileSync(p2, JSON.stringify(bad2), 'utf-8');
    expect(() => validateCatalogFile(p2)).toThrow(/mentionPatterns/);
    // duplicate catId
    const bad3 = baseTemplate() as unknown as Record<string, unknown>;
    const breeds3 = bad3.breeds as Record<string, unknown>[];
    breeds3.push(structuredClone(breeds3[0]!));
    const p3 = join(root, 'bad3.json');
    writeFileSync(p3, JSON.stringify(bad3), 'utf-8');
    expect(() => validateCatalogFile(p3)).toThrow(/Duplicate catId/);
  });

  it('addTemplateVariantTombstone 纯函数：幂等保留 deletedAt', () => {
    const catalog: Record<string, unknown> = {};
    addTemplateVariantTombstone(catalog, { breedId: 'b', variantId: 'v', catId: 'c' });
    const first = catalog.templateVariantTombstones as Record<string, unknown>;
    const key = Object.keys(first)[0]!;
    const deletedAt = (first[key] as { deletedAt: string }).deletedAt;
    addTemplateVariantTombstone(catalog, { breedId: 'b', variantId: 'v', catId: 'c' });
    expect((first[key] as { deletedAt: string }).deletedAt).toBe(deletedAt);
  });
});
