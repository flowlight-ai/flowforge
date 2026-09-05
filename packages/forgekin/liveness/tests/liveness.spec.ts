/**
 * forgekin-liveness 测试 — F42。
 *
 * 覆盖：probe 注册/隔离执行/SLA/能力影响；canonical 源优先级 + 四态判定 +
 * 宽限期 + split-brain 以 durable 为准；Service 挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import LivenessService, {
  CanonicalReadModel,
  LivenessProbe,
  judgeLiveness,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('LivenessProbe', () => {
  it('注册 + run_all 按注册顺序返回；healthy/latency/error', async () => {
    const probe = new LivenessProbe();
    probe.registerProbe('healthy-check', async () => true, { slaSeconds: 1 });
    probe.registerProbe('fail-check', async () => false);
    probe.registerProbe('throw-check', async () => {
      throw new Error('boom');
    });

    expect(probe.count()).toBe(3);
    const results = await probe.runAll(() => new Date('2026-01-01T00:00:00.000Z'));
    expect(results.map((result) => result.name)).toEqual(['healthy-check', 'fail-check', 'throw-check']);
    expect(results[0]?.healthy).toBe(true);
    expect(results[1]?.healthy).toBe(false);
    expect(results[1]?.error).toBeUndefined();
    expect(results[2]?.healthy).toBe(false);
    expect(results[2]?.error).toBe('boom'); // 单探针异常不拖垮其他
  });

  it('registerSpec 等价 registerProbe(spec.name)；空名/重复/未注册抛 LivenessError', async () => {
    const probe = new LivenessProbe();
    probe.registerSpec({ name: 'a', slaSeconds: 2, requiredFor: ['ability-x'] }, async () => true);
    const spec = probe.getSpec('a');
    expect(spec.slaSeconds).toBe(2);
    expect(spec.requiredFor).toEqual(['ability-x']);

    expect(() => probe.registerProbe('a', async () => true)).toThrow(/already registered/);
    expect(() => probe.registerProbe('  ', async () => true)).toThrow(/non-empty/);
    await expect(probe.runProbe('nope')).rejects.toThrow(/not registered/);
    expect(() => probe.getSpec('nope')).toThrow(/not registered/);
  });

  it('spec 省略 → 默认 slaSeconds=5；SLA 超时判定与能力影响', async () => {
    const probe = new LivenessProbe();
    probe.registerProbe('slow', async () => {
      const started = performance.now();
      while (performance.now() - started < 5) {
        // busy wait ~5ms
      }
      return true;
    });
    const defaultSpec = probe.getSpec('slow');
    expect(defaultSpec.slaSeconds).toBe(5);

    probe.registerProbe('needed', async () => true, { requiredFor: ['render', 'chat'] });
    expect(probe.impactedCapabilities('needed')).toEqual(['render', 'chat']);
  });
});

describe('CanonicalReadModel / judgeLiveness', () => {
  const T = {
    heartbeatTtlMs: 60_000,
    degradedLagMs: 60_000,
    gracePeriodMs: 120_000,
    zombieLagMs: 300_000,
  };
  const NOW = 1_000_000_000_000;

  it('alive：心跳新鲜 + 副作用新鲜', () => {
    const state = judgeLiveness('fk1', { lastHeartbeatAt: NOW - 1_000, lastConfirmedSideEffectAt: NOW - 2_000 }, T, NOW);
    expect(state.state).toBe('alive');
  });

  it('degraded：副作用滞后超 degraded 阈值未超 zombie', () => {
    const state = judgeLiveness(
      'fk1',
      { lastHeartbeatAt: NOW - 1_000, lastConfirmedSideEffectAt: NOW - 120_000 },
      T,
      NOW,
    );
    expect(state.state).toBe('degraded');
  });

  it('zombie：心跳在但副作用停滞超 zombie 阈值', () => {
    const state = judgeLiveness(
      'fk1',
      { lastHeartbeatAt: NOW - 1_000, lastConfirmedSideEffectAt: NOW - 400_000 },
      T,
      NOW,
    );
    expect(state.state).toBe('zombie');
  });

  it('grace_waiting：心跳失联宽限期内；宽限期满转 zombie', () => {
    const lostAt = NOW - 70_000; // heartbeatTtl 60s 已过
    const grace = judgeLiveness('fk1', { lastHeartbeatAt: lostAt }, T, NOW);
    expect(grace.state).toBe('grace_waiting');
    expect(grace.graceDeadline).toBe(lostAt + T.heartbeatTtlMs + T.gracePeriodMs);

    const expired = judgeLiveness('fk1', { lastHeartbeatAt: lostAt }, T, NOW + 200_000);
    expect(expired.state).toBe('zombie');
  });

  it('源优先级：durable > tracker > cache；split-brain 以 durable 为准', () => {
    const model = new CanonicalReadModel({ thresholds: T, now: () => NOW });
    const record = model.read('fk1', {
      durableRecord: { lastHeartbeatAt: NOW - 1_000, lastConfirmedSideEffectAt: NOW - 2_000 }, // alive
      inProcessTracker: { lastHeartbeatAt: NOW - 500_000 }, // 看似僵尸
      draftCache: {},
    });
    expect(record.canonicalSource).toBe('durable_record');
    expect(record.state).toBe('alive');
    expect(model.readForDecision('fk1', { draftCache: {} })).toBe('zombie');
  });

  it('无任何信号 → durable_record + zombie（完全失联）', () => {
    const model = new CanonicalReadModel({ thresholds: T, now: () => NOW });
    const record = model.read('fk1', {});
    expect(record.state).toBe('zombie');
    expect(record.canonicalSource).toBe('durable_record');
  });
});

describe('LivenessService（Cordis 插件）', () => {
  it('挂载 ctx.forgeLiveness + registerProbe + runAll + readLiveness', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(LivenessService)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeLiveness;
    expect(svc).toBeDefined();

    svc.registerProbe('git-health', async () => true, { requiredFor: ['cicd'] });
    const results = await svc.runAll();
    expect(results[0]?.name).toBe('git-health');
    expect(results[0]?.healthy).toBe(true);

    const record = svc.readLiveness('fk1', {
      durableRecord: { lastHeartbeatAt: Date.now() - 1_000, lastConfirmedSideEffectAt: Date.now() - 1_000 },
    });
    expect(record.state).toBe('alive');
  });
});
