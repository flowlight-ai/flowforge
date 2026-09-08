/**
 * ConnectorMessageFormatter 契约测试。
 * 覆盖 format（header/subtitle/footer）、formatMinimal、formatCommand 与快速动作。
 */

import { describe, expect, it } from 'vitest';

import { ConnectorMessageFormatter, DEFAULT_QUICK_ACTIONS } from '../src/index.ts';

const formatter = new ConnectorMessageFormatter();

describe('ConnectorMessageFormatter', () => {
  it('format 组合 header/subtitle/footer', () => {
    const env = formatter.format({
      catDisplayName: '布偶猫',
      catEmoji: '🐱',
      threadShortId: 'T12',
      threadTitle: '飞书登录bug排查',
      featId: 'F088',
      body: '已定位：token 过期。',
      deepLinkUrl: 'https://app/thread/T12',
      timestamp: new Date('2026-01-01T01:22:00Z'),
      origin: 'agent',
    });
    expect(env.header).toBe('🐱 布偶猫');
    expect(env.subtitle).toBe('T12 飞书登录bug排查 · F088');
    expect(env.body).toBe('已定位：token 过期。');
    expect(env.footer).toContain('https://app/thread/T12');
    expect(env.origin).toBe('agent');
  });

  it('无 deepLink 时 footer 仅含时间；无 title/featId 时 subtitle 为 shortId', () => {
    const env = formatter.format({
      catDisplayName: '宪宪',
      catEmoji: '🐱',
      threadShortId: 'T1',
      body: 'ok',
      timestamp: new Date('2026-01-01T05:30:00Z'),
    });
    expect(env.footer).toBe('05:30');
    expect(env.subtitle).toBe('T1');
  });

  it('formatMinimal 仅含猫身份与正文，无线程元数据', () => {
    const env = formatter.formatMinimal({
      catDisplayName: '宪宪',
      catEmoji: '🐱',
      body: '简短回复',
      origin: 'callback',
    });
    expect(env.header).toBe('🐱 宪宪');
    expect(env.subtitle).toBe('');
    expect(env.body).toBe('简短回复');
    expect(env.origin).toBe('callback');
  });

  it('formatCommand 使用统一系统身份并附带快速动作', () => {
    const env = formatter.formatCommand('可用命令…', DEFAULT_QUICK_ACTIONS);
    expect(env.header).toBe('Clowder AI');
    expect(env.body).toBe('可用命令…');
    expect(env.cardActions?.[0]).toMatchObject({ label: '➕ 新建', value: { cmd: '/new' } });
  });
});