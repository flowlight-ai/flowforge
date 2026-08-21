/**
 * LimbActionLog — T6.1 provenance 审计契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbActionLog.ts` 语义）：
 * - start 初始 pending 字段集；markRunning / complete（artifactUri）/ fail
 * - getByNode / getByCat 最近 N 条；容量淘汰最旧
 *
 * @module @flowforge/limb-core/tests
 */

import { describe, expect, it } from 'vitest';
import { LimbActionLog } from '../src/limb-action-log.js';

const BASE = {
  invocationId: 'inv-1',
  leaseId: null,
  catId: 'cat_a',
  nodeId: 'camera-01',
  capability: 'camera',
  command: 'camera.snap',
};

describe('LimbActionLog', () => {
  it('start 记录 pending 条目与最小字段集', () => {
    const log = new LimbActionLog();
    const requestId = log.start(BASE);

    const entry = log.get(requestId);
    expect(entry).toBeDefined();
    expect(entry?.requestId).toBe(requestId);
    expect(entry?.status).toBe('pending');
    expect(entry?.artifactUri).toBeNull();
    expect(entry?.endedAt).toBeNull();
    expect(entry?.idempotencyKey).toBeNull();
    expect(entry?.startedAt).toBeGreaterThan(0);
  });

  it('markRunning → complete 写入 artifactUri 与 endedAt', () => {
    const log = new LimbActionLog();
    const requestId = log.start(BASE);
    log.markRunning(requestId);
    expect(log.get(requestId)?.status).toBe('running');

    log.complete(requestId, { artifactUri: 'file:///snap.jpg' });
    const entry = log.get(requestId);
    expect(entry?.status).toBe('completed');
    expect(entry?.artifactUri).toBe('file:///snap.jpg');
    expect(entry?.endedAt).not.toBeNull();
  });

  it('complete 不带 artifactUri 保持 null；fail 置 failed', () => {
    const log = new LimbActionLog();
    const ok = log.start(BASE);
    log.complete(ok);
    expect(log.get(ok)?.artifactUri).toBeNull();

    const bad = log.start(BASE);
    log.fail(bad);
    expect(log.get(bad)?.status).toBe('failed');
    expect(log.get(bad)?.endedAt).not.toBeNull();
  });

  it('未知 requestId 的迁移操作静默忽略', () => {
    const log = new LimbActionLog();
    log.markRunning('missing');
    log.complete('missing');
    log.fail('missing');
    expect(log.get('missing')).toBeUndefined();
  });

  it('idempotencyKey 透传', () => {
    const log = new LimbActionLog();
    const requestId = log.start({ ...BASE, idempotencyKey: 'key-42' });
    expect(log.get(requestId)?.idempotencyKey).toBe('key-42');
  });

  it('getByNode/getByCat 按时间序返回最近 N 条', () => {
    const log = new LimbActionLog();
    const r1 = log.start(BASE);
    const r2 = log.start({ ...BASE, catId: 'cat_b' });
    const r3 = log.start({ ...BASE, nodeId: 'voice-01' });

    expect(log.getByNode('camera-01').map((e) => e.requestId)).toEqual([r1, r2]);
    expect(log.getByCat('cat_a').map((e) => e.requestId)).toEqual([r1, r3]);
    expect(log.getByNode('camera-01', 1).map((e) => e.requestId)).toEqual([r2]);
  });

  it('容量上限淘汰最旧条目', () => {
    const log = new LimbActionLog(2);
    const r1 = log.start(BASE);
    const r2 = log.start(BASE);
    const r3 = log.start(BASE);

    expect(log.get(r1)).toBeUndefined();
    expect(log.get(r2)).toBeDefined();
    expect(log.get(r3)).toBeDefined();
    expect(log.size).toBe(2);
  });
});
