/**
 * C24 Ball Custody State Machine + Projector 测试（移植自 clowder-ai F233 Phase B）。
 *
 * 覆盖：
 *  - INV-10 穷举：全 8 state × 17 event 每格行为确定（转移 or 显式 reject）
 *  - 动态 resolver 守卫：handed_cvo intent 三态 / hold_expired fireAt 匹配 / heartbeat grace
 *  - Projector：字段 effect（holder/intent/heldUntil/blockedSinceAt/lastWakeAt/lastScanAt）
 *    + stale 清理 + rejected 记录 + rebuild 无漂移（INV-2）
 *  - 事件日志幂等 append（sourceEventId 去重）
 */

import { describe, expect, it } from 'vitest';
import type { BallCustodyEvent, BallEventKind, BallState } from '../src/models.js';
import {
  ALL_BALL_EVENT_KINDS,
  ALL_BALL_STATES,
  DEAD_BALL_ZOMBIE_GRACE_MS,
  transition,
} from '../src/state-machine.js';
import {
  BallCustodyProjector,
  InMemoryBallCustodyEventLog,
  InMemoryBallCustodyProjectionStore,
} from '../src/projector.js';

const T0 = 1_700_000_000_000;

/** 构造事件（subject 固定 ball:thread:42）。 */
function ev(
  kind: BallEventKind,
  payload: Record<string, unknown> = {},
  at = T0,
  subjectKey = 'ball:thread:42',
): BallCustodyEvent {
  return {
    sourceEventId: `${subjectKey}:${kind}:${at}:${Math.random().toString(16).slice(2, 10)}`,
    subjectKey,
    kind,
    classification: kind === 'ball.wake_sent' ? 'informational' : 'state-changing',
    payload,
    at,
  };
}

function snapshot(heldUntil: number | null = null, lastStateChangeAt = T0) {
  return { heldUntil, lastStateChangeAt };
}

// ─── INV-10 穷举：每格行为确定 ────────────────────────────────────────────

describe('C24 INV-10：8 state × 17 event 穷举（每格转移 or 显式 reject）', () => {
  it('每个 state × event 组合都返回 ok 或显式 reject（无抛错、无 undefined）', () => {
    for (const state of ALL_BALL_STATES) {
      for (const kind of ALL_BALL_EVENT_KINDS) {
        const result = transition(state, ev(kind), snapshot());
        expect(result.ok === true || result.ok === false).toBe(true);
        if (!result.ok) {
          expect(['invalid_transition', 'bad_payload']).toContain(result.reason);
        }
      }
    }
  });

  it('ALL_BALL_EVENT_KINDS 覆盖全部 17 种 kind（与 models 联合类型一致）', () => {
    expect(ALL_BALL_EVENT_KINDS).toHaveLength(17);
    // 每种 kind 至少在一个状态下转移成功（无死规则）；handed_cvo 需带合法 intent，
    // hold_expired 需 fireAt 匹配 snapshot.heldUntil（动态守卫）
    for (const kind of ALL_BALL_EVENT_KINDS) {
      const payload = kind === 'ball.handed_cvo' ? { intent: 'handoff' } : kind === 'ball.hold_expired' ? { fireAt: T0 + 60_000 } : {};
      const snap = kind === 'ball.hold_expired' ? snapshot(T0 + 60_000) : snapshot();
      const accepted = ALL_BALL_STATES.some((s) => transition(s, ev(kind, payload), snap).ok);
      expect(accepted, `${kind} 应有至少一个接受态`).toBe(true);
    }
  });

  it('每个 state 至少接受一种事件（无不可达态）', () => {
    for (const state of ALL_BALL_STATES) {
      const accepted = ALL_BALL_EVENT_KINDS.some((kind) => transition(state, ev(kind), snapshot()).ok);
      expect(accepted, `${state} 应至少接受一种事件`).toBe(true);
    }
  });
});

// ─── 静态转移表关键格 ─────────────────────────────────────────────────────

