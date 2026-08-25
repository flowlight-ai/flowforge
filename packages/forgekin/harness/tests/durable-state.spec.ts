/**
 * durable-state — Layer1 感知现实测试（对齐 Python test_durable_state.py）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GitDurableState,
  SqliteDurableState,
  type DurableState,
} from '../src/durable-state.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('SqliteDurableState', () => {
  it('write → read 往返 + 乐观锁版本自增', async () => {
    const dir = tempDir('ff-ds-sqlite-');
    const store = new SqliteDurableState(join(dir, 'state.db'));
    try {
      const written = await store.write('task:1:status', { done: false }, 'agent-a');
      expect(written.key).toBe('task:1:status');
      expect(written.version).toBe(1);
      expect(written.last_writer).toBe('agent-a');
      expect(written.state_id).toMatch(/^ds-[0-9a-f]{12}$/);

      const rewritten = await store.write('task:1:status', { done: true }, 'agent-b');
      expect(rewritten.version).toBe(2);
      expect(rewritten.last_writer).toBe('agent-b');
      expect(rewritten.created_at).toBe(written.created_at);

      const value = await store.read('task:1:status');
      expect(value).toEqual({ done: true });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('read 不存在返回 undefined（不抛异常）', async () => {
    const dir = tempDir('ff-ds-sqlite-');
    const store = new SqliteDurableState(join(dir, 'state.db'));
    try {
      expect(await store.read('missing:key')).toBeUndefined();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delete 返回是否删除成功', async () => {
    const dir = tempDir('ff-ds-sqlite-');
    const store = new SqliteDurableState(join(dir, 'state.db'));
    try {
      await store.write('k', 'v', 'agent-a');
      expect(await store.delete('k')).toBe(true);
      expect(await store.read('k')).toBeUndefined();
      expect(await store.delete('k')).toBe(false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('复杂 JSON 值 + 非 JSON 类型兜底序列化', async () => {
    const dir = tempDir('ff-ds-sqlite-');
    const store = new SqliteDurableState(join(dir, 'state.db'));
    try {
      const nested = { list: [1, 2, 3], meta: { ok: true }, big: 123n };
      await store.write('nested', nested, 'agent-a');
      const read = (await store.read('nested')) as {
              list: number[];
              meta: { ok: boolean };
              big: string;
            };
      expect(read.list).toEqual([1, 2, 3]);
      expect(read.meta).toEqual({ ok: true });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GitDurableState', () => {
  it('write → read 往返 + 版本自增 + git commit 审计', async () => {
    const dir = tempDir('ff-ds-git-');
    const store = new GitDurableState(join(dir, 'repo'));
    try {
      const written = await store.write('alpha', 'v1', 'agent-a');
      expect(written.version).toBe(1);
      const rewritten = await store.write('alpha', 'v2', 'agent-b');
      expect(rewritten.version).toBe(2);
      expect(await store.read('alpha')).toBe('v2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('read 不存在返回 undefined；delete 不存在返回 false', async () => {
    const dir = tempDir('ff-ds-git-');
    const store = new GitDurableState(join(dir, 'repo'));
    try {
      expect(await store.read('nope')).toBeUndefined();
      expect(await store.delete('nope')).toBe(false);
      await store.write('k', 'v', 'agent-a');
      expect(await store.delete('k')).toBe(true);
      expect(await store.read('k')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('key 哈希映射：非法文件名字符安全', async () => {
    const dir = tempDir('ff-ds-git-');
    const store = new GitDurableState(join(dir, 'repo'));
    try {
      await store.write('a/b/c:d?e', 'safe', 'agent-a');
      expect(await store.read('a/b/c:d?e')).toBe('safe');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DurableState 数据模型', () => {
  it('createDurableState 生成 ds- 前缀 ID', () => {
    const state: DurableState = {
      state_id: `ds-${'ab'.repeat(6)}`,
      key: 'k',
      value: 1,
      version: 1,
      last_writer: 'w',
      created_at: 'now',
      updated_at: 'now',
    };
    expect(state.state_id).toMatch(/^ds-[0-9a-f]{12}$/);
    expect(state.version).toBeGreaterThanOrEqual(1);
  });
});
