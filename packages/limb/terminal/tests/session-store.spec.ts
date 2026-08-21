/**
 * TerminalSessionStore 单元测试 — T6.5 session-store.ts
 * 覆盖：create/get/所有权门控/断连重连/按用户与 worktree 列表/清空判定。
 */

import { describe, expect, it } from 'vitest';
import { TerminalSessionStore } from '../src/session-store.js';

describe('TerminalSessionStore', () => {
  it('create 生成 connected 会话并分配 uuid id', () => {
    const store = new TerminalSessionStore();
    const record = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.worktreeId).toBe('wt-1');
    expect(record.paneId).toBe('%0');
    expect(record.userId).toBe('u-1');
    expect(record.status).toBe('connected');
    expect(record.createdAt).toBeGreaterThan(0);
    expect(store.get(record.id)).toBe(record);
  });

  it('get 对不存在的 id 返回 undefined', () => {
    const store = new TerminalSessionStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('getByIdAndUser 仅在同一 userId 下返回会话', () => {
    const store = new TerminalSessionStore();
    const record = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    expect(store.getByIdAndUser(record.id, 'u-1')).toBe(record);
    expect(store.getByIdAndUser(record.id, 'u-2')).toBeUndefined();
  });

  it('markDisconnected / markConnected 切换状态', () => {
    const store = new TerminalSessionStore();
    const record = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    store.markDisconnected(record.id);
    expect(record.status).toBe('disconnected');
    store.markConnected(record.id);
    expect(record.status).toBe('connected');
  });

  it('markDisconnected 对不存在的 id 静默', () => {
    const store = new TerminalSessionStore();
    expect(() => store.markDisconnected('nope')).not.toThrow();
  });

  it('findReconnectable 只返回同 worktree + 同 user 的 disconnected 会话', () => {
    const store = new TerminalSessionStore();
    const a = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    const b = store.create({ worktreeId: 'wt-1', paneId: '%1', userId: 'u-1' });
    store.create({ worktreeId: 'wt-2', paneId: '%2', userId: 'u-1' });
    store.create({ worktreeId: 'wt-1', paneId: '%3', userId: 'u-2' });
    store.markDisconnected(a.id);
    expect(store.findReconnectable('wt-1', 'u-1')?.id).toBe(a.id);
    store.markDisconnected(b.id);
    // 源码语义：插入顺序最早（FIFO）的 disconnected 会话优先
    expect(store.findReconnectable('wt-1', 'u-1')?.id).toBe(a.id);
    // connected 会话不可重连
    store.markConnected(b.id);
    expect(store.findReconnectable('wt-1', 'u-1')?.id).toBe(a.id);
  });

  it('remove 删除并返回会话，二次 remove 返回 undefined', () => {
    const store = new TerminalSessionStore();
    const record = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    expect(store.remove(record.id)).toBe(record);
    expect(store.remove(record.id)).toBeUndefined();
    expect(store.get(record.id)).toBeUndefined();
  });

  it('listByUser / listByWorktree 过滤正确', () => {
    const store = new TerminalSessionStore();
    store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    store.create({ worktreeId: 'wt-1', paneId: '%1', userId: 'u-1' });
    store.create({ worktreeId: 'wt-2', paneId: '%2', userId: 'u-2' });
    expect(store.listByUser('u-1')).toHaveLength(2);
    expect(store.listByUser('u-2')).toHaveLength(1);
    expect(store.listByWorktree('wt-1')).toHaveLength(2);
    expect(store.listByWorktree('wt-2')).toHaveLength(1);
  });

  it('hasRemainingForWorktree 反映是否存在任何会话（含 disconnected）', () => {
    const store = new TerminalSessionStore();
    expect(store.hasRemainingForWorktree('wt-1')).toBe(false);
    const record = store.create({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    expect(store.hasRemainingForWorktree('wt-1')).toBe(true);
    store.remove(record.id);
    expect(store.hasRemainingForWorktree('wt-1')).toBe(false);
  });
});
