/**
 * WriteAheadLog — F21 Side-Effect WAL 契约验证。
 *
 * 移植自 `tests/core/reliability/test_wal.py` 的 WriteAheadLog spec（P-79）：
 *   - append 返回 id 且 get 可往返
 *   - append 深拷贝 params（调用方后续修改不影响已存记录）
 *   - get 未知 id 抛 StoresError
 *   - append 拒绝空 action / target
 *   - mark_committed / mark_rolled_back 状态转移 + 非法转移拦截
 *   - list_uncommitted 只返回 PENDING（崩溃恢复重放入口）
 *   - count 保留已 settle 记录作审计
 *
 * @module @flowforge/forgekin-stores/tests
 */

import { describe, expect, it } from 'vitest';
import { StoresError, WalStatus, WriteAheadLog } from '../src/wal.js';

describe('WriteAheadLog append / get', () => {
  it('append 返回 id，get 可往返（action/target/params/status/created_at）', async () => {
    const wal = new WriteAheadLog();
    const entry_id = await wal.append(
      'publish_article',
      'wechat:column-life',
      { title: '晨间手记', tags: ['life', 'morning'] },
    );

    expect(typeof entry_id).toBe('string');
    expect(entry_id.length).toBeGreaterThan(0);

    const entry = await wal.get(entry_id);
    expect(entry.entry_id).toBe(entry_id);
    expect(entry.action).toBe('publish_article');
    expect(entry.target).toBe('wechat:column-life');
    expect(entry.params['title']).toBe('晨间手记');
    expect(entry.params['tags']).toEqual(['life', 'morning']);
    expect(entry.status).toBe(WalStatus.PENDING);
    expect(entry.created_at).toBeTruthy();
  });

  it('append 深拷贝 params：调用方修改不影响已存记录', async () => {
    const wal = new WriteAheadLog();
    const params: Record<string, unknown> = { payload: 'draft-v1' };
    const entry_id = await wal.append('save', 'db:articles', params);

    params['payload'] = 'draft-v2-MUTATED';
    params['injected'] = true;

    const entry = await wal.get(entry_id);
    expect(entry.params).toEqual({ payload: 'draft-v1' });
  });

  it('get 未知 id 抛 StoresError', async () => {
    const wal = new WriteAheadLog();
    await expect(wal.get('nonexistent-id')).rejects.toThrow(StoresError);
  });

  it('append 拒绝空 action 或空 target', async () => {
    const wal = new WriteAheadLog();
    await expect(wal.append('', 'target')).rejects.toThrow(StoresError);
    await expect(wal.append('action', '')).rejects.toThrow(StoresError);
  });
});

describe('WriteAheadLog mark_committed / mark_rolled_back', () => {
  it('mark_committed 转移 PENDING → COMMITTED', async () => {
    const wal = new WriteAheadLog();
    const entry_id = await wal.append('send_email', 'smtp:server-1', { to: 'user@x.com' });

    await wal.mark_committed(entry_id);
    const entry = await wal.get(entry_id);
    expect(entry.status).toBe(WalStatus.COMMITTED);
  });

  it('mark_rolled_back 转移 PENDING → ROLLED_BACK', async () => {
    const wal = new WriteAheadLog();
    const entry_id = await wal.append('charge_card', 'stripe:acct-9', { amount: 4200 });

    await wal.mark_rolled_back(entry_id);
    const entry = await wal.get(entry_id);
    expect(entry.status).toBe(WalStatus.ROLLED_BACK);
  });

  it('mark_committed 未知 id 抛 StoresError', async () => {
    const wal = new WriteAheadLog();
    await expect(wal.mark_committed('ghost')).rejects.toThrow(StoresError);
  });

  it('非法转移一律拦截：重复提交 / 已提交再回滚', async () => {
    const wal = new WriteAheadLog();
    const entry_id = await wal.append('a', 'b');
    await wal.mark_committed(entry_id);
    // COMMITTED -> COMMITTED is illegal
    await expect(wal.mark_committed(entry_id)).rejects.toThrow(StoresError);
    // COMMITTED -> ROLLED_BACK is illegal
    await expect(wal.mark_rolled_back(entry_id)).rejects.toThrow(StoresError);
  });
});

describe('WriteAheadLog list_uncommitted / count', () => {
  it('list_uncommitted 只返回 PENDING 记录', async () => {
    const wal = new WriteAheadLog();
    const e1 = await wal.append('a', 't1');
    const e2 = await wal.append('b', 't2');
    const e3 = await wal.append('c', 't3');
    const e4 = await wal.append('d', 't4');

    await wal.mark_committed(e1);
    await wal.mark_rolled_back(e3);

    const uncommitted = await wal.list_uncommitted();
    const uncommitted_ids = new Set(uncommitted.map((e) => e.entry_id));
    expect(uncommitted_ids).toEqual(new Set([e2, e4]));
    // Every returned entry must be PENDING.
    expect(uncommitted.every((e) => e.status === WalStatus.PENDING)).toBe(true);
  });

  it('全部 settle 后 list_uncommitted 为空，count 保留审计记录', async () => {
    const wal = new WriteAheadLog();
    const e1 = await wal.append('a', 't1');
    const e2 = await wal.append('b', 't2');
    await wal.mark_committed(e1);
    await wal.mark_rolled_back(e2);

    expect(await wal.list_uncommitted()).toEqual([]);
    expect(wal.count()).toBe(2);
  });
});