describe('C24 静态转移表（关键格）', () => {
  it('ball.handed 任意态 → active（含 resolved 重开）', () => {
    for (const state of ALL_BALL_STATES) {
      const r = transition(state, ev('ball.handed', { toCatId: 'cat-a' }), snapshot());
      expect(r).toEqual({ ok: true, next: 'active' });
    }
  });

  it('task.done 任意态 → resolved（唯一正常终结，resolved 幂等不复活）', () => {
    for (const state of ALL_BALL_STATES) {
      const r = transition(state, ev('task.done'), snapshot());
      expect(r).toEqual({ ok: true, next: 'resolved' });
    }
  });

  it('invocation.died 仅 active/blocked → dead', () => {
    expect(transition('active', ev('invocation.died'), snapshot())).toEqual({ ok: true, next: 'dead' });
    expect(transition('blocked', ev('invocation.died'), snapshot())).toEqual({ ok: true, next: 'dead' });
    expect(transition('new', ev('invocation.died'), snapshot()).ok).toBe(false);
    expect(transition('resolved', ev('invocation.died'), snapshot()).ok).toBe(false);
  });

  it('task.blocked → blocked（new/active/void/zombie/parked 可；不落 dead/resolved）', () => {
    for (const s of ['new', 'active', 'void', 'zombie', 'parked'] as BallState[]) {
      expect(transition(s, ev('task.blocked'), snapshot())).toEqual({ ok: true, next: 'blocked' });
    }
    expect(transition('dead', ev('task.blocked'), snapshot()).ok).toBe(false);
    expect(transition('resolved', ev('task.blocked'), snapshot()).ok).toBe(false);
  });

  it('task.unblocked 仅 blocked/zombie → active', () => {
    expect(transition('blocked', ev('task.unblocked'), snapshot())).toEqual({ ok: true, next: 'active' });
    expect(transition('zombie', ev('task.unblocked'), snapshot())).toEqual({ ok: true, next: 'active' });
    expect(transition('active', ev('task.unblocked'), snapshot()).ok).toBe(false);
  });

  it('task.idle_long → zombie（active/blocked/parked/void 可）', () => {
    for (const s of ['active', 'blocked', 'parked', 'void'] as BallState[]) {
      expect(transition(s, ev('task.idle_long'), snapshot())).toEqual({ ok: true, next: 'zombie' });
    }
    expect(transition('dead', ev('task.idle_long'), snapshot()).ok).toBe(false);
  });

  it('ball.void_pass → void（new/active/blocked/parked 可）', () => {
    for (const s of ['new', 'active', 'blocked', 'parked'] as BallState[]) {
      expect(transition(s, ev('ball.void_pass'), snapshot())).toEqual({ ok: true, next: 'void' });
    }
    expect(transition('dead', ev('ball.void_pass'), snapshot()).ok).toBe(false);
  });

  it('ball.held → active（new/active 可，heldUntil 由 projector 设）', () => {
    expect(transition('new', ev('ball.held', { catId: 'cat-a', fireAt: T0 + 60_000 }), snapshot())).toEqual({
      ok: true,
      next: 'active',
    });
    expect(transition('blocked', ev('ball.held'), snapshot()).ok).toBe(false);
  });

  it('invocation.started 仅 active/blocked → active', () => {
    expect(transition('active', ev('invocation.started'), snapshot())).toEqual({ ok: true, next: 'active' });
    expect(transition('blocked', ev('invocation.started'), snapshot())).toEqual({ ok: true, next: 'active' });
    expect(transition('new', ev('invocation.started'), snapshot()).ok).toBe(false);
  });

  it('ball.wake_sent 仅 blocked 接受（informational，state 不变）', () => {
    expect(transition('blocked', ev('ball.wake_sent'), snapshot())).toEqual({ ok: true, next: 'blocked' });
    expect(transition('active', ev('ball.wake_sent'), snapshot()).ok).toBe(false);
  });

  it('ball.wake_condition_met 仅 active → active', () => {
    expect(transition('active', ev('ball.wake_condition_met'), snapshot())).toEqual({ ok: true, next: 'active' });
    expect(transition('blocked', ev('ball.wake_condition_met'), snapshot()).ok).toBe(false);
  });

  it('Phase C 安乐死三 kind：7 非-resolved → resolved；resolved 自然 reject', () => {
    const nonResolved = ['new', 'active', 'blocked', 'parked', 'dead', 'void', 'zombie'] as BallState[];
    for (const kind of ['ball.frozen', 'ball.degraded', 'ball.abandoned'] as BallEventKind[]) {
      for (const s of nonResolved) {
        expect(transition(s, ev(kind), snapshot())).toEqual({ ok: true, next: 'resolved' });
      }
      expect(transition('resolved', ev(kind), snapshot()).ok).toBe(false);
    }
  });
});

