/**
 * guardrails — 六层 Guardrails 测试（EX-005 / EX-006）。
 *
 * 语义对照 flowforge/core/external_agent/guardrails/ 各测试：
 *   - L1 input-validation：危险模式 / 路径穿越 / 长度 / 上下文
 *   - L2 system-prompt：{{key}} 渲染 + prefix/suffix 注入
 *   - L3 tool-allowlist：forbidden → per_provider ∪ default → 权限交集
 *   - L4 output-validation：敏感模式脱敏 / 长度
 *   - L5 action-confirm：不可逆操作确认（无回调默认拒绝）
 *   - L6 cost-ceiling：三维配额 check / recordUsage / report / reset
 *
 * @module @flowforge/external-agent/tests
 */

import { describe, expect, it } from 'vitest';
import { ActionConfirmGuardrail } from '../src/guardrails/action-confirm.js';
import {
  type CostStore,
  CostCeilingGuardrail,
} from '../src/guardrails/cost-ceiling.js';
import {
  type InputValidationConfig,
  InputValidationGuardrail,
} from '../src/guardrails/input-validation.js';
import { OutputValidationGuardrail } from '../src/guardrails/output-validation.js';
import { SystemPromptGuardrail } from '../src/guardrails/system-prompt.js';
import {
  type ToolAllowlistConfig,
  ToolAllowlistGuardrail,
} from '../src/guardrails/tool-allowlist.js';

describe('L1 InputValidationGuardrail（input_validation.py）', () => {
  it('正常任务通过验证（sanitized_input 原样返回）', () => {
    const guardrail = new InputValidationGuardrail();
    const result = guardrail.validate('请实现一个排序函数', {});
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.sanitized_input).toBe('请实现一个排序函数');
  });

  it('危险模式拒绝（rm -rf /）', () => {
    const guardrail = new InputValidationGuardrail();
    const result = guardrail.validate('执行 rm -rf / 清理系统');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('forbidden_pattern'))).toBe(true);
    expect(result.sanitized_input).toBe('');
  });

  it('路径穿越拒绝（../）', () => {
    const guardrail = new InputValidationGuardrail();
    const result = guardrail.validate('读取 ../../etc/passwd 的内容');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('forbidden_path_pattern'))).toBe(true);
  });

  it('任务超长拒绝（自定义 max_task_length）', () => {
    const guardrail = new InputValidationGuardrail({ max_task_length: 10 });
    const result = guardrail.validate('这是一个超过十个字符的超级长任务描述');
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain('task_length=');
  });

  it('上下文中含危险模式拒绝', () => {
    const guardrail = new InputValidationGuardrail();
    const result = guardrail.validate('正常任务', { hint: '试试 sudo 提权' });
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('in context'))).toBe(true);
  });

  it('自定义配置可覆盖（Partial<InputValidationConfig>）', () => {
    const config: Partial<InputValidationConfig> = {
      forbidden_patterns: ['forbidden-word'],
      forbidden_path_patterns: [],
    };
    const guardrail = new InputValidationGuardrail(config);
    expect(guardrail.validate('含 forbidden-word 的任务').valid).toBe(false);
    expect(guardrail.validate('正常任务').valid).toBe(true);
  });
});

describe('L2 SystemPromptGuardrail（system_prompt.py）', () => {
  it('prefix 注入（默认）', () => {
    const guardrail = new SystemPromptGuardrail();
    const injected = guardrail.inject('你是助手');
    expect(injected.startsWith('[FlowForge 边界声明]')).toBe(true);
    expect(injected.endsWith('你是助手')).toBe(true);
  });

  it('suffix 注入', () => {
    const guardrail = new SystemPromptGuardrail({ inject_position: 'suffix' });
    const injected = guardrail.inject('你是助手');
    expect(injected.startsWith('你是助手')).toBe(true);
    expect(injected.endsWith('[FlowForge 边界声明]')).toBe(false);
  });

  it('{{key}} 模板渲染（cost_ceiling）', () => {
    const guardrail = new SystemPromptGuardrail();
    const injected = guardrail.inject('你是助手', { cost_ceiling: '50000' });
    expect(injected).toContain('不超过 50000 token');
    expect(injected).not.toContain('{{cost_ceiling}}');
  });

  it('getBoundaryTemplate / updateBoundaryTemplate', () => {
    const guardrail = new SystemPromptGuardrail();
    expect(guardrail.getBoundaryTemplate()).toContain('FlowForge');
    guardrail.updateBoundaryTemplate('[自定义边界]');
    expect(guardrail.getBoundaryTemplate()).toBe('[自定义边界]');
  });
});

