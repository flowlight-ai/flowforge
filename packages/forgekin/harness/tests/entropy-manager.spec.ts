/**
 * entropy-manager — Layer6 清理现实测试（对齐 Python test_entropy_manager.py）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DebtSeverity,
  DebtStatus,
  DebtTracker,
  DocGardener,
  EntropyManager,
  GarbageCollection,
  RuleEvolution,
  RuleLifecycle,
  type HarnessTaskContext,
} from '../src/entropy-manager.js';

function taskContext(overrides: Partial<HarnessTaskContext> = {}): HarnessTaskContext {
  return {
    task_id: 'task-1',
    metadata: {},
    state: {},
    ...overrides,
  };
}

describe('DocGardener 文档新鲜度', () => {
  it('源文件晚于文档 → 标记陈旧（带原因）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-docg-'));
    const doc = join(dir, 'doc.md');
    const source = join(dir, 'src.ts');
    writeFileSync(doc, 'doc');
    writeFileSync(source, 'src');

    // 先把 doc 时间戳改旧，source 时间戳改新（模拟源文件后改）
    const future = new Date(Date.now() + 60_000);
    const old = new Date(Date.now() - 40 * 86400_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(source, future, future);
    utimesSync(doc, old, old);

    const gardener = new DocGardener(0.7);
    gardener.registerDoc(doc, new Set([source]));
    const stale = await gardener.checkFreshness({ force: true });
    expect(stale.length).toBe(1);
    expect(stale[0]?.path).toBe(doc);
    expect(stale[0]?.staleness_score).toBeGreaterThanOrEqual(0.7);
    expect(stale[0]?.reason).toContain('sources modified');
    rmSync(dir, { recursive: true, force: true });
  });

  it('文档过老（90 天）→ 年龄陈旧', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-docg-'));
    const doc = join(dir, 'old.md');
    writeFileSync(doc, 'old');
    const { utimesSync } = await import('node:fs');
    const old = new Date(Date.now() - 100 * 86400_000);
    utimesSync(doc, old, old);

    const gardener = new DocGardener(0.7);
    gardener.registerDoc(doc);
    const stale = await gardener.checkFreshness({ force: true });
    expect(stale.length).toBe(1);
    expect(stale[0]?.reason).toContain('doc age');
    rmSync(dir, { recursive: true, force: true });
  });

  it('invalidateCache 全部/单文件失效', async () => {
    const gardener = new DocGardener(0.7, 60);
    gardener.registerDoc('/tmp/nonexistent-doc-1.md');
    expect(gardener.entries.size).toBe(1);
    gardener.invalidateCache();
    gardener.invalidateCache('/tmp/nonexistent-doc-1.md');
    expect(gardener.entries.size).toBe(1);
  });
});

describe('DebtTracker 技术债务', () => {
  it('record 返回 DEBT-0001 递增 ID + open 状态', () => {
    const tracker = new DebtTracker();
    const id1 = tracker.record('First debt', DebtSeverity.HIGH, 'harness_violation');
    const id2 = tracker.record('Second debt');
    expect(id1).toBe('DEBT-0001');
    expect(id2).toBe('DEBT-0002');
    expect(tracker.items.get(id1)?.severity).toBe(DebtSeverity.HIGH);
    expect(tracker.items.get(id1)?.status).toBe(DebtStatus.OPEN);
  });

  it('updateStatus + getOpenItems 过滤已解决项', () => {
    const tracker = new DebtTracker();
    const id = tracker.record('debt');
    expect(tracker.updateStatus(id, DebtStatus.RESOLVED)).toBe(true);
    expect(tracker.updateStatus('NOPE', DebtStatus.RESOLVED)).toBe(false);
    expect(tracker.getOpenItems().length).toBe(0);
  });

  it('getSummary 按严重级别/状态计数', () => {
    const tracker = new DebtTracker();
    tracker.record('a', DebtSeverity.HIGH);
    tracker.record('b', DebtSeverity.HIGH);
    tracker.record('c', DebtSeverity.LOW);
    const summary = tracker.getSummary();
    expect(summary.total_items).toBe(3);
    expect(summary.open_items).toBe(3);
    expect(summary.by_severity[DebtSeverity.HIGH]).toBe(2);
    expect(summary.by_status[DebtStatus.OPEN]).toBe(3);
  });
});

describe('RuleEvolution 规则演化', () => {
  it('propose → activate → mutate（原规则废弃 + 新版本）', () => {
    const evolution = new RuleEvolution();
    const id = evolution.propose('Prevent X', 'Rule from failure');
    expect(evolution.activate(id)).toBe(true);
    const newId = evolution.mutate(id, 'Updated rule');
    expect(newId).toBeTruthy();
    expect(evolution.rules.get(id)?.lifecycle).toBe(RuleLifecycle.DEPRECATED);
    const mutated = evolution.rules.get(newId ?? '');
    expect(mutated?.version).toBe(2);
    expect(mutated?.mutation_count).toBe(1);
    expect(mutated?.parent_id).toBe(id);
    expect(evolution.getActiveRules().length).toBe(1);
  });

  it('非法状态流转返回 false', () => {
    const evolution = new RuleEvolution();
    const id = evolution.propose('r', 'desc');
    expect(evolution.activate('NOPE')).toBe(false);
    expect(evolution.mutate(id, 'x')).toBeUndefined(); // 非 active
    expect(evolution.deprecate(id)).toBe(false); // 非 active
  });

  it('deprecate → retire 完整退役', () => {
    const evolution = new RuleEvolution();
    const id = evolution.propose('r', 'desc');
    evolution.activate(id);
    expect(evolution.deprecate(id)).toBe(true);
    expect(evolution.retire(id)).toBe(true);
    expect(evolution.retire(id)).toBe(false); // retired 不可再 retire
  });
});

describe('GarbageCollection 垃圾回收', () => {
  it('默认 4 类调度注册', () => {
    const gc = new GarbageCollection();
    expect(gc.schedules.size).toBe(4);
    expect(gc.schedules.has('checkpoints')).toBe(true);
    expect(gc.schedules.has('sessions')).toBe(true);
  });

  it('registerSchedule 覆盖自定义调度', () => {
    const gc = new GarbageCollection();
    gc.registerSchedule({
      resource_type: 'custom',
      max_age_days: 1,
      last_run: 0,
      interval_hours: 1,
    });
    expect(gc.schedules.size).toBe(5);
  });

  it('checkAndCollect 删除超龄临时文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-gc-'));
    const oldFile = join(dir, 'stale.tmp');
    writeFileSync(oldFile, 'x');
    const { utimesSync } = await import('node:fs');
    const old = new Date(Date.now() - 10 * 86400_000);
    utimesSync(oldFile, old, old);
    // 非临时扩展名不删
    const keepFile = join(dir, 'keep.md');
    writeFileSync(keepFile, 'y');

    const gc = new GarbageCollection(dir);
    // 手动触发：last_run=0 + interval=0
    gc.registerSchedule({
      resource_type: 'checkpoints',
      max_age_days: 7,
      last_run: 0,
      interval_hours: 0,
    });
    const result = await gc.checkAndCollect();
    expect(result.collected).toContain('checkpoints');
    const details = result.details['checkpoints'] as { deleted_count: number };
    expect(details.deleted_count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('EntropyManager facade', () => {
  it('preCheck 注入高债务/陈旧文档标志', async () => {
    const manager = new EntropyManager();
    manager.setEntropyFlag('high_debt_alert', true);
    manager.setEntropyFlag('stale_docs_alert', true);
    const ctx = taskContext();
    await manager.preCheck(ctx);
    expect(ctx.metadata['entropy_alert']).toBe('high_technical_debt');
    expect(ctx.metadata['stale_docs']).toBe(true);
  });

  it('postTrack 错误 → 债务项 + 规则演化候选', async () => {
    const manager = new EntropyManager();
    const ctx = taskContext();
    await manager.postTrack(
      { status: 'failed', error: 'boom: something broke' },
      ctx,
    );
    expect(manager.debtTracker?.items.size).toBe(1);
    expect(manager.ruleEvolution?.rules.size).toBe(1);
    expect(manager.debtTracker?.items.get('DEBT-0001')?.severity).toBe(DebtSeverity.HIGH);
    expect(manager.ruleEvolution?.rules.get('RULE-0001')?.name).toContain('task-1');
  });

  it('postTrack 质量警告 → MEDIUM 债务 + 熵标志', async () => {
    const manager = new EntropyManager();
    await manager.postTrack({ quality_warning: 'low quality' }, taskContext());
    expect(manager.debtTracker?.items.get('DEBT-0001')?.severity).toBe(DebtSeverity.MEDIUM);
    expect(manager.entropyFlags.get('last_quality_warning')).toBe('task-1');
  });

  it('runDebtTracker 高债务阈值触发告警标志', async () => {
    const manager = new EntropyManager({ highDebtThreshold: 2 });
    manager.debtTracker?.record('a', DebtSeverity.HIGH);
    manager.debtTracker?.record('b', DebtSeverity.CRITICAL);
    await manager.runDebtTracker();
    expect(manager.entropyFlags.get('high_debt_alert')).toBe(true);
  });

  it('runRuleEvolution 从失败记录提议规则', async () => {
    const manager = new EntropyManager();
    const proposed = await manager.runRuleEvolution([
      { task_id: 't1', error: 'err1' },
      { task_id: 't2', error: 'err2' },
    ]);
    expect(proposed).toHaveLength(2);
    expect(proposed[0]?.rule_id).toBe('RULE-0001');
    expect(manager.ruleEvolution?.rules.size).toBe(2);
  });

  it('check 综合报告 + harness 违规转债务', async () => {
    const manager = new EntropyManager({ docGardenerEnabled: false });
    const ctx = taskContext({
      state: {
        harness_violations: [{ violation: 'bypassed mediator' }],
        linter_violations: [
          { rule_name: 'no-debugger', description: 'found debugger', severity: 'error' },
        ],
      },
    });
    const report = (await manager.check(ctx)) as Record<string, unknown>;
    expect(report['doc_freshness']).toBeDefined();
    expect(report['debt_summary']).toBeDefined();
    expect(report['gc_result']).toBeDefined();
    expect(manager.debtTracker?.items.size).toBe(2);
    expect(manager.debtTracker?.items.get('DEBT-0001')?.source).toBe('harness_violation');
    expect(manager.debtTracker?.items.get('DEBT-0002')?.source).toBe('linter');
    expect(manager.debtTracker?.items.get('DEBT-0002')?.severity).toBe(DebtSeverity.HIGH);
  });

  it('getStatus 汇总计数器', async () => {
    const manager = new EntropyManager();
    await manager.preCheck(taskContext());
    await manager.postTrack({ error: 'x' }, taskContext());
    const status = manager.getStatus();
    expect(status['pre_check_count']).toBe(1);
    expect(status['post_track_count']).toBe(1);
    expect(status['enabled']).toBe(true);
  });

  it('禁用组件时对应方法返回空', async () => {
    const manager = new EntropyManager({
      docGardenerEnabled: false,
      debtTrackerEnabled: false,
      ruleEvolutionEnabled: false,
    });
    expect(await manager.runDocGardener()).toEqual([]);
    expect(await manager.runDebtTracker()).toEqual([]);
    expect(await manager.runRuleEvolution([{ task_id: 't', error: 'e' }])).toEqual([]);
  });
});
