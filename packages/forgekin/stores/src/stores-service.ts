/**
 * @flowforge/forgekin-stores — 阶段7 T7.22 存储治理 Cordis 插件。
 *
 * 挂载 `ctx.forgeStores`：
 *   - wal: WriteAheadLog（F21 Side-Effect WAL，事件写前日志 + 崩溃重放）
 *   - collections: CollectionManager（F39 记忆集合 CRUD，backend 协议注入）
 *   - governance: MemoryGovernance（F39 治理三要素：权威等级 / 消费加权 / 衰减策略）
 *
 * TS 重写自 Python `core/reliability/wal.py`（spec tests）+
 * `core/memory_federation/{collection,governance}.py`（F014/F016/F017）。
 */

import { Context, Service } from '@flowforge/cordis';
import { CollectionManager } from './collection.js';
import { MemoryGovernance, type GovernanceConfig } from './governance.js';
import { WriteAheadLog } from './wal.js';

export * from './wal.js';
export * from './collection.js';
export * from './governance.js';

export interface StoresServiceOptions {
  /** WAL 实例（缺省新建）。 */
  readonly wal?: WriteAheadLog | undefined;
  /** 集合管理器（缺省新建；可注入共享 backend 实例）。 */
  readonly collections?: CollectionManager | undefined;
  /** 治理引擎（缺省新建）。 */
  readonly governance?: MemoryGovernance | undefined;
  /** 治理配置（governance 未注入时用于新建；铁律 5 参数外置）。 */
  readonly governanceConfig?: GovernanceConfig | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 存储治理域：Side-Effect WAL + 记忆集合 + 治理三要素 */
    forgeStores: StoresService;
  }
}

/**
 * 存储治理域服务 — WAL / 集合 / 治理统一入口。
 *
 * 组装：
 * - wal: WriteAheadLog（事件写前日志，副作用先落日志后执行）
 * - collections: CollectionManager（多域记忆集合，backend 协议注入）
 * - governance: MemoryGovernance（权威等级 / 消费加权 / 衰减策略）
 */
export class StoresService extends Service {
  readonly wal: WriteAheadLog;
  readonly collections: CollectionManager;
  readonly governance: MemoryGovernance;

  constructor(ctx: Context, options: StoresServiceOptions = {}) {
    super(ctx, 'forgeStores');
    this.wal = options.wal ?? new WriteAheadLog();
    this.collections = options.collections ?? new CollectionManager();
    this.governance =
      options.governance ?? new MemoryGovernance(options.governanceConfig);
  }

  /**
   * WAL 便捷委托：append（副作用前落日志）。
   *
   * @param action 动作名（非空）。
   * @param target 目标（非空）。
   * @param params 动作参数（深拷贝存储）。
   */
  async walAppend(
    action: string,
    target: string,
    params: Record<string, unknown> = {},
  ): Promise<string> {
    return this.wal.append(action, target, params);
  }

  /** 集合便捷委托：创建集合。 */
  async createCollection(
    name: string,
    domain: string,
  ): Promise<Awaited<ReturnType<CollectionManager['create']>>> {
    return this.collections.create(name, domain);
  }

  /** 治理便捷委托：计算权威等级。 */
  async computeAuthority(
    entry: Parameters<MemoryGovernance['compute_authority']>[0],
  ): Promise<number> {
    return this.governance.compute_authority(entry);
  }
}

export default function Plugin(
  ctx: Context,
  options: StoresServiceOptions = {},
): void {
  ctx.forgeStores = new StoresService(ctx, options);
}
