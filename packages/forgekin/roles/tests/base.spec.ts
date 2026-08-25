/**
 * @flowforge/forgekin-roles — T7.28 ForgekinRole 基类契约验证。
 *
 * 对齐 `forgemind/base.py` ForgekinBase：
 *   - 构造校验（forgekinId / name 非空）
 *   - 缺省形态/阶（ORG / E1 / E1）
 *   - 生命周期状态机（created → observing/acting/verifying）
 *   - 能力判定（canSelfEvolve 觉醒阶≥E4 / canForgeNewForgekin 进化阶=E6）
 *   - makeResult 决策记录语义（applied / pending_operator_review / rejected）
 *   - describe() 描述字典
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import {
  ForgekinRole,
} from '../src/base.js';
import {
  AwakeningStage,
  EvolutionStage,
  ForgekinSpecies,
  type RoleActionResult,
} from '../src/types.js';

/** 测试用最小角色：实现三方法契约，暴露受保护辅助。 */
class TestRole extends ForgekinRole {
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.markLifecycle('observing');
    return { echo: environment };
  }

  override async act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult> {
    this.markLifecycle('acting');
    const actionType = String(action.action_type ?? 'x');
    const params = (action.params ?? {}) as Readonly<Record<string, unknown>>;
    if (this.requiresApproval(actionType, params)) {
      return this.makeResult('product-manager', actionType, params, false, {});
    }
    return this.makeResult('product-manager', actionType, params, true, { ok: true });
  }

  override async verify(result: RoleActionResult): Promise<boolean> {
    this.markLifecycle('verifying');
    return result.executed;
  }

  /** 暴露 makeResult 覆写 decisionRecord 路径。 */
  reject(actionType: string): RoleActionResult {
    return this.makeResult('product-manager', actionType, {}, false, {}, {}, 'rejected');
  }

  /** 暴露 requiresApproval。 */
  needApproval(actionType: string, params: Readonly<Record<string, unknown>>): boolean {
    return this.requiresApproval(actionType, params);
  }
}

describe('ForgekinRole 基类契约（base.py）', () => {
  it('构造校验：forgekinId / name 为空抛 RangeError', () => {
    expect(() => new TestRole({ forgekinId: '', name: 'x' })).toThrow(RangeError);
    expect(() => new TestRole({ forgekinId: '  ', name: 'x' })).toThrow(RangeError);
    expect(() => new TestRole({ forgekinId: 'a', name: '' })).toThrow(RangeError);
  });

  it('缺省形态 ORG / 进化阶 E1 / 觉醒阶 E1（对齐 ForgekinBase 默认参数）', () => {
    const role = new TestRole({ forgekinId: 'forgemind:t', name: '测试' });
    expect(role.species).toBe(ForgekinSpecies.ORG);
    expect(role.evolutionStage).toBe(EvolutionStage.E1);
    expect(role.awakeningStage).toBe(AwakeningStage.E1);
    expect(role.orgCharter).toBeNull();
    expect(role.businessSystems).toEqual([]);
  });

  it('生命周期状态机：created → observing → acting → verifying', async () => {
    const role = new TestRole({ forgekinId: 'forgemind:t', name: '测试' });
    expect(role.lifecycleState).toBe('created');
    await role.observe({});
    expect(role.lifecycleState).toBe('observing');
    await role.act({ action_type: 'x' });
    expect(role.lifecycleState).toBe('acting');
    await role.verify({ executed: true } as unknown as RoleActionResult);
    expect(role.lifecycleState).toBe('verifying');
  });

  it('canSelfEvolve：觉醒阶 E4+ 为 true（对齐 base.py 觉醒阶 Evolving）', () => {
    const e1 = new TestRole({ forgekinId: 'a', name: 'a', awakeningStage: AwakeningStage.E1 });
    const e3 = new TestRole({ forgekinId: 'b', name: 'b', awakeningStage: AwakeningStage.E3 });
    const e4 = new TestRole({ forgekinId: 'c', name: 'c', awakeningStage: AwakeningStage.E4 });
    expect(e1.canSelfEvolve()).toBe(false);
    expect(e3.canSelfEvolve()).toBe(false);
    expect(e4.canSelfEvolve()).toBe(true);
  });

  it('canForgeNewForgekin：进化阶 E6 ForgeMind 为 true', () => {
    const e5 = new TestRole({ forgekinId: 'a', name: 'a', evolutionStage: EvolutionStage.E5 });
    const e6 = new TestRole({ forgekinId: 'b', name: 'b', evolutionStage: EvolutionStage.E6 });
    expect(e5.canForgeNewForgekin()).toBe(false);
    expect(e6.canForgeNewForgekin()).toBe(true);
  });

  it('makeResult：executed=true → applied；false → pending_operator_review（对齐 org.py 降级语义）', async () => {
    const role = new TestRole({ forgekinId: 'forgemind:t', name: '测试' });
    const applied = await role.act({ action_type: 'x', params: {} });
    expect(applied.decisionRecord).toBe('applied');
    expect(applied.complianceCheck).toEqual({
      charterAligned: true,
      regulatoryCompliant: true,
      valueAnchorsRespected: true,
    });
    const rejected = role.reject('blocking');
    expect(rejected.executed).toBe(false);
    expect(rejected.decisionRecord).toBe('rejected');
  });

  it('requiresApproval 缺省 false（子类按不变量覆写）', () => {
    const role = new TestRole({ forgekinId: 'forgemind:t', name: '测试' });
    expect(role.needApproval('deploy', {})).toBe(false);
  });

  it('describe() 返回谱系字段（forgekin_id / 阶 / 能力判定）', () => {
    const role = new TestRole({
      forgekinId: 'forgemind:t',
      name: '测试',
      species: ForgekinSpecies.BIO,
      evolutionStage: EvolutionStage.E3,
      awakeningStage: AwakeningStage.E4,
    });
    const desc = role.describe();
    expect(desc.forgekin_id).toBe('forgemind:t');
    expect(desc.name).toBe('测试');
    expect(desc.species_chinese).toBe('生物形态');
    expect(desc.evolution_stage_chinese).toBe('成熟');
    expect(desc.awakening_stage_chinese).toBe('进化');
    expect(desc.can_self_evolve).toBe(true);
    expect(desc.can_forge_new_forgekin).toBe(false);
  });

  it('toString 含构造器名 / id / 阶', () => {
    const role = new TestRole({ forgekinId: 'forgemind:t', name: '测试' });
    expect(role.toString()).toContain('TestRole');
    expect(role.toString()).toContain('forgemind:t');
  });

  it('orgCharter / roleMatrix / businessSystems 传入透传（OrgForgekin 虚拟设定层）', () => {
    const role = new TestRole({
      forgekinId: 'forgemind:t',
      name: '测试',
      orgCharter: '用户价值至上',
      roleMatrix: { dev: 3, ops: 2 },
      businessSystems: ['erp', 'crm'],
    });
    expect(role.orgCharter).toBe('用户价值至上');
    expect(role.roleMatrix).toEqual({ dev: 3, ops: 2 });
    expect(role.businessSystems).toEqual(['erp', 'crm']);
  });
});