describe('L3 ToolAllowlistGuardrail（tool_allowlist.py）', () => {
  it('default_forbidden 直接拒绝（git_push）', () => {
    const guardrail = new ToolAllowlistGuardrail();
    const result = guardrail.check('a.b', 'git_push');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('default_forbidden');
  });

  it('default_allowed 允许（file_read）', () => {
    const guardrail = new ToolAllowlistGuardrail();
    expect(guardrail.check('a.b', 'file_read').allowed).toBe(true);
  });

  it('白名单之外的工具拒绝', () => {
    const guardrail = new ToolAllowlistGuardrail();
    const result = guardrail.check('a.b', 'deploy_production');
    expect(result.allowed).toBe(false);
  });

  it('per_provider 定制扩展允许列表', () => {
    const guardrail = new ToolAllowlistGuardrail({
      per_provider: { 'a.b': ['deploy_production'] },
    });
    expect(guardrail.check('a.b', 'deploy_production').allowed).toBe(true);
    expect(guardrail.check('c.d', 'deploy_production').allowed).toBe(false);
  });

  it('declared_permissions 取交集（最小权限原则）', () => {
    const guardrail = new ToolAllowlistGuardrail();
    // file_read 在 default_allowed，但声明权限没有 → 拒绝
    const result = guardrail.check('a.b', 'file_read', ['file_write']);
    expect(result.allowed).toBe(false);
    // 声明权限包含 → 允许
    expect(guardrail.check('a.b', 'file_read', ['file_read']).allowed).toBe(true);
  });

  it('自定义 config 生效（ToolAllowlistConfig）', () => {
    const config: ToolAllowlistConfig = {
      default_allowed: ['x'],
      default_forbidden: ['y'],
      per_provider: {},
    };
    const guardrail = new ToolAllowlistGuardrail(config);
    expect(guardrail.check('a.b', 'x').allowed).toBe(true);
    expect(guardrail.check('a.b', 'y').allowed).toBe(false);
  });
});

describe('L4 OutputValidationGuardrail（output_validation.py）', () => {
  it('正常输出通过（原样返回）', () => {
    const guardrail = new OutputValidationGuardrail();
    const result = guardrail.validate('完成，代码在 src/main.ts');
    expect(result.valid).toBe(true);
    expect(result.sanitized_output).toBe('完成，代码在 src/main.ts');
  });

  it('敏感信息脱敏（sk- 开头的 API key）', () => {
    const guardrail = new OutputValidationGuardrail();
    const result = guardrail.validate('key 是 sk-abcdef12345678901234567890，请勿泄露');
    expect(result.valid).toBe(false);
    expect(result.sanitized_output).toContain('[REDACTED]');
    expect(result.sanitized_output).not.toContain('sk-abcdef12345678901234567890');
  });

  it('password 赋值模式脱敏', () => {
    const guardrail = new OutputValidationGuardrail();
    const result = guardrail.validate('数据库 password: hunter2');
    expect(result.valid).toBe(false);
    expect(String(result.sanitized_output)).toContain('[REDACTED]');
  });

  it('超长输出拒绝（自定义 max_output_length）', () => {
    const guardrail = new OutputValidationGuardrail({ max_output_length: 20 });
    const result = guardrail.validate('这是一段远远超过二十个字符长度的输出内容，用于测试长度限制');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('output_length'))).toBe(true);
  });
});