// ─── 动态 resolver 守卫 ───────────────────────────────────────────────────

describe('C24 动态 resolver：handed_cvo intent 三态', () => {
  it('handoff → parked；done_notify → resolved；fyi → state 不变', () => {
    expect(transition('active', ev('ball.handed_cvo', { intent: 'handoff' }), snapshot())).toEqual({
      ok: true,
      next: 'parked',
    });
    expect(transition('blocked', ev('ball.handed_cvo', { intent: 'done_notify' }), snapshot())).toEqual({
      ok: true,
      next: 'resolved',
    });
    expect(transition('active', ev('ball.handed_cvo', { intent: 'fyi' }), snapshot())).toEqual({
      ok: true,
      next: 'active',
    });
  });

  it('intent 非法 → bad_payload（校验先于 from 限制）；dead/resolved → invalid_transition', () => {
    expect(transition('active', ev('ball.handed_cvo', { intent: 'sideways' }), snapshot())).toEqual({
      ok: false,
      reason: 'bad_payload',
    });
    expect(transition('dead', ev('ball.handed_cvo', { intent: 'handoff' }), snapshot())).toEqual({
      ok: false,
      reason: 'invalid_transition',
    });
    expect(transition('resolved', ev('ball.handed_cvo', { intent: 'handoff' }), snapshot()).ok).toBe(false);
  });
});

describe('C24 动态 resolver：hold_expired fireAt 匹配', () => {
  it('active 且 fireAt === heldUntil → dead（防旧 reminder 误杀新 hold）', () => {
    const fireAt = T0 + 60_000;
    expect(transition('active', ev('ball.hold_expired', { fireAt }), snapshot(fireAt))).toEqual({
      ok: true,
      next: 'dead',
    });
    // fireAt 不匹配当前 heldUntil → 拒绝
    expect(transition('active', ev('ball.hold_expired', { fireAt }), snapshot(T0 + 999))).toEqual({
      ok: false,
      reason: 'invalid_transition',
    });
    // 非 active 拒绝
    expect(transition('blocked', ev('ball.hold_expired', { fireAt }), snapshot(fireAt)).ok).toBe(false);
    // 缺 fireAt → bad_payload
    expect(transition('active', ev('ball.hold_expired'), snapshot(fireAt))).toEqual({
      ok: false,
      reason: 'bad_payload',
    });
  });
});

describe('C24 动态 resolver：heartbeat grace 窗口', () => {
  it('active 心跳 → active（续）', () => {
    expect(transition('active', ev('invocation.heartbeat', {}, T0 + 10_000), snapshot())).toEqual({
      ok: true,
      next: 'active',
    });
  });

  it('dead 心跳在 (0, GRACE] 窗口内复活 → active；超窗/负差拒绝', () => {
    const diedAt = T0;
    const okAt = T0 + DEAD_BALL_ZOMBIE_GRACE_MS; // 恰在窗口边界
    expect(transition('dead', ev('invocation.heartbeat', {}, okAt), snapshot(null, diedAt))).toEqual({
      ok: true,
      next: 'active',
    });
    expect(transition('dead', ev('invocation.heartbeat', {}, T0 + 1), snapshot(null, diedAt))).toEqual({
      ok: true,
      next: 'active',
    });
    // 超窗（> GRACE）
    expect(transition('dead', ev('invocation.heartbeat', {}, T0 + DEAD_BALL_ZOMBIE_GRACE_MS + 1), snapshot(null, diedAt)).ok).toBe(false);
    // 负差（心跳早于死亡时刻，不可能）
    expect(transition('dead', ev('invocation.heartbeat', {}, T0 - 1), snapshot(null, diedAt)).ok).toBe(false);
    // 其他态拒绝
    expect(transition('new', ev('invocation.heartbeat'), snapshot()).ok).toBe(false);
  });
});

// ─── Projector：字段 effect + stale 清理 + reject 记录 ───────────────────

