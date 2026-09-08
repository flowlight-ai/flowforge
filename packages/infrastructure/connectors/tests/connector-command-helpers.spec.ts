/**
 * connector-command-helpers 契约测试。
 * 覆盖 deep link、命令列表、cats/status 信息构建、thread 匹配与 feat 提取。
 */

import { describe, expect, it } from 'vitest';

import {
  buildCatsInfo,
  buildCommandsList,
  buildStatusInfo,
  buildThreadDeepLink,
  extractFeatIds,
  matchByFeatId,
  matchByIdPrefix,
  matchByListIndex,
  matchByTitle,
  type ConnectorCommandRegistry,
} from '../src/index.ts';
import type { SlashCommandDefinition } from '@flowforge/cats-shared';

function registry(over: Partial<ConnectorCommandRegistry> = {}): ConnectorCommandRegistry {
  const commands: SlashCommandDefinition[] = [
    { name: '/new', usage: '/new [标题]', description: '创建新 thread', source: 'core' } as SlashCommandDefinition,
    {
      name: '/threads',
      usage: '/threads',
      description: '列出最近的 threads',
      source: 'core',
    } as SlashCommandDefinition,
  ];
  return {
    getAll: () => commands,
    listBySurface: (s: string) => (s === 'connector' ? commands : []),
    get: (name: string) => commands.find((c) => c.name === name),
    ...over,
  };
}

const backlog: Record<string, { tags: readonly string[] }> = {
  'bl-1': { tags: ['feature:F088'] },
  'bl-2': { tags: ['feature:F120', 'feature:F090'] },
};

describe('buildThreadDeepLink', () => {
  it('拼接前端 thread URL', () => {
    expect(buildThreadDeepLink('https://app', 'th-1')).toBe('https://app/thread/th-1');
  });
});

describe('buildCommandsList', () => {
  it('有 registry 时按 surface 列出命令并生成按钮', () => {
    const result = buildCommandsList(registry());
    expect(result.kind).toBe('commands');
    expect(result.response).toContain('/new');
    expect(result.cardActions?.[0]).toMatchObject({ label: '➕ 新建', value: { cmd: '/new' } });
  });

  it('无 registry 时回退内置命令列表', () => {
    const result = buildCommandsList(undefined);
    expect(result.kind).toBe('commands');
    expect(result.response).toContain('/threads');
    expect(result.cardActions).toBeDefined();
  });
});

describe('buildCatsInfo', () => {
  it('汇总参与猫与可调度猫', async () => {
    const deps = {
      frontendBaseUrl: 'https://app',
      catRoster: { 'cat-a': { displayName: '宪宪', available: true }, 'cat-b': { displayName: '布偶', available: false } },
      agentRegistry: { has: (id: string) => id === 'cat-a' },
      participantStore: {
        getParticipantsWithActivity: async () => [
          { catId: 'cat-a', lastMessageAt: 1000, messageCount: 3 },
        ],
      },
    };
    const result = await buildCatsInfo('th-1', deps);
    expect(result.kind).toBe('cats');
    expect(result.response).toContain('宪宪');
    expect(result.response).toContain('✅');
  });
});

describe('buildStatusInfo', () => {
  it('渲染标题/创建/首选猫/链接', async () => {
    const result = await buildStatusInfo(
      'th-1',
      { title: '排查', createdAt: 0, preferredCats: ['cat-a'] },
      {
        frontendBaseUrl: 'https://app',
        catRoster: { 'cat-a': { displayName: '宪宪' } },
      },
    );
    expect(result.kind).toBe('status');
    expect(result.response).toContain('排查');
    expect(result.response).toContain('宪宪');
    expect(result.response).toContain('https://app/thread/th-1');
  });
});

describe('thread 匹配助手', () => {
  const threads = [
    { id: 'th-aaa', title: '飞书登录', lastActiveAt: 100, backlogItemId: 'bl-1' },
    { id: 'th-bbb', title: '聊天机器人', lastActiveAt: 200, backlogItemId: 'bl-2' },
  ];

  it('matchByListIndex 按 1-based 序号', () => {
    expect(matchByListIndex('2', threads)?.id).toBe('th-bbb');
    expect(matchByListIndex('99', threads)).toBeNull();
    expect(matchByListIndex('abc', threads)).toBeNull();
  });

  it('matchByIdPrefix 按 ID 前缀', () => {
    expect(matchByIdPrefix('th-a', threads)?.id).toBe('th-aaa');
    expect(matchByIdPrefix('zzz', threads)).toBeNull();
  });

  it('matchByTitle 大小写不敏感子串', () => {
    expect(matchByTitle('机器人', threads)?.id).toBe('th-bbb');
    expect(matchByTitle('不存在', threads)).toBeNull();
  });

  it('matchByFeatId 通过 backlog 标签匹配', async () => {
    expect((await matchByFeatId('F120', threads, 'u-1', backlogStub()))?.id).toBe('th-bbb');
    expect(await matchByFeatId('F999', threads, 'u-1', backlogStub())).toBeNull();
    // 非 F 号输入直接返回 null
    expect(await matchByFeatId('abc', threads, 'u-1', backlogStub())).toBeNull();
  });
});

function backlogStub() {
  return {
    get: async (itemId: string) => backlog[itemId] ?? null,
  };
}

describe('extractFeatIds', () => {
  it('提取 feature: 前缀标签并大写', () => {
    expect(extractFeatIds(['feature:f088', 'other'])).toEqual(['F088']);
  });
});