describe('L5 ActionConfirmGuardrail（action_confirm.py）', () => {
  it('不可逆操作需要确认（git push）', () => {
    const guardrail = new ActionConfirmGuardrail();
    const result = guardrail.check('git push origin main');
    expect(result.action_required).toBe(true);
    expect(result.auto_approved).toBe(false);
  });

  it('普通操作自动批准', () => {
    const guardrail = new ActionConfirmGuardrail();
    const result = guardrail.check('git status');
    expect(result.action_required).toBe(false);
    expect(result.auto_approved).toBe(true);
  });

  it('confirm 无回调默认拒绝（安全默认）', async () => {
    const guardrail = new ActionConfirmGuardrail();
    await expect(guardrail.confirm('git push origin main')).resolves.toBe(false);
  });

  it('confirm 自动批准操作直接通过（不调用回调）', async () => {
    let called = false;
    const guardrail = new ActionConfirmGuardrail(
      {},
      async () => {
        called = true;
        return false;
      },
    );
    await expect(guardrail.confirm('git status')).resolves.toBe(true);
    expect(called).toBe(false);
  });

  it('confirm 回调决定结果', async () => {
    const guardrail = new ActionConfirmGuardrail({}, async () => true);
    await expect(guardrail.confirm('git push origin main')).resolves.toBe(true);
  });
});

describe('L6 CostCeilingGuardrail（cost_ceiling.py，EX-006）', () => {
  class MemCostStore implements CostStore {
    data = new Map<string, Record<string, unknown>>();

    async getUsage(forgekinId: string): Promise<Record<string, unknown>> {
      return { ...(this.data.get(forgekinId) ?? { tokens: 0, calls: 0, cost: 0 }) };
    }

    async addUsage(
      forgekinId: string,
      tokens: number,
      calls: number,
      cost: number,
    ): Promise<void> {
      const current = await this.getUsage(forgekinId);
      this.data.set(forgekinId, {
        tokens: Number(current['tokens'] ?? 0) + tokens,
        calls: Number(current['calls'] ?? 0) + calls,
        cost: Number(current['cost'] ?? 0) + cost,
      });
    }

    async resetUsage(forgekinId: string): Promise<void> {
      this.data.delete(forgekinId);
    }
  }

  it('未超配额允许调用', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore());
    const result = await guardrail.check('fk-1', 100, 0.001);
    expect(result.allowed).toBe(true);
  });

  it('预估超 token 配额拒绝（默认 1M）', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore());
    const result = await guardrail.check('fk-1', 1_000_000);
    expect(result.allowed).toBe(false);
  });

  it('累计使用后超配额（recordUsage → check 拒绝）', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore(), {
      default_token_quota: 1000,
    });
    await guardrail.recordUsage('fk-1', 950, 1, 0.01);
    expect((await guardrail.check('fk-1', 100)).allowed).toBe(false); // 950+100 > 1000
    expect((await guardrail.check('fk-1', 10)).allowed).toBe(true); // 960 < 1000
  });

  it('per_forgekin_quota 定制配额', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore(), {
      per_forgekin_quota: { 'fk-1': { token_quota: 100 } },
    });
    expect((await guardrail.check('fk-1', 50)).allowed).toBe(true);
    expect((await guardrail.check('fk-1', 100)).allowed).toBe(false);
  });

  it('getUsageReport 汇总 usage + quota', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore(), {
      per_forgekin_quota: { 'fk-1': { token_quota: 5000 } },
    });
    await guardrail.recordUsage('fk-1', 100, 2, 0.5);
    const report = await guardrail.getUsageReport('fk-1');
    expect(report['forgekin_id']).toBe('fk-1');
    expect(report['usage']).toMatchObject({ tokens: 100, calls: 2, cost: 0.5 });
    expect(report['quota']).toMatchObject({ token_quota: 5000 });
  });

  it('resetQuota 清零使用量', async () => {
    const guardrail = new CostCeilingGuardrail(new MemCostStore(), {
      default_token_quota: 1000,
    });
    await guardrail.recordUsage('fk-1', 999, 1, 0.01);
    expect((await guardrail.check('fk-1', 100)).allowed).toBe(false);
    await guardrail.resetQuota('fk-1');
    expect((await guardrail.check('fk-1', 100)).allowed).toBe(true);
  });
});
