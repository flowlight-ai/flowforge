/**
 * F006 PushBackProtocol 测试 — Phase A 全 10 AC + 不变量。
 *
 * 覆盖：AC-A1 8 字段 / AC-A2~A5 三要素强制 / AC-A6 pb-{10hex} /
 * AC-A7 resolve 后 resolved=True / AC-A8 未知 id 抛错 / AC-A9 空 resolution 抛错 /
 * AC-A10 list_unresolved 过滤。
 */

import { describe, expect, it } from 'vitest';
import { BallCustodyError } from '../src/models.js';
import { PushBackProtocol } from '../src/push-back.js';

const EVIDENCE = ['7f3a9c2e1d0b4f8a6c5e9d3b2a1f0c4e']; // 假 commit sha 形状的 anchor（仅测试）

describe('F006 AC-A1：PushBack 含 8 字段', () => {
  it('创建结果含 from_owner / to_owner / reason / evidence / created_at / resolved / resolution / push_back_id', () => {
    const pb = new PushBackProtocol();
    const created = pb.createPushBack('alice', 'bob', 'review 意见不适用', EVIDENCE);
    expect(created).toMatchObject({
      from_owner: 'alice',
      to_owner: 'bob',
      reason: 'review 意见不适用',
      evidence: EVIDENCE,
      resolved: false,
      resolution: '',
    });
    expect(typeof created.created_at).toBe('number');
    expect(typeof created.push_back_id).toBe('string');
    // 8 字段清单
    const fields = Object.keys(created).sort();
    expect(fields).toEqual(
      ['created_at', 'evidence', 'from_owner', 'push_back_id', 'reason', 'resolved', 'resolution', 'to_owner'].sort(),
    );
  });
});

describe('F006 AC-A2~A5：推回三要素强制（RA-015）', () => {
  const pb = new PushBackProtocol();
  it('from_owner 为空抛错', () => {
    expect(() => pb.createPushBack('', 'bob', '理由', EVIDENCE)).toThrowError(BallCustodyError);
    expect(() => pb.createPushBack('   ', 'bob', '理由', EVIDENCE)).toThrowError(/from_owner 不能为空/);
  });
  it('to_owner 为空抛错', () => {
    expect(() => pb.createPushBack('alice', '', '理由', EVIDENCE)).toThrowError(/to_owner 不能为空/);
  });
  it('reason 为空抛错（无理由推回非法）', () => {
    expect(() => pb.createPushBack('alice', 'bob', '', EVIDENCE)).toThrowError(/reason 不能为空/);
  });
  it('evidence 为空列表抛错（无证据推回非法，T2 铁律）', () => {
    expect(() => pb.createPushBack('alice', 'bob', '理由', [])).toThrowError(/evidence 至少需要一个 anchor/);
  });
  it('三要素齐全创建成功', () => {
    const created = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(created.resolved).toBe(false);
  });
});

describe('F006 AC-A6：push_back_id 自动生成 pb-{10hex}', () => {
  it('格式为 pb- + 10 位 hex 且全局唯一', () => {
    const pb = new PushBackProtocol();
    const a = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    const b = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(a.push_back_id).toMatch(/^pb-[0-9a-f]{10}$/);
    expect(a.push_back_id).not.toBe(b.push_back_id);
  });
});

describe('F006 AC-A7：resolve 显式关闭', () => {
  it('resolve 后 resolved=True 且 resolution 非空', () => {
    const pb = new PushBackProtocol();
    const created = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(created.resolved).toBe(false);
    pb.resolve(created.push_back_id, 'accept: 评审重新评估后同意推回');
    const after = pb.get(created.push_back_id);
    expect(after.resolved).toBe(true);
    expect(after.resolution).toBe('accept: 评审重新评估后同意推回');
  });

  it('resolve 幂等（二次 resolve 不抛错，覆盖 resolution）', () => {
    const pb = new PushBackProtocol();
    const created = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    pb.resolve(created.push_back_id, 'accept');
    pb.resolve(created.push_back_id, 'escalate: 升级 operator');
    expect(pb.get(created.push_back_id).resolution).toBe('escalate: 升级 operator');
  });
});

describe('F006 AC-A8：resolve 未知 id 抛错', () => {
  it('未知 push_back_id 抛 TeamActError 语义错误', () => {
    const pb = new PushBackProtocol();
    expect(() => pb.resolve('pb-0000000000', 'accept')).toThrowError(BallCustodyError);
    expect(() => pb.resolve('pb-0000000000', 'accept')).toThrowError(/unknown push_back_id/);
  });
});

describe('F006 AC-A9：resolve 空 resolution 抛错', () => {
  it('空 resolution 禁静默关闭（INV-3）', () => {
    const pb = new PushBackProtocol();
    const created = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(() => pb.resolve(created.push_back_id, '')).toThrowError(/resolution 不能为空/);
    expect(() => pb.resolve(created.push_back_id, '   ')).toThrowError(/resolution 不能为空/);
    // 未关闭
    expect(pb.get(created.push_back_id).resolved).toBe(false);
  });
});

describe('F006 AC-A10：list_unresolved 只返回未解决推回', () => {
  it('混合场景过滤正确，list_all 全量按创建序', () => {
    const pb = new PushBackProtocol();
    const a = pb.createPushBack('alice', 'bob', '理由 A', EVIDENCE);
    const b = pb.createPushBack('carol', 'dave', '理由 B', EVIDENCE);
    const c = pb.createPushBack('erin', 'frank', '理由 C', EVIDENCE);
    pb.resolve(b.push_back_id, 'reject: 维持原 review');
    expect(pb.listUnresolved().map((x) => x.push_back_id)).toEqual([a.push_back_id, c.push_back_id]);
    expect(pb.listUnresolved().every((x) => !x.resolved)).toBe(true);
    expect(pb.listAll().map((x) => x.push_back_id)).toEqual([a.push_back_id, b.push_back_id, c.push_back_id]);
  });
});

describe('F006 get 语义', () => {
  it('get 返回同一实例内容；未知 id 抛错', () => {
    const pb = new PushBackProtocol();
    const created = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(pb.get(created.push_back_id)).toMatchObject({ from_owner: 'alice', to_owner: 'bob' });
    expect(() => pb.get('pb-0000000000')).toThrowError(/unknown push_back_id/);
  });
});

describe('F006 created_at 时间注入', () => {
  it('now_fn 注入确定性时间（对齐 F005 INV-5 惯例）', () => {
    let now = 1_700_000_000_000;
    const pb = new PushBackProtocol(() => now);
    const a = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(a.created_at).toBe(1_700_000_000_000);
    now += 5_000;
    const b = pb.createPushBack('alice', 'bob', '理由', EVIDENCE);
    expect(b.created_at).toBe(1_700_000_005_000);
    expect(pb.listAll().map((x) => x.created_at)).toEqual([1_700_000_000_000, 1_700_000_005_000]);
  });
});
