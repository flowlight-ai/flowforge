/**
 * @flowforge/infrastructure-scheduler — C33 scheduler 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/scheduler/*`（F139 统一调度抽象）：
 *   - types：WorkItem/GateResult/TriggerSpec/RunOutcome/ActorSpec 等契约
 *   - ActorResolver：actor.role + costTier → catId（注入式 roster）
 *   - RunLedger / DynamicTaskStore / EmissionStore / GlobalControlStore /
 *     PackTemplateStore 五 store（node:sqlite 后端，dsh 范式，共用句柄）
 *   - f255-template-boundary：Present Loop 归属边界
 *
 * 插件化改造：
 *   - better-sqlite3 → node:sqlite DatabaseSync（对齐 cats-stores-sqlite）
 *   - clowder 单例 → ctx.forgeScheduler 服务（dbPath 注入，`:memory:` 测试）
 *   - TaskRunnerV2/execute-pipeline/delivery/content-fetcher/schedule-notify
 *     等运行时文件深度耦合 cats invocation/connector，随对应特性移植再补
 *
 * 消费者加载默认插件：
 * ```ts
 * import ForgeScheduler from '@flowforge/infrastructure-scheduler'
 * ctx.plugin(ForgeScheduler, { dbPath: ':memory:' })
 * // ctx.forgeScheduler.runLedger.record(...)
 * // ctx.forgeScheduler.dynamicTasks.upsert(...)
 * ```
 *
 * @module @flowforge/infrastructure-scheduler
 */

import { Context, Service } from '@flowforge/cordis';
import type { DatabaseSync } from 'node:sqlite';

import { createActorResolver, type RosterGetter } from './actor-resolver.ts';
import { openDatabase } from './schema.ts';
import {
  DynamicTaskStore,
  EmissionStore,
  GlobalControlStore,
  PackTemplateStore,
  RunLedger,
} from './stores.ts';

export { createActorResolver } from './actor-resolver.ts';
export type { RosterEntry, RosterGetter } from './actor-resolver.ts';
export { openDatabase, SCHEMA_VERSION, SCHEDULER_SQLITE_APPLICATION_ID } from './schema.ts';
export {
  DynamicTaskStore,
  EmissionStore,
  GlobalControlStore,
  PackTemplateStore,
  RunLedger,
} from './stores.ts';
export {
  F255_PRESENT_LOOP_TEMPLATE_ID,
  f255ConfigRequired,
  isF255ConfigOnlyTemplate,
  isF255PresentLoopBuiltinRef,
} from './f255-template-boundary.ts';
export * from './types.ts';

export interface SchedulerConfig {
  /** SQLite 数据库路径（`:memory:` 用于测试）。必填。 */
  dbPath: string;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** scheduler 域（C33）：调度 stores + actor 解析 */
    forgeScheduler: ForgeSchedulerService;
  }
}

/**
 * scheduler 域服务 — 挂载 `ctx.forgeScheduler`。
 * 五 store 共用一个 node:sqlite 句柄；createActorResolver 绑定注入式 roster。
 */
export class ForgeSchedulerService extends Service {
  readonly runLedger: RunLedger;
  readonly dynamicTasks: DynamicTaskStore;
  readonly emissions: EmissionStore;
  readonly globalControl: GlobalControlStore;
  readonly packTemplates: PackTemplateStore;
  private readonly db: DatabaseSync;

  constructor(ctx: Context, config: SchedulerConfig) {
    super(ctx, 'forgeScheduler');
    this.db = openDatabase(config.dbPath);
    this.runLedger = new RunLedger(this.db);
    this.dynamicTasks = new DynamicTaskStore(this.db);
    this.emissions = new EmissionStore(this.db);
    this.globalControl = new GlobalControlStore(this.db);
    this.packTemplates = new PackTemplateStore(this.db);
    // fiber dispose 时关闭数据库（对齐 cats-stores-sqlite 清理模式）
    this.ctx.effect(() => () => {
      this.db.close();
    }, 'forgeScheduler.close');
  }

  /** 创建绑定 roster 的 actor 解析器（deep→lead 优先，cheap→非 lead 优先）。 */
  createActorResolver(getRoster: RosterGetter): (role: import('./types.ts').ActorRole, costTier: import('./types.ts').CostTier) => string | null {
    return createActorResolver(getRoster);
  }
}

export default ForgeSchedulerService;
