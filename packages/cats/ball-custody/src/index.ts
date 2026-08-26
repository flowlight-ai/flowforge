/**
 * @flowforge/cats-ball-custody — 球权托管 Cordis 插件（F005 + F006 + C24）。
 *
 * TS 移植自 `docs/features/F005-ball-custody-lease.md` + `F006-push-back-protocol.md`
 * 及 clowder-ai `domains/ball-custody`（C24 球状态机）：
 *   - registry：BallCustodyRegistry 球权租借（TTL 300s 安全网 + now_fn 注入 + 双持球防护）
 *   - pushBack：PushBackProtocol 推回协议（三要素强制 + 显式 resolve）
 *   - state-machine：8 状态 × 17 事件表驱动转移纯函数（C24）
 *   - projector：BallCustodyProjector 事件溯源投影 + 内存 log/store（可换持久实现）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsBallCustody from '@flowforge/cats-ball-custody'
 * ctx.plugin(CatsBallCustody)
 * // ctx.catsBallCustody.registry.acquire(...) / .pushBack.createPushBack(...)
 * // ctx.catsBallCustody.createProjector(log, store).apply(event)
 * ```
 *
 * @module @flowforge/cats-ball-custody
 */

import { Context, Service } from '@flowforge/cordis';
import { loadBallCustodyConfig } from './config.js';
import { BallCustodyRegistry } from './registry.js';
import { PushBackProtocol } from './push-back.js';
import { BallCustodyProjector, type IBallCustodyEventLog, type IBallCustodyProjectionStore } from './projector.js';
import type { NowFn } from './models.js';

// Re-export 核心实现 + 类型。
export { BallCustodyRegistry, DEFAULT_TTL_SECONDS } from './registry.js';
export type { BallCustodyMetrics } from './registry.js';
export { PushBackProtocol } from './push-back.js';
export {
  BallCustodyProjector,
  InMemoryBallCustodyEventLog,
  InMemoryBallCustodyProjectionStore,
} from './projector.js';
export type { IBallCustodyEventLog, IBallCustodyProjectionStore } from './projector.js';
export {
  ALL_BALL_EVENT_KINDS,
  ALL_BALL_STATES,
  DEAD_BALL_ZOMBIE_GRACE_MS,
  transition,
} from './state-machine.js';
export type { BallTransitionReject, BallTransitionResult, BallTransitionSnapshot } from './state-machine.js';
export { loadBallCustodyConfig, builtinBallCustodyYamlPath, builtinConfigDir } from './config.js';
export type { BallCustodyConfig } from './config.js';
export {
  assertNonEmpty,
  assertPositiveTtl,
  BallCustodyError,
} from './models.js';
export type {
  BallCustodyEvent,
  BallCustodyProjection,
  BallEuthanasiaKind,
  BallEventClassification,
  BallEventKind,
  BallIntent,
  BallResolveMode,
  BallState,
  CustodyLease,
  NowFn,
  PushBack,
} from './models.js';

/** BallCustodyService 构造选项（对齐 ball-custody.yaml 各段，铁律 5 参数外置）。 */
export interface BallCustodyServiceOptions {
  /** 时间函数注入（F005 INV-5：测试快进确定性；缺省 Date.now）。 */
  readonly nowFn?: NowFn | undefined;
  /** 显式 YAML 路径（缺省用包内置 config/ball-custody.yaml）。 */
  readonly configPath?: string | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 球权托管域：球权租借 + 推回协议 + 球状态机投影器工厂 */
    catsBallCustody: BallCustodyService;
  }
}

/**
 * 球权托管域服务 — 组装 F005 registry + F006 push-back + C24 projector 工厂。
 *
 * 挂载 `ctx.catsBallCustody`，提供：
 *   - registry：BallCustodyRegistry（acquire / renew / release / currentHolder / isExpired）
 *   - pushBack：PushBackProtocol（createPushBack / resolve / listUnresolved / listAll / get）
 *   - createProjector()：C24 事件溯源投影器工厂（log + store 注入，可换持久实现）
 */
export class BallCustodyService extends Service {
  /** F005 球权租借 registry（TTL 安全网 + now_fn 注入 + 双持球防护）。 */
  readonly registry: BallCustodyRegistry;
  /** F006 推回协议（三要素强制 + 显式 resolve）。 */
  readonly pushBack: PushBackProtocol;
  /** 加载的配置快照（ball-custody.yaml，供上层服务读阈值）。 */
  readonly config: ReturnType<typeof loadBallCustodyConfig>;

  constructor(ctx: Context, options: BallCustodyServiceOptions = {}) {
    super(ctx, 'catsBallCustody');
    const nowFn = options.nowFn;
    this.registry = new BallCustodyRegistry(nowFn);
    this.pushBack = new PushBackProtocol(nowFn);
    this.config = loadBallCustodyConfig(options.configPath);
  }

  /** 创建 C24 球状态机投影器（事件溯源：apply / rebuild / rebuildAll）。 */
  createProjector(
    eventLog: IBallCustodyEventLog,
    store: IBallCustodyProjectionStore,
  ): BallCustodyProjector {
    return new BallCustodyProjector(eventLog, store);
  }
}

export default BallCustodyService;
