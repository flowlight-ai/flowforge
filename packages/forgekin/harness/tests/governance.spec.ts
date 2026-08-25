/**
 * governance — Layer4 约束现实测试（对齐 Python test_governance.py + roleagent.md §3.3）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOVERNANCE_RULES,
  GovernanceInjector,
  InjectionPoint,
  type GovernanceRule,
} from '../src/governance.js';

function rule(
  ruleId: string,
  content: string,
  priority: number,
  injectionPoint: InjectionPoint = InjectionPoint.SYSTEM_ROLE,
): GovernanceRule {
  return {
    rule_id: ruleId,
    content,
    priority,
    injection_point: injectionPoint,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  };
}

describe('GovernanceInjector 注入', () => {
  it('SYSTEM_ROLE 注入（压缩免疫主路径）', async () => {
    const injector = new GovernanceInjector();
    injector.registerRule(rule('GOV-001', '禁止绕过 ToolMediator', 95));
    const text = await injector.injectToSystemRole(undefined, 'GOV-001');
    expect(text).toContain('[GOVERNANCE RULE #GOV-001]');
    expect(text).toContain('(priority=95)');
    expect(text).toContain('禁止绕过 ToolMediator');
  });

  it('普通规则 USER_MESSAGE 注入走 [提示] 模板', async () => {
    const injector = new GovernanceInjector();
    injector.registerRule(rule('GOV-010', '临时提示', 50, InjectionPoint.USER_MESSAGE));
    const text = await injector.injectToUserMessage(undefined, 'GOV-010');
    expect(text).toBe('[提示] 临时提示');
  });

  it('critical 规则请求 USER_MESSAGE 被强制改为 SYSTEM_ROLE（压缩免疫）', async () => {
    const injector = new GovernanceInjector({ criticalPriorityThreshold: 90 });
    injector.registerRule(rule('GOV-001', '关键规则', 95, InjectionPoint.USER_MESSAGE));
    const text = await injector.injectToUserMessage(undefined, 'GOV-001');
    expect(text).toContain('[GOVERNANCE RULE #GOV-001]'); // 系统角色模板
    expect(text).not.toContain('[提示]');
  });

  it('priority >= 阈值 即 critical（边界 90）', async () => {
    const injector = new GovernanceInjector({ criticalPriorityThreshold: 90 });
    injector.registerRule(rule('GOV-090', '边界规则', 90, InjectionPoint.USER_MESSAGE));
    const text = await injector.injectToUserMessage(undefined, 'GOV-090');
    expect(text).toContain('[GOVERNANCE RULE #GOV-090]');
  });

  it('参数缺失或未注册 → 抛错', async () => {
    const injector = new GovernanceInjector();
    await expect(injector.injectToSystemRole()).rejects.toThrow('either');
    await expect(injector.injectToSystemRole(undefined, 'NOPE')).rejects.toThrow(
      "governance rule 'NOPE' not registered",
    );
  });
});

describe('GovernanceInjector 批量注入', () => {
  it('批量注入按优先级降序拼接；禁用规则跳过', async () => {
    const injector = new GovernanceInjector();
    injector.registerRule(rule('GOV-A', 'A', 30));
    injector.registerRule(rule('GOV-B', 'B', 90));
    injector.registerRule({ ...rule('GOV-C', 'C', 60), enabled: false });
    const text = await injector.injectToSystemRoleBatch();
    expect(text.indexOf('GOV-B')).toBeLessThan(text.indexOf('GOV-A'));
    expect(text).not.toContain('GOV-C');
  });

  it('指定 rule_ids 只注入指定规则', async () => {
    const injector = new GovernanceInjector();
    injector.registerRule(rule('GOV-A', 'A', 30));
    injector.registerRule(rule('GOV-B', 'B', 90));
    const text = await injector.injectToSystemRoleBatch(['GOV-A']);
    expect(text).toContain('GOV-A');
    expect(text).not.toContain('GOV-B');
  });
});

describe('默认治理规则集', () => {
  it('内置 5 规则全为 SYSTEM_ROLE 且全部启用', () => {
    expect(DEFAULT_GOVERNANCE_RULES).toHaveLength(5);
    for (const r of DEFAULT_GOVERNANCE_RULES) {
      expect(r.injection_point).toBe(InjectionPoint.SYSTEM_ROLE);
      expect(r.enabled).toBe(true);
      expect(r.priority).toBeGreaterThanOrEqual(0);
      expect(r.priority).toBeLessThanOrEqual(100);
    }
  });

  it('默认规则注入完整 SYSTEM_ROLE 文本', async () => {
    const injector = new GovernanceInjector();
    for (const r of DEFAULT_GOVERNANCE_RULES) {
      injector.registerRule(r);
    }
    const text = await injector.injectToSystemRoleBatch();
    expect(text).toContain('GOV-001');
    expect(text).toContain('GOV-005');
    // 优先级降序：GOV-001 (95) 在 GOV-005 (75) 前
    expect(text.indexOf('GOV-001')).toBeLessThan(text.indexOf('GOV-005'));
  });
});
