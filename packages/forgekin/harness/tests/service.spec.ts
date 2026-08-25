/**
 * service — HarnessService 挂载测试（ctx.forgeHarness 七层聚合）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Plugin from '../src/service.js';
import { HarnessLayer } from '../src/types.js';
import {
  DEFAULT_GOVERNANCE_RULES,
  InjectionPoint,
} from '../src/governance.js';
import { HarnessabilityDimension } from '../src/harnessability.js';
import { EvidenceSource } from '../src/evidence-sensors.js';

describe('HarnessService 插件挂载', () => {
  it('plugin(ctx) 后 ctx.forgeHarness 同步可用', () => {
    const ctx = new Context();
    Plugin(ctx);
    expect(ctx.forgeHarness).toBeDefined();
    expect(ctx.forgeHarness.durableState).toBeDefined();
    expect(ctx.forgeHarness.toolMediator).toBeDefined();
    expect(ctx.forgeHarness.evidenceCollector).toBeDefined();
    expect(ctx.forgeHarness.governance).toBeDefined();
    expect(ctx.forgeHarness.entropyManager).toBeDefined();
    expect(ctx.forgeHarness.harnessability).toBeDefined();
  });

  it('默认后端为 sqlite + 内置白名单/别名/规则', () => {
    const ctx = new Context();
    Plugin(ctx);
    expect(ctx.forgeHarness.durableStateBackend).toBe('sqlite');
    expect(ctx.forgeHarness.toolMediator.whitelist.size).toBe(5);
    expect(ctx.forgeHarness.toolMediator.aliases.size).toBe(5);
    expect(ctx.forgeHarness.governance.rules.size).toBe(DEFAULT_GOVERNANCE_RULES.length);
  });

  it('配置覆盖：git 后端 + 附加规则', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-harness-svc-'));
    const ctx = new Context();
    Plugin(ctx, {
      durableStateBackend: 'git',
      durableStateRepoPath: join(dir, 'repo'),
      extraGovernanceRules: [
        {
          rule_id: 'GOV-CUSTOM',
          content: 'custom rule',
          priority: 50,
          injection_point: InjectionPoint.SYSTEM_ROLE,
          created_at: '2025-01-01T00:00:00.000Z',
          enabled: true,
        },
      ],
    });
    expect(ctx.forgeHarness.durableStateBackend).toBe('git');
    expect(ctx.forgeHarness.governance.rules.size).toBe(DEFAULT_GOVERNANCE_RULES.length + 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('七层快捷方法', () => {
  it('Layer1 状态读写', async () => {
    const ctx = new Context();
    Plugin(ctx);
    await ctx.forgeHarness.stateWrite('svc:key', { ok: true }, 'operator');
    expect(await ctx.forgeHarness.stateRead('svc:key')).toEqual({ ok: true });
    expect(await ctx.forgeHarness.stateDelete('svc:key')).toBe(true);
  });

  it('Layer2 工具中介：未授权拒绝', async () => {
    const ctx = new Context();
    Plugin(ctx);
    const result = await ctx.forgeHarness.mediateTool('unknown_tool');
    expect(result.outcome.valueOf()).toBe('rejected_not_authorized');
  });

  it('Layer3 证据采集：哈希校验通过', async () => {
    const ctx = new Context();
    Plugin(ctx);
    const evidence = await ctx.forgeHarness.collectEvidence(
      EvidenceSource.COMMIT,
      'abc123',
    );
    expect(evidence.verified).toBe(true);
  });

  it('Layer4 治理规则注入（压缩免疫）', async () => {
    const ctx = new Context();
    Plugin(ctx);
    const text = await ctx.forgeHarness.injectGovernanceRules();
    expect(text).toContain('[GOVERNANCE RULE #GOV-001]');
    expect(text).toContain('GOV-005');
  });

  it('Layer6 熵检查：preCheck + postTrack + check', async () => {
    const ctx = new Context();
    Plugin(ctx);
    const taskCtx = { task_id: 't-1', metadata: {}, state: {} };
    await ctx.forgeHarness.entropyPreCheck(taskCtx);
    await ctx.forgeHarness.entropyPostTrack({ error: 'fail' }, taskCtx);
    const report = (await ctx.forgeHarness.entropyCheck(taskCtx)) as Record<string, unknown>;
    expect(report['debt_summary']).toBeDefined();
    expect(ctx.forgeHarness.entropyManager.debtTracker?.items.size).toBe(1);
  });

  it('Layer7 harnessability 评估', () => {
    const ctx = new Context();
    Plugin(ctx);
    const report = ctx.forgeHarness.assessHarnessability([
      { dimension: HarnessabilityDimension.DURABLE_STATE_COVERAGE, score: 0.9, rationale: 'ok' },
      { dimension: HarnessabilityDimension.TOOL_MEDIATION_QUALITY, score: 0.9, rationale: 'ok' },
      { dimension: HarnessabilityDimension.GOVERNANCE_COMPLETENESS, score: 0.9, rationale: 'ok' },
      { dimension: HarnessabilityDimension.OBSERVABILITY, score: 0.9, rationale: 'ok' },
      { dimension: HarnessabilityDimension.RECOVERY_CAPABILITY, score: 0.9, rationale: 'ok' },
      { dimension: HarnessabilityDimension.EVIDENCE, score: 0.9, rationale: 'ok' },
    ]);
    expect(report.overall).toBe(0.9);
    expect(report.below_threshold).toBe(false);
  });
});

describe('Harness 七层枚举', () => {
  it('七层齐全（含已交付的 magic_words）', () => {
    expect(Object.values(HarnessLayer)).toHaveLength(7);
    expect(HarnessLayer.DURABLE_STATE).toBe('durable_state');
    expect(HarnessLayer.MAGIC_WORDS).toBe('magic_words');
    expect(HarnessLayer.HARNESSABILITY).toBe('harnessability');
  });
});

describe('snapshot 摘要', () => {
  it('返回各层状态摘要', async () => {
    const ctx = new Context();
    Plugin(ctx);
    await ctx.forgeHarness.mediateTool('file_read');
    const snap = ctx.forgeHarness.snapshot();
    expect(snap.durableStateBackend).toBe('sqlite');
    expect(snap.whitelistedTools).toBe(5);
    expect(snap.auditTrailSize).toBe(1);
    expect(snap.evidenceCount).toBe(0);
    expect(snap.governanceRules).toBe(5);
  });
});
