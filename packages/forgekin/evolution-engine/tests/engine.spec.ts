/**
 * engine — T7.20 ForgeMindEngine 三模式治理引擎验证。
 *
 * 覆盖：evaluate auto/单模式 / 触发阈值（2 普通或 1 强）/
 * execute 按 mode 分发 / SelfDev 闭环注册表（DI + 红线 9）/ 成熟度委托。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import type { SelfDevLoopBase } from '@flowforge/forgekin-loops';
import { ForgeMindEngine } from '../src/engine.js';

describe('ForgeMindEngine.evaluate', () => {
  it('auto 模式：同时评估三模式并汇总建议动作', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.evaluate({
      scope_guard: { current_vision: '登录功能', new_idea: '新增子系统', current_ac: [], feature_id: 'f1' },
      process_evolution: { error_history: [{ e: 'x' }, { e: 'x' }] },
      knowledge_evolution: { reusability: true, non_obviousness: true, decay_risk: false },
    });

    expect(result.meta.mode).toBe('auto');
    expect(result.meta.actions_count).toBe(3);
    const modes = result.suggested_actions.map((a) => a.mode);
    expect(modes).toContain('scope_guard');
    expect(modes).toContain('process_evolution');
    expect(modes).toContain('knowledge_evolution');
    expect(result.meta.metacognition_route).toBeNull();
  });

  it('scope_guard：1 个强信号即触发 remind；无触发返回空', async () => {
    const engine = new ForgeMindEngine();
    const triggered = await engine.evaluate({
      mode: 'scope_guard',
      scope_guard: { current_vision: 'v1', new_idea: '接入第三方新 API', current_ac: ['AC: x'] },
    });
    expect(triggered.suggested_actions).toHaveLength(1);
    expect(triggered.suggested_actions[0]?.action).toBe('remind');

    const none = await engine.evaluate({
      mode: 'scope_guard',
      scope_guard: { current_vision: '登录功能', new_idea: '增强登录体验', current_ac: ['AC: 登录可用'] },
    });
    expect(none.suggested_actions).toHaveLength(0);
  });

  it('scope_guard：≥3 次发散后追加 suggest_split_feat', async () => {
    const engine = new ForgeMindEngine();
    // 预置 3 条日志制造发散模式
    for (let i = 0; i < 3; i += 1) {
      engine.scopeGuard.logTrigger({
        featureId: 'f-div',
        signalType: 'new_journey',
        action: 'remind',
        outcome: `${i}`,
        agent: 'scope_guard',
      });
    }
    const result = await engine.evaluate({
      mode: 'scope_guard',
      scope_guard: { current_vision: 'v1', new_idea: '新增子系统', current_ac: [], feature_id: 'f-div' },
    });
    const actions = result.suggested_actions.map((a) => a.action);
    expect(actions).toContain('remind');
    expect(actions).toContain('suggest_split_feat');
  });

  it('process_evolution：repeated_error 触发 create_proposal 建议', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.evaluate({
      mode: 'process_evolution',
      process_evolution: { error_history: [{ e: 'x' }, { e: 'x' }] },
    });
    expect(result.suggested_actions[0]).toEqual({
      mode: 'process_evolution',
      action: 'create_proposal',
      payload: { trigger_type: 'repeated_error' },
    });
  });

  it('knowledge_evolution：三问 ≥2 触发 create_episode_card', async () => {
    const engine = new ForgeMindEngine();
    const yes = await engine.evaluate({
      mode: 'knowledge_evolution',
      knowledge_evolution: {
        reusability: true,
        non_obviousness: true,
        episode_data: { task_snapshot: '高价值协作', transferable_method: '方法', non_transferable_facts: '事实', safety_boundary: '边界' },
      },
    });
    expect(yes.suggested_actions[0]?.action).toBe('create_episode_card');

    const no = await engine.evaluate({
      mode: 'knowledge_evolution',
      knowledge_evolution: { reusability: false, non_obviousness: false, decay_risk: true },
    });
    expect(no.suggested_actions).toHaveLength(0);
  });

  it('metacognition 上下文存在时附加路由结果（auto 模式）', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.evaluate({
      metacognition: { successes: 10, trials: 10, evidence_completeness: 0.9, self_reported: 0.9, is_high_risk: false },
    });
    expect(result.meta.metacognition_route).not.toBeNull();
    expect(result.meta.metacognition_route?.route).toBe('proceed');
  });

  it('高风险域 metacognition 用 Wilson 下界 → 保守路由', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.evaluate({
      metacognition: { successes: 1, trials: 1, evidence_completeness: 0.5, self_reported: 1.0, is_high_risk: true },
    });
    // Wilson 下界 < 0.85 阈值 → escalate
    expect(result.meta.metacognition_route?.route).toBe('escalate');
  });
});

describe('ForgeMindEngine.execute', () => {
  it('unknown mode 返回 error', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.execute({ mode: 'bogus', action: 'x' });
    expect(result.status).toBe('error');
    expect(result.reason).toContain('unknown mode');
  });

  it('scope_guard remind 执行：首次 ok，超限 skipped', async () => {
    const engine = new ForgeMindEngine();
    const first = await engine.execute({
      mode: 'scope_guard',
      action: 'remind',
      payload: { feature_id: 'f1', signals: ['new_journey'], vision: 'v', new_direction: 'n' },
    });
    expect(first.status).toBe('ok');
    expect(String(first.reminder)).toContain('【温柔提醒】');

    const second = await engine.execute({
      mode: 'scope_guard',
      action: 'remind',
      payload: { feature_id: 'f1', signals: ['new_journey'], vision: 'v', new_direction: 'n' },
    });
    expect(second.status).toBe('ok');

    const third = await engine.execute({
      mode: 'scope_guard',
      action: 'remind',
      payload: { feature_id: 'f1', signals: ['new_journey'], vision: 'v', new_direction: 'n' },
    });
    expect(third.status).toBe('skipped');
  });

  it('scope_guard suggest_split_feat 返回拆分建议', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.execute({
      mode: 'scope_guard',
      action: 'suggest_split_feat',
      payload: { feature_id: 'f1' },
    });
    expect(result.status).toBe('ok');
    expect(String(result.suggestion)).toContain('建议拆分');
  });

  it('process_evolution create_proposal：完整数据 ok，证据不足 validation_failed', async () => {
    const engine = new ForgeMindEngine();
    const ok = await engine.execute({
      mode: 'process_evolution',
      action: 'create_proposal',
      payload: {
        trigger_type: 'repeated_error',
        trigger: 't',
        evidence: ['a', 'b'],
        root_cause: 'r',
        lever: 'memory',
        verify: 'v',
      },
    });
    expect(ok.status).toBe('ok');
    expect(ok.proposal_id).toContain('pe-');

    const bad = await engine.execute({
      mode: 'process_evolution',
      action: 'create_proposal',
      payload: {
        trigger_type: 'repeated_error',
        trigger: 't',
        evidence: ['a'],
        root_cause: 'r',
        lever: 'memory',
        verify: 'v',
      },
    });
    expect(bad.status).toBe('validation_failed');
    expect(Array.isArray(bad.validation_errors)).toBe(true);
  });

  it('process_evolution accept_proposal：无 commit_ref 或非 proposed 报错', async () => {
    const engine = new ForgeMindEngine();
    const created = await engine.execute({
      mode: 'process_evolution',
      action: 'create_proposal',
      payload: { trigger_type: 'sop_gap', trigger: 't', evidence: ['a', 'b'], root_cause: 'r', lever: 'sop', verify: 'v' },
    });
    const proposalId = String(created.proposal_id);

    const accepted = await engine.execute({
      mode: 'process_evolution',
      action: 'accept_proposal',
      payload: { proposal_id: proposalId, commit_ref: 'abc123' },
    });
    expect(accepted.status).toBe('ok');

    // 已 accepted 再接受失败
    const again = await engine.execute({
      mode: 'process_evolution',
      action: 'accept_proposal',
      payload: { proposal_id: proposalId, commit_ref: 'def456' },
    });
    expect(again.status).toBe('error');
  });

  it('knowledge_evolution create_episode_card 返回 episode_id', async () => {
    const engine = new ForgeMindEngine();
    const result = await engine.execute({
      mode: 'knowledge_evolution',
      action: 'create_episode_card',
      payload: {
        task_snapshot: '协作复盘',
        transferable_method: '方法',
        non_transferable_facts: '事实',
        safety_boundary: '边界',
      },
    });
    expect(result.status).toBe('ok');
    expect(String(result.episode_id)).toContain('ep-');
  });

  it('knowledge_evolution distill_episode：method_card 方向返回 method_id', async () => {
    const engine = new ForgeMindEngine();
    const created = await engine.execute({
      mode: 'knowledge_evolution',
      action: 'create_episode_card',
      payload: {
        task_snapshot: 's',
        transferable_method: '可复用方法',
        non_transferable_facts: 'f',
        safety_boundary: 'b',
        distillation_direction: 'method_card',
      },
    });
    const distilled = await engine.execute({
      mode: 'knowledge_evolution',
      action: 'distill_episode',
      payload: { episode_id: String(created.episode_id) },
    });
    expect(distilled.status).toBe('ok');
    expect(String(distilled.method_id)).toContain('mc-');
  });
});

describe('ForgeMindEngine SelfDev 闭环注册表（F046 执行层）', () => {
  function fakeLoop(loopType: string, stage = 'E3'): SelfDevLoopBase {
    return {
      loopType,
      minAwakeningStage: stage,
      runOnce: async () => ({ loopType, records: [], summary: { total: 0, passed: 0, failed: 0, reflectTotal: 0 } }),
    } as unknown as SelfDevLoopBase;
  }

  it('register/list/run 三闭环注册表', async () => {
    const engine = new ForgeMindEngine();
    engine.registerSelfDevLoop(fakeLoop('doc', 'E3'));
    engine.registerSelfDevLoop(fakeLoop('code', 'E4'));
    engine.registerSelfDevLoop(fakeLoop('framework', 'E5'));

    expect(engine.listSelfDevLoops()).toEqual({ doc: 'E3', code: 'E4', framework: 'E5' });
    expect(engine.getSelfDevLoop('doc')).not.toBeNull();
    expect(engine.getSelfDevLoop('nope')).toBeNull();

    const result = await engine.runSelfDevLoop('doc', { task_source: 'test' });
    expect(result).toHaveProperty('summary');
  });

  it('空 loopType 或重复注册抛错；未注册 loop_type 运行抛错', async () => {
    const engine = new ForgeMindEngine();
    expect(() => engine.registerSelfDevLoop(fakeLoop(''))).toThrow(/loopType/);
    engine.registerSelfDevLoop(fakeLoop('doc'));
    expect(() => engine.registerSelfDevLoop(fakeLoop('doc'))).toThrow(/已注册/);
    await expect(engine.runSelfDevLoop('test', {})).rejects.toThrow(/未注册/);
  });
});

describe('ForgeMindEngine 成熟度辅助', () => {
  it('checkMaturityPromotion / checkMaturityDemotion 委托 ladder', async () => {
    const engine = new ForgeMindEngine();
    // L0 无足够数据不晋升
    expect(engine.checkMaturityPromotion('k1', 'L0', {})).toBeNull();
    // L0 → L1：≥2 相似 episode（180 天内）+ 5Q ≥ 7/10
    const promoted = engine.checkMaturityPromotion('k1', 'L0', {
      episodesCount: 2,
      episodeWindowDays: 90,
      fiveQScore: 8,
    });
    expect(promoted).toBe('L1');
    // 高性能不降级
    expect(engine.checkMaturityDemotion('k1', 'L3', [true, true])).toBeNull();
  });
});
