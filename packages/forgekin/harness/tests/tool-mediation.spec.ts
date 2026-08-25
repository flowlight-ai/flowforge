/**
 * tool-mediation — Layer2 改变现实测试（对齐 Python test_tool_mediation.py）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_ALIASES,
  DEFAULT_TOOL_WHITELIST,
  MediationOutcome,
  SafetyLevel,
  ToolMediator,
  type ToolDescriptor,
} from '../src/tool-mediation.js';

const WHITELIST: readonly ToolDescriptor[] = [
  { tool_name: 'file_read', safety_level: SafetyLevel.READONLY },
  { tool_name: 'shell_exec', safety_level: SafetyLevel.DANGEROUS, side_effects: ['filesystem'], reversible: false },
  { tool_name: 'git_commit', safety_level: SafetyLevel.NORMAL, reversible: false },
];

describe('ToolMediator 白名单校验', () => {
  it('白名单 readonly 工具直接放行', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const result = await mediator.mediate('file_read', { path: '/tmp/x' });
    expect(result.outcome).toBe(MediationOutcome.ALLOWED);
    expect(result.canonical_tool).toBe('file_read');
    expect(result.descriptor?.safety_level).toBe(SafetyLevel.READONLY);
  });

  it('不在白名单 → rejected_not_authorized', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const result = await mediator.mediate('unknown_tool');
    expect(result.outcome).toBe(MediationOutcome.REJECTED_NOT_AUTHORIZED);
    expect(result.canonical_tool).toBeUndefined();
    expect(result.reason).toContain('not in whitelist');
  });

  it('危险工具未确认 → rejected_dangerous；确认后放行', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const rejected = await mediator.mediate('shell_exec', { cmd: 'rm -rf /' });
    expect(rejected.outcome).toBe(MediationOutcome.REJECTED_DANGEROUS);

    const allowed = await mediator.mediate('shell_exec', { cmd: 'ls' }, true);
    expect(allowed.outcome).toBe(MediationOutcome.ALLOWED);
  });

  it('不可逆操作未授权 → rejected_not_reversible', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const result = await mediator.mediate('git_commit');
    expect(result.outcome).toBe(MediationOutcome.REJECTED_NOT_REVERSIBLE);
  });
});

describe('ToolMediator 别名兜底（Build to Delete）', () => {
  it('别名命中 → alias_fallback', async () => {
    const mediator = new ToolMediator({
      whitelist: WHITELIST,
      aliases: { read: 'file_read' },
    });
    const result = await mediator.mediate('read', { path: '/tmp/x' });
    expect(result.outcome).toBe(MediationOutcome.ALIAS_FALLBACK);
    expect(result.canonical_tool).toBe('file_read');
    expect(result.reason).toContain('Build-to-Delete');
  });

  it('别名指向危险工具仍需确认', async () => {
    const mediator = new ToolMediator({
      whitelist: WHITELIST,
      aliases: { exec: 'shell_exec' },
    });
    const result = await mediator.mediate('exec', { cmd: 'ls' });
    expect(result.outcome).toBe(MediationOutcome.REJECTED_DANGEROUS);
  });
});

describe('ToolMediator 审计 trail 与脱敏', () => {
  it('getAuditTrail 按工具过滤', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST, aliases: { read: 'file_read' } });
    await mediator.mediate('file_read');
    await mediator.mediate('read');
    await mediator.mediate('unknown_tool');
    expect(mediator.getAuditTrail().length).toBe(3);
    expect(mediator.getAuditTrail('file_read').length).toBe(2); // 含别名解析后
  });

  it('超长参数值被截断', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const long = 'x'.repeat(500);
    const result = await mediator.mediate('file_read', { path: long });
    const arg = result.args['path'] as string;
    expect(arg.length).toBeLessThan(300);
    expect(arg.endsWith('...(truncated)')).toBe(true);
  });

  it('mediation_id 前缀 med-', async () => {
    const mediator = new ToolMediator({ whitelist: WHITELIST });
    const result = await mediator.mediate('file_read');
    expect(result.mediation_id).toMatch(/^med-[0-9a-f]{12}$/);
    expect(result.timestamp).toBeTruthy();
  });
});

describe('内置白名单与别名（harness.yaml）', () => {
  it('默认 5 工具 + 5 别名', () => {
    expect(DEFAULT_TOOL_WHITELIST).toHaveLength(5);
    expect(Object.keys(DEFAULT_TOOL_ALIASES)).toHaveLength(5);
    const mediator = new ToolMediator({
      whitelist: DEFAULT_TOOL_WHITELIST,
      aliases: DEFAULT_TOOL_ALIASES,
    });
    expect(mediator.whitelist.size).toBe(5);
    expect(mediator.aliases.size).toBe(5);
  });

  it('shell_exec 在默认白名单中为 dangerous', async () => {
    const mediator = new ToolMediator({
      whitelist: DEFAULT_TOOL_WHITELIST,
      aliases: DEFAULT_TOOL_ALIASES,
    });
    const result = await mediator.mediate('exec', { cmd: 'whoami' });
    expect(result.outcome).toBe(MediationOutcome.REJECTED_DANGEROUS);
  });
});