describe('C24 Projector：apply 字段效果 + 生命周期', () => {
  async function makeProjector() {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);
    return { log, store, projector };
  }

  it('完整生命周期：new → active → blocked → active → resolved，字段随事件更新', async () => {
    const { log, store, projector } = await makeProjector();
    const t = (ms: number) => T0 + ms;

    await log.append(ev('ball.handed', { toCatId: 'cat-a' }, t(0)));
    await projector.apply(ev('ball.handed', { toCatId: 'cat-a' }, t(0)));
    let p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');
    expect(p.holder).toBe('cat-a');
    expect(p.appliedEventCount).toBe(1);

    await log.append(ev('invocation.started', {}, t(1_000)));
    await projector.apply(ev('invocation.started', {}, t(1_000)));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');

    await log.append(ev('task.blocked', { resolveMode: 'bounces_back' }, t(2_000)));
    await projector.apply(ev('task.blocked', { resolveMode: 'bounces_back' }, t(2_000)));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('blocked');
    expect(p.blockedSinceAt).toBe(t(2_000));
    expect(p.resolveMode).toBe('bounces_back');

    await log.append(ev('ball.wake_sent', {}, t(3_000)));
    await projector.apply(ev('ball.wake_sent', {}, t(3_000)));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('blocked'); // informational 不改 state
    expect(p.lastWakeAt).toBe(t(3_000));

    await log.append(ev('task.unblocked', {}, t(4_000)));
    await projector.apply(ev('task.unblocked', {}, t(4_000)));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');
    // stale 清理：离开 blocked 清 blockedSinceAt/lastWakeAt/resolveMode
    expect(p.blockedSinceAt).toBeNull();
    expect(p.lastWakeAt).toBeNull();
    expect(p.resolveMode).toBeNull();

    await log.append(ev('task.done', {}, t(5_000)));
    await projector.apply(ev('task.done', {}, t(5_000)));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('resolved');
    expect(p.appliedEventCount).toBe(6);
    expect(p.lastStateChangeAt).toBe(t(5_000));
  });

  it('ball.held 设 heldUntil；hold_expired 匹配后 dead + lastScanAt 记录', async () => {
    const { log, store, projector } = await makeProjector();
    const fireAt = T0 + 60_000;

    await log.append(ev('ball.held', { catId: 'cat-a', fireAt }, T0));
    await projector.apply(ev('ball.held', { catId: 'cat-a', fireAt }, T0));
    let p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');
    expect(p.holder).toBe('cat-a');
    expect(p.heldUntil).toBe(fireAt);

    await log.append(ev('ball.hold_expired', { fireAt }, T0 + 60_001));
    await projector.apply(ev('ball.hold_expired', { fireAt }, T0 + 60_001));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('dead');
    // stale 清理：离开 active 清 heldUntil
    expect(p.heldUntil).toBeNull();

    await log.append(ev('invocation.died', { lastScanAt: T0 + 70_000 }, T0 + 70_000));
    await projector.apply(ev('invocation.died', { lastScanAt: T0 + 70_000 }, T0 + 70_000));
    // dead 态不接受 invocation.died → rejected 记录（state-changing）
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('dead');
    expect(p.lastRejectedEvent?.kind).toBe('invocation.died');
  });

  it('held 球换 holder（ball.handed）清 heldUntil（防旧 hold_expired 误杀）', async () => {
    const { log, store, projector } = await makeProjector();
    await log.append(ev('ball.held', { catId: 'cat-a', fireAt: T0 + 60_000 }, T0));
    await projector.apply(ev('ball.held', { catId: 'cat-a', fireAt: T0 + 60_000 }, T0));
    await log.append(ev('ball.handed', { toCatId: 'cat-b' }, T0 + 1_000));
    await projector.apply(ev('ball.handed', { toCatId: 'cat-b' }, T0 + 1_000));
    const p = (await store.get('ball:thread:42'))!;
    expect(p.holder).toBe('cat-b');
    expect(p.heldUntil).toBeNull();
  });

  it('handed_cvo handoff → parked 且 holder=cvo、intent 记录；离开 parked 清 intent', async () => {
    const { log, store, projector } = await makeProjector();
    await log.append(ev('ball.handed', { toCatId: 'cat-a' }, T0));
    await projector.apply(ev('ball.handed', { toCatId: 'cat-a' }, T0));
    await log.append(ev('ball.handed_cvo', { intent: 'handoff' }, T0 + 1_000));
    await projector.apply(ev('ball.handed_cvo', { intent: 'handoff' }, T0 + 1_000));
    let p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('parked');
    expect(p.holder).toBe('cvo');
    expect(p.intent).toBe('handoff');

    await log.append(ev('ball.handed', { toCatId: 'cat-a' }, T0 + 2_000));
    await projector.apply(ev('ball.handed', { toCatId: 'cat-a' }, T0 + 2_000));
    p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');
    expect(p.intent).toBeNull();
  });

  it('informational reject（wake_sent 非 blocked）不记 lastRejectedEvent', async () => {
    const { log, store, projector } = await makeProjector();
    await log.append(ev('ball.handed', { toCatId: 'cat-a' }, T0));
    await projector.apply(ev('ball.handed', { toCatId: 'cat-a' }, T0));
    await log.append(ev('ball.wake_sent', {}, T0 + 1_000));
    await projector.apply(ev('ball.wake_sent', {}, T0 + 1_000));
    const p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('active');
    expect(p.lastRejectedEvent).toBeNull();
  });
});

