/**
 * AgentPaneRegistry 单元测试 — T6.5 agent-pane-registry.ts
 * 覆盖：register/get/list/markDone/markCrashed/remove、stale 淘汰、
 * bg carrier 追踪（thread 最新运行会话 + daemonShortId 集合）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPaneRegistry } from '../src/agent-pane-registry.js';

describe('AgentPaneRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('register 创建 running 状态记录并带 startedAt', () => {
    const registry = new AgentPaneRegistry();
    registry.register('inv-1', 'wt-1', '%0', 'u-1');
    const pane = registry.getByInvocation('inv-1');
    expect(pane).toBeDefined();
    expect(pane!.status).toBe('running');
    expect(pane!.worktreeId).toBe('wt-1');
    expect(pane!.paneId).toBe('%0');
    expect(pane!.startedAt).toBe(1_000_000);
  });

  it('listByWorktreeAndUser 按 worktree+user 过滤且排除过期 done 条目', () => {
    const registry = new AgentPaneRegistry();
    registry.register('inv-1', 'wt-1', '%0', 'u-1');
    registry.register('inv-2', 'wt-1', '%1', 'u-2');
    registry.register('inv-3', 'wt-2', '%2', 'u-1');
    // 完成但未过期（阈值 1h）
    registry.markDone('inv-1', 0);
    expect(registry.listByWorktreeAndUser('wt-1', 'u-1').map((p) => p.invocationId)).toEqual(['inv-1']);
    // 前进 2h → inv-1 过期被过滤
    vi.setSystemTime(1_000_000 + 3_600_000 * 2);
    expect(registry.listByWorktreeAndUser('wt-1', 'u-1')).toHaveLength(0);
  });

  it('markDone 记录 exitCode 与 finishedAt；markCrashed 记录 signal', () => {
    const registry = new AgentPaneRegistry();
    registry.register('inv-1', 'wt-1', '%0', 'u-1');
    registry.markDone('inv-1', 42);
    let pane = registry.getByInvocation('inv-1')!;
    expect(pane.status).toBe('done');
    expect(pane.exitCode).toBe(42);
    expect(pane.finishedAt).toBe(1_000_000);
    registry.register('inv-2', 'wt-1', '%1', 'u-1');
    registry.markCrashed('inv-2', 'SIGKILL');
    pane = registry.getByInvocation('inv-2')!;
    expect(pane.status).toBe('crashed');
    expect(pane.signal).toBe('SIGKILL');
  });

  it('markDone / markCrashed 对未注册 invocation 静默', () => {
    const registry = new AgentPaneRegistry();
    expect(() => registry.markDone('nope', 1)).not.toThrow();
    expect(() => registry.markCrashed('nope', 'SIGTERM')).not.toThrow();
  });

  it('remove 删除记录', () => {
    const registry = new AgentPaneRegistry();
    registry.register('inv-1', 'wt-1', '%0', 'u-1');
    registry.remove('inv-1');
    expect(registry.getByInvocation('inv-1')).toBeUndefined();
  });

  it('register 触发 stale 淘汰：超过 1h 的 done 条目在下次 register 时被清除', () => {
    const registry = new AgentPaneRegistry();
    registry.register('inv-old', 'wt-1', '%0', 'u-1');
    registry.markDone('inv-old', 0);
    vi.setSystemTime(1_000_000 + 3_600_000 * 2);
    registry.register('inv-new', 'wt-1', '%1', 'u-1');
    expect(registry.getByInvocation('inv-old')).toBeUndefined();
    expect(registry.getByInvocation('inv-new')).toBeDefined();
  });

  // ── bg carrier 追踪 ──────────────────────────────────────────────────────

  it('registerBgCarrier 创建 running 记录', () => {
    const registry = new AgentPaneRegistry();
    registry.registerBgCarrier({ invocationId: 'inv-1', catId: 'cat-1', daemonShortId: 'abc123', threadId: 'th-1' });
    const session = registry.getBgCarrierByInvocation('inv-1')!;
    expect(session.status).toBe('running');
    expect(session.daemonShortId).toBe('abc123');
    expect(session.startedAt).toBe(1_000_000);
  });

  it('getBgCarrierByThread 返回该 thread 最近启动的 running 会话；done 不参与', () => {
    const registry = new AgentPaneRegistry();
    registry.registerBgCarrier({ invocationId: 'inv-1', catId: 'cat-1', daemonShortId: 'a1', threadId: 'th-1' });
    vi.setSystemTime(2_000_000);
    registry.registerBgCarrier({ invocationId: 'inv-2', catId: 'cat-1', daemonShortId: 'b2', threadId: 'th-1' });
    registry.markBgCarrierDone('inv-2');
    registry.registerBgCarrier({ invocationId: 'inv-3', catId: 'cat-2', daemonShortId: 'c3', threadId: 'th-2' });
    const latest = registry.getBgCarrierByThread('th-1');
    expect(latest?.invocationId).toBe('inv-1');
    expect(registry.getBgCarrierByThread('th-2')?.invocationId).toBe('inv-3');
    expect(registry.getBgCarrierByThread('th-none')).toBeUndefined();
  });

  it('markBgCarrierDone 置 done + finishedAt', () => {
    const registry = new AgentPaneRegistry();
    registry.registerBgCarrier({ invocationId: 'inv-1', catId: 'cat-1', daemonShortId: 'a1', threadId: 'th-1' });
    registry.markBgCarrierDone('inv-1');
    const session = registry.getBgCarrierByInvocation('inv-1')!;
    expect(session.status).toBe('done');
    expect(session.finishedAt).toBe(1_000_000);
  });

  it('getRegisteredDaemonShortIds 聚合 running + done 的全部 daemonShortId', () => {
    const registry = new AgentPaneRegistry();
    registry.registerBgCarrier({ invocationId: 'inv-1', catId: 'cat-1', daemonShortId: 'a1', threadId: 'th-1' });
    registry.registerBgCarrier({ invocationId: 'inv-2', catId: 'cat-1', daemonShortId: 'b2', threadId: 'th-2' });
    registry.markBgCarrierDone('inv-2');
    expect(registry.getRegisteredDaemonShortIds()).toEqual(new Set(['a1', 'b2']));
  });
});
