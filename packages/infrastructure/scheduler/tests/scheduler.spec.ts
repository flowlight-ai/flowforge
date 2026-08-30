/**
 * scheduler 插件包测试 — C33（F139 统一调度抽象）。
 *
 * 覆盖：ActorResolver（role 匹配 + costTier lead 偏好 + available 过滤）；
 * RunLedger record/query/queryBySubject/stats；DynamicTaskStore CRUD +
 * updateTrigger/updateParamsIfCurrent CAS；EmissionStore 抑制窗口 + cleanup；
 * GlobalControlStore 全局开关 + task override；PackTemplateStore install 校验
 * （F255 边界 / 命名空间 / 重复）+ listByPack；Cordis 插件挂载。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeSchedulerService, {
  createActorResolver,
  DynamicTaskStore,
  EmissionStore,
  F255_PRESENT_LOOP_TEMPLATE_ID,
  f255ConfigRequired,
  GlobalControlStore,
  isF255ConfigOnlyTemplate,
  isF255PresentLoopBuiltinRef,
  openDatabase,
  PackTemplateStore,
  RunLedger,
  type DynamicTaskDef,
  type PackTemplateDef,
  type RunLedgerRow,
} from '../src/index.ts';

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-sched-'));
  tempDirs.push(dir);
  return join(dir, 'scheduler.db');
}

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ActorResolver
// ---------------------------------------------------------------------------

describe('createActorResolver', () => {
  const roster = {
    'cat-lead': { family: 'felidae', roles: ['architect', 'peer-reviewer'], lead: true, available: true },
    'cat-junior': { family: 'felidae', roles: ['architect'], lead: false, available: true },
    'cat-busy': { family: 'felidae', roles: ['architect'], lead: false, available: false },
  };

  it('role 匹配 + available 过滤', () => {
    const resolve = createActorResolver(() => roster);
    expect(resolve('memory-curator', 'cheap')).toBe('cat-junior');
  });

  it('deep → lead 优先；cheap → 非 lead 优先', () => {
    const resolve = createActorResolver(() => roster);
    expect(resolve('health-monitor', 'deep')).toBe('cat-lead');
    expect(resolve('health-monitor', 'cheap')).toBe('cat-junior');
  });

  it('无候选 → null', () => {
    const resolve = createActorResolver(() => roster);
    expect(resolve('repo-watcher', 'deep')).toBe('cat-lead');
    expect(createActorResolver(() => ({}))('memory-curator', 'cheap')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RunLedger
// ---------------------------------------------------------------------------

function ledgerRow(overrides: Partial<RunLedgerRow> = {}): RunLedgerRow {
  return {
    task_id: 't1',
    subject_key: 'repo/a',
    outcome: 'RUN_DELIVERED',
    signal_summary: 'ok',
    duration_ms: 120,
    started_at: Date.now(),
    assigned_cat_id: null,
    ...overrides,
  };
}

describe('RunLedger', () => {
  it('record → query / queryBySubject / stats', () => {
    const db = openDatabase(':memory:');
    const ledger = new RunLedger(db);
    ledger.record(ledgerRow());
    ledger.record(ledgerRow({ subject_key: 'repo/b', outcome: 'RUN_FAILED', error_summary: 'boom' }));
    ledger.record(ledgerRow({ subject_key: 'repo/a', outcome: 'SKIP_NO_SIGNAL' }));

    expect(ledger.query('t1', 10).length).toBe(3);
    expect(ledger.queryBySubject('t1', 'repo/a', 10).length).toBe(2);
    const stats = ledger.stats('t1');
    expect(stats.total).toBe(3);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.skipped).toBe(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// DynamicTaskStore
// ---------------------------------------------------------------------------

function taskDef(id: string, overrides: Partial<DynamicTaskDef> = {}): DynamicTaskDef {
  return {
    id,
    templateId: 'system:health',
    trigger: { type: 'interval', ms: 60_000 },
    params: {},
    display: { label: '健康检查', category: 'system' },
    deliveryThreadId: null,
    enabled: true,
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('DynamicTaskStore', () => {
  it('insert → getAll/getById + upsert 更新 + remove + setEnabled', () => {
    const db = openDatabase(':memory:');
    const store = new DynamicTaskStore(db);
    store.insert(taskDef('a'));
    store.insert(taskDef('b', { enabled: false }));

    expect(store.getAll().length).toBe(2);
    expect(store.getById('a')?.templateId).toBe('system:health');
    expect(store.getById('b')?.enabled).toBe(false);

    // upsert 替换执行投影
    store.upsert(taskDef('a', { trigger: { type: 'interval', ms: 1000 } }));
    expect(store.getById('a')?.trigger).toEqual({ type: 'interval', ms: 1000 });

    expect(store.setEnabled('b', true)).toBe(true);
    expect(store.getById('b')?.enabled).toBe(true);
    expect(store.remove('a')).toBe(true);
    expect(store.getById('a')).toBeNull();
    db.close();
  });

  it('updateTrigger 持久化 re-arm + updateParamsIfCurrent CAS', () => {
    const db = openDatabase(':memory:');
    const store = new DynamicTaskStore(db);
    store.insert(taskDef('a'));
    const rearmed = { type: 'once' as const, fireAt: Date.now() + 30_000 };
    expect(store.updateTrigger('a', rearmed)).toBe(true);
    expect(store.getById('a')?.trigger).toEqual(rearmed);

    // CAS：current 匹配才更新
    const p1 = { phase: 'dev' };
    store.updateParams('a', p1);
    expect(store.updateParamsIfCurrent('a', p1, { phase: 'review' })).toBe(true);
    expect(store.getById('a')?.params).toEqual({ phase: 'review' });
    expect(store.updateParamsIfCurrent('a', p1, { phase: 'done' })).toBe(false);
    expect(store.getById('a')?.params).toEqual({ phase: 'review' });
    db.close();
  });
});

// ---------------------------------------------------------------------------
// EmissionStore
// ---------------------------------------------------------------------------

describe('EmissionStore', () => {
  it('record → isSuppressed 窗口内 true → cleanup 后 false', async () => {
    const db = openDatabase(':memory:');
    const store = new EmissionStore(db);
    store.record({ originTaskId: 't1', threadId: 'th1', messageId: 'm1', suppressionMs: 50 });
    expect(store.isSuppressed('t1', 'th1')).toBe(true);
    expect(store.isSuppressed('t1', 'th2')).toBe(false);
    expect(store.listActive().length).toBe(1);

    await new Promise<void>((r) => setTimeout(r, 80));
    store.cleanup();
    expect(store.isSuppressed('t1', 'th1')).toBe(false);
    expect(store.listActive().length).toBe(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// GlobalControlStore
// ---------------------------------------------------------------------------

describe('GlobalControlStore', () => {
  it('默认 enabled → setGlobalEnabled 暂停 → task override → remove', () => {
    const db = openDatabase(':memory:');
    const store = new GlobalControlStore(db);
    expect(store.getGlobalEnabled()).toBe(true);

    store.setGlobalEnabled(false, 'maintenance', 'operator');
    expect(store.getGlobalEnabled()).toBe(false);
    expect(store.getGlobalState()).toMatchObject({ enabled: false, reason: 'maintenance', updatedBy: 'operator' });

    store.setTaskOverride('t1', false, 'operator');
    expect(store.getTaskOverride('t1')?.enabled).toBe(false);
    expect(store.listOverrides().length).toBe(1);
    expect(store.removeTaskOverride('t1')).toBe(true);
    expect(store.getTaskOverride('t1')).toBeNull();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// PackTemplateStore + F255 边界
// ---------------------------------------------------------------------------

function packDef(templateId: string, packId = 'demo', builtinRef = 'custom'): PackTemplateDef {
  return {
    templateId,
    packId,
    label: '模板',
    description: '描述',
    category: 'system',
    subjectKind: 'none',
    defaultTrigger: { type: 'interval', ms: 5000 },
    paramSchema: {},
    builtinTemplateRef: builtinRef,
  };
}

describe('PackTemplateStore + F255 边界', () => {
  it('install 校验：F255 边界 / 命名空间 / 重复 → 拒绝', () => {
    const db = openDatabase(':memory:');
    const store = new PackTemplateStore(db);
    expect(isF255PresentLoopBuiltinRef(F255_PRESENT_LOOP_TEMPLATE_ID)).toBe(true);

    // F255 Present Loop 不可作为 pack delegate
    expect(() => store.install(packDef('pack:demo:pl', 'demo', F255_PRESENT_LOOP_TEMPLATE_ID))).toThrow(/F255 cat-life/);
    // 非 pack: 前缀
    expect(() => store.install(packDef('system:demo:x', 'demo'))).toThrow(/must start with pack:/);
    // 命名空间不一致
    expect(() => store.install(packDef('pack:other:x', 'demo'))).toThrow(/Namespace mismatch/);
    // 正常安装
    store.install(packDef('pack:demo:x', 'demo'));
    // 重复
    expect(() => store.install(packDef('pack:demo:x', 'demo'))).toThrow(/already installed/);

    expect(store.get('pack:demo:x')?.packId).toBe('demo');
    expect(store.listByPack('demo').length).toBe(1);
    expect(store.listAll().length).toBe(1);
    expect(store.uninstall('pack:demo:x')).toBe(true);
    db.close();
  });

  it('isF255ConfigOnlyTemplate', () => {
    const db = openDatabase(':memory:');
    const store = new PackTemplateStore(db);
    // Present Loop 本体不可作为 pack delegate 安装（install 直接拒绝）
    expect(() => store.install(packDef('pack:demo:pl', 'demo', F255_PRESENT_LOOP_TEMPLATE_ID))).toThrow(/F255 cat-life/);
    store.install(packDef('pack:demo:x', 'demo', 'custom-ref'));
    expect(isF255ConfigOnlyTemplate(F255_PRESENT_LOOP_TEMPLATE_ID)).toBe(true);
    expect(isF255ConfigOnlyTemplate('pack:demo:x', store)).toBe(false);
    expect(f255ConfigRequired().code).toBe('F255_CONFIG_REQUIRED');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Cordis 插件
// ---------------------------------------------------------------------------

describe('ForgeSchedulerService（Cordis 插件）', () => {
  it('挂载 ctx.forgeScheduler + 五 store 共用句柄 + onStop 关闭', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeSchedulerService, { dbPath: makeDbPath() })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);

    const svc = ctx.forgeScheduler;
    expect(svc).toBeDefined();
    svc.runLedger.record(ledgerRow());
    expect(svc.runLedger.query('t1', 10).length).toBe(1);
    svc.dynamicTasks.insert(taskDef('a'));
    expect(svc.dynamicTasks.getAll().length).toBe(1);
    svc.emissions.record({ originTaskId: 't1', threadId: 'th', messageId: 'm', suppressionMs: 1000 });
    expect(svc.emissions.isSuppressed('t1', 'th')).toBe(true);
    expect(svc.globalControl.getGlobalEnabled()).toBe(true);
    svc.packTemplates.install(packDef('pack:demo:x'));
    expect(svc.packTemplates.listAll().length).toBe(1);

    const resolver = svc.createActorResolver(() => ({
      'cat-a': { family: 'f', roles: ['architect'], lead: false, available: true },
    }));
    expect(resolver('memory-curator', 'cheap')).toBe('cat-a');

    await fiber.dispose();
  });

  it('文件型 dbPath 持久化（重启后数据仍在）', async () => {
    const dbPath = makeDbPath();
    {
      const ctx = new Context();
      const fiber = (await ctx.plugin(ForgeSchedulerService, { dbPath })) as unknown as {
        dispose: () => Promise<void> | void;
      };
      fibers.push(fiber);
      ctx.forgeScheduler.dynamicTasks.insert(taskDef('persist-1'));
      await fiber.dispose();
    }
    {
      const ctx = new Context();
      const fiber = (await ctx.plugin(ForgeSchedulerService, { dbPath })) as unknown as {
        dispose: () => Promise<void> | void;
      };
      fibers.push(fiber);
      expect(ctx.forgeScheduler.dynamicTasks.getById('persist-1')).not.toBeNull();
      await fiber.dispose();
    }
  });
});