// ─── Projector：rebuild 一致性 + 幂等 append ──────────────────────────────

describe('C24 Projector：rebuild 无漂移（INV-2）+ 幂等', () => {
  it('rebuild(replay) 后 projection 逐字段一致', async () => {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);

    const events = [
      ev('ball.handed', { toCatId: 'cat-a' }, T0),
      ev('task.blocked', { resolveMode: 'completes' }, T0 + 1_000),
      ev('ball.wake_sent', {}, T0 + 2_000),
      ev('task.unblocked', {}, T0 + 3_000),
      ev('invocation.died', { lastScanAt: T0 + 4_000 }, T0 + 4_000),
    ];
    for (const e of events) {
      await log.append(e);
      await projector.apply(e);
    }
    const before = (await store.get('ball:thread:42'))!;
    expect(before.state).toBe('dead');
    expect(before.lastScanAt).toBe(T0 + 4_000);

    await projector.rebuild('ball:thread:42');
    const after = (await store.get('ball:thread:42'))!;
    expect(after).toEqual(before);
    expect(after.appliedEventCount).toBe(before.appliedEventCount);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('rebuildAll 重建所有 subject', async () => {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);
    for (const key of ['ball:thread:1', 'ball:thread:2']) {
      const e = ev('ball.handed', { toCatId: 'cat-a' }, T0, key);
      await log.append(e);
      await projector.apply(e);
    }
    await projector.rebuildAll();
    expect((await store.get('ball:thread:1'))!.state).toBe('active');
    expect((await store.get('ball:thread:2'))!.state).toBe('active');
  });

  it('append 幂等：sourceEventId 重复返回 {appended:false} 且不重复应用', async () => {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);
    const e = ev('ball.handed', { toCatId: 'cat-a' }, T0);
    const first = await log.append(e);
    const second = await log.append(e);
    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    expect(second.sequence).toBe(-1);
    await projector.apply(e);
    const p = (await store.get('ball:thread:42'))!;
    expect(p.appliedEventCount).toBe(1);
    expect((await log.read('ball:thread:42')).length).toBe(1);
  });

  it('rejected 事件不增加 appliedEventCount（lastRejectedEvent 仅 state-changing）', async () => {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);
    // 直接 apply 未在 log 中的事件（log 后置场景由调用方保证 append first，这里只测 store 语义）
    await projector.apply(ev('task.blocked', {}, T0));
    await projector.apply(ev('task.blocked', {}, T0 + 1_000));
    const p = (await store.get('ball:thread:42'))!;
    expect(p.state).toBe('blocked'); // 首事件 accepted
    expect(p.appliedEventCount).toBe(1);
    // 第二次 task.blocked 从 blocked → blocked 仍 accepted（state 相同）
  });

  it('rebuild 空 subject 不产生投影（delete 后无事件则无保存）', async () => {
    const log = new InMemoryBallCustodyEventLog();
    const store = new InMemoryBallCustodyProjectionStore();
    const projector = new BallCustodyProjector(log, store);
    await projector.rebuild('ball:thread:never');
    expect(await store.get('ball:thread:never')).toBeNull();
  });
});
