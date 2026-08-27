/**
 * @flowforge/cats-guides — Guides + Concierge Cordis 插件（F155 + F229，C25）。
 *
 * TS 移植自 clowder-ai `domains/guides`（F155：registry loader / orchestration flow /
 * 5 态 guide 状态机 / session repository / lifecycle / action / routing interceptor /
 * prompt section）与 `domains/concierge`（F229：per-user 配置 / concierge thread 服务 /
 * search context / reply validator / triage plan / investigation job / relay / confirmation）：
 *   - registry：GuideRegistryLoader registry.yaml 加载 + 意图匹配 + flow 加载
 *   - lifecycle：GuideLifecycleService 状态校验/持久化/socket 事件/遥测
 *   - actions：GuideActionService start/cancel/preview/complete + self-heal
 *   - concierge：KV-backed 存储群（config / thread claim / relay / confirmation /
 *     triage-plan / investigation-job），缺省内存实现，宿主可注入持久 KV
 *
 * 插件化改造（dhs 模式，对照 clowder）：
 *   - RedisClient → ConciergeKeyValueStore 注入（setNx/deleteIf CAS 语义保留）
 *   - catRegistry 单例 → RosterResolver 注入（duty cat profile 解析）
 *   - socket.emitToUser → GuideEmitFn 回调；guideTransitions → TelemetryFn 回调
 *   - ThreadStore 完整实现 → IThreadStore 最小接口注入（缺省内存 stub）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsGuides from '@flowforge/cats-guides'
 * ctx.plugin(CatsGuides)
 * // ctx.catsGuides.lifecycle.updateGuideState(...) / .actions.startGuideAction(...)
 * // ctx.catsGuides.concierge.threadService.getOrCreate(userId) / .triagePlanStore.create(...)
 * ```
 *
 * @module @flowforge/cats-guides
 */

import { Context, Service } from '@flowforge/cordis';
import { loadGuidesConfig } from './config.js';
import { GuideRegistryLoader, loadGuideFlowFrom, loaderOptionsFromConfig } from './registry-loader.js';
import { InMemoryGuideSessionStore, createGuideStoreBridge } from './session-repository.js';
import { GuideLifecycleService } from './lifecycle-service.js';
import { GuideActionService } from './action-service.js';
import { InMemoryGuideDismissTracker } from './dismiss-tracker.js';
import { ConciergeThreadService } from './concierge/thread-service.js';
import { KvConciergeConfigStore } from './concierge/config-store.js';
import { KvConciergeRelayStore } from './concierge/relay-store.js';
import { KvConciergeConfirmationStore } from './concierge/confirmation-store.js';
import { KvConciergeTriagePlanStore } from './concierge/triage-plan-store.js';
import { KvConciergeInvestigationJobStore } from './concierge/investigation-job-store.js';
import type { ConciergeKeyValueStore } from './concierge/kv-store.js';
import { MemoryConciergeKeyValueStore } from './concierge/kv-store.js';
import type { RosterResolver } from './concierge/config-store.js';
import type { ConciergeEvidenceStore } from './models.js';
import type { GuideEmitFn, IThreadStore, TelemetryFn } from './ports.js';
import type { ConciergeThreadTitleLookup } from './concierge/verified-tool-target.js';
import { InMemoryGuideThreadStore } from './thread-store.js';

// Re-export 核心实现 + 类型（与子路径导出一致）。
export { GuideRegistryLoader, GUIDE_TARGET_RE, loadGuideFlowFrom } from './registry-loader.js';
export type {
  AvailableGuide,
  GuideAvailabilityContext,
  GuideMatch,
  GuideRegistryEntry,
  GuideRegistryLoaderOptions,
  GuideResolveContext,
  OrchestrationFlow,
  OrchestrationStep,
  TipsMetadata,
} from './registry-loader.js';
export { InMemoryGuideSessionStore, createGuideStoreBridge, sessionToLegacyState } from './session-repository.js';
export type { IGuideSessionStore } from './session-repository.js';
export { GuideLifecycleService } from './lifecycle-service.js';
export type { GuideLifecycleDeps, LifecycleResult } from './lifecycle-service.js';
export { GuideActionService } from './action-service.js';
export { InMemoryGuideDismissTracker } from './dismiss-tracker.js';
export type { IGuideDismissTracker } from './dismiss-tracker.js';
export {
  applyTransition,
  createOfferedState,
  isTerminal,
  isValidTransition,
  transitionToActive,
  transitionToAwaitingChoice,
  transitionToCancelled,
  transitionToCompleted,
  validTransitionsFrom,
} from './state-machine.js';
export {
  canAccessGuideState,
  canAccessThread,
  hasHiddenForeignNonTerminalGuideState,
  isSharedDefaultThread,
} from './state-access.js';
export { loadGuidesConfig, builtinConfigDir, builtinGuidesYamlPath, builtinRegistryYamlPath } from './config.js';
export type { GuidesConfig } from './config.js';
export {
  CONCIERGE_CONFIG_DEFAULTS,
  BALL_SIZE_DEFAULT,
  BALL_SIZE_MAX,
  BALL_SIZE_MIN,
  clampBallSize,
  GuidesError,
  INVESTIGATION_DEADLINE_MS,
} from './models.js';
export type {
  ConfirmationStatus,
  ConciergeCardAction,
  ConciergeConfig,
  ConciergeEvidenceItem,
  ConciergeEvidenceStore,
  HandleAnchor,
  HandleEntry,
  InvestigationAnchor,
  InvestigationJob,
  InvestigationJobStatus,
  InvestigationReport,
  PendingConfirmation,
  RelayReceipt,
  RelayReceiptStatus,
  TriagePlan,
  TriagePlanIntent,
  TriagePlanResult,
  TriagePlanStatus,
  TriagePlanTarget,
} from './models.js';
export {
  buildConciergeActions,
  extractConciergeActions,
  extractTriagePlanActions,
  extractTriagePlanIdsFromActions,
  stripTriagePlanMarkers,
} from './concierge/reply-validator.js';
export type { ConciergeAction, TriagePlanExtractionDeps } from './concierge/reply-validator.js';
export {
  buildConciergeSearchContext,
  computeConciergeHandleDigest,
  formatConciergeHandleBinding,
  formatConciergeHandleBindingTitle,
  normalizeConciergeHandleTitle,
} from './concierge/search-context.js';
export type { BuildConciergeSearchContextOptions, ConciergeSearchContextResult } from './concierge/search-context.js';
export { resolveTargetCats } from './concierge/target-cats-resolver.js';
export type { TargetCatsResolverDeps, TargetCatsResult } from './concierge/target-cats-resolver.js';
export {
  VerifiedConciergeToolTargetCollector,
  resolveVerifiedConciergeToolAnchor,
} from './concierge/verified-tool-target.js';
export type { ConciergeThreadTitleLookup, ConciergeToolEvent, VerifiedConciergeToolTarget } from './concierge/verified-tool-target.js';
export { executeInvestigation } from './concierge/investigation-worker.js';
export { isJobExpired } from './concierge/investigation-job-store.js';
export {
  KvConciergeConfigStore,
  MemoryConciergeConfigStore,
  resolveDefaultDutyCatProfileId,
} from './concierge/config-store.js';
export type { IConciergeConfigStore, RosterResolver } from './concierge/config-store.js';
export { ConciergeThreadService } from './concierge/thread-service.js';
export type { ConciergeThreadServiceDeps } from './concierge/thread-service.js';
export { KvConciergeRelayStore } from './concierge/relay-store.js';
export type { IConciergeRelayStore } from './concierge/relay-store.js';
export { KvConciergeConfirmationStore } from './concierge/confirmation-store.js';
export type { IConciergeConfirmationStore } from './concierge/confirmation-store.js';
export { KvConciergeTriagePlanStore } from './concierge/triage-plan-store.js';
export type { IConciergeTriagePlanStore } from './concierge/triage-plan-store.js';
export { KvConciergeInvestigationJobStore } from './concierge/investigation-job-store.js';
export type { IConciergeInvestigationJobStore } from './concierge/investigation-job-store.js';
export { ConciergeKeys } from './concierge/keys.js';
export { MemoryConciergeKeyValueStore } from './concierge/kv-store.js';
export type { ConciergeKeyValueStore } from './concierge/kv-store.js';
export { buildConciergePromptLines } from './concierge/prompt-section.js';
export {
  prepareConciergeContext,
  conciergeContextForCat,
} from './concierge/routing-interceptor.js';
export type { ConciergeInvocationContext, ConciergeRouteThread } from './concierge/routing-interceptor.js';
export {
  prepareGuideContext,
  guideContextForCat,
  ackGuideCompletion,
} from './routing-interceptor.js';
export type { GuideCandidate, GuideRouteThread, GuideRoutingContext } from './routing-interceptor.js';
export { buildGuidePromptLines } from './prompt-section.js';
export type { GuidePromptInput } from './prompt-section.js';
export { InMemoryGuideThreadStore } from './thread-store.js';
export type { GuideThreadAccess, IThreadStore, GuideEmitFn, TelemetryFn } from './ports.js';

/** GuidesService 构造选项（对齐 guides.yaml + concierge 各段，铁律 5 参数外置）。 */
export interface GuidesServiceOptions {
  /** 显式 guides.yaml 路径（缺省用包内置 config/guides.yaml）。 */
  readonly configPath?: string | undefined;
  /** 显式 registry.yaml 路径（测试/宿主部署注入；缺省用 config.guides.registry_path）。 */
  readonly registryPath?: string | undefined;
  /** 线程元数据存储注入（缺省内存 stub：单实例幂等，不跨进程）。 */
  readonly threadStore?: IThreadStore | undefined;
  /** 持久 KV 注入（缺省内存实现；宿主可传 sqlite/redis 适配器）。 */
  readonly kv?: ConciergeKeyValueStore | undefined;
  /** socket.emitToUser 注入（guide 状态事件；缺省 no-op）。 */
  readonly emit?: GuideEmitFn | undefined;
  /** guideTransitions telemetry 注入（缺省 no-op）。 */
  readonly telemetry?: TelemetryFn | undefined;
  /** roster 解析注入（dutyCatProfileId 默认值；缺省空 roster → 'sonnet'）。 */
  readonly roster?: RosterResolver | undefined;
  /** 证据检索注入（concierge search context / investigation worker；缺省不注入 → fail-open）。 */
  readonly evidenceStore?: ConciergeEvidenceStore | undefined;
  /** thread 标题查询注入（verified tool anchor 水合；缺省不注入 → 跳过）。 */
  readonly threadLookup?: ConciergeThreadTitleLookup | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** guides + concierge 域：F155 引导流程 + F229 前台猫。 */
    catsGuides: GuidesService;
  }
}

/**
 * Guides + Concierge 域服务 — 组装 F155 guide 服务群 + F229 concierge 服务群。
 *
 * 挂载 `ctx.catsGuides`，提供：
 *   - registry：GuideRegistryLoader（registry.yaml + 意图匹配 + flow 加载）
 *   - lifecycle：GuideLifecycleService（updateGuideState / start / control）
 *   - actions：GuideActionService（start / cancel / preview / complete + self-heal）
 *   - sessionStore / guideStore / dismissTracker：guide 状态存储桥
 *   - concierge：concierge 存储服务群（configStore / threadService / relayStore /
 *     confirmationStore / triagePlanStore / investigationJobStore）
 *   - evidenceStore / threadLookup：concierge 检索与标题查询注入
 */
export class GuidesService extends Service {
  /** 加载的配置快照（guides.yaml，供上层服务读阈值）。 */
  readonly config: ReturnType<typeof loadGuidesConfig>;
  /** F155 guide registry（registry.yaml 加载 + 意图匹配 + flow 加载）。 */
  readonly registry: GuideRegistryLoader;
  /** guide 会话存储（运行期内存，重启即清空，对齐 clowder 语义）。 */
  readonly sessionStore: InMemoryGuideSessionStore;
  /** guide 状态桥（独立存储，thread 无关）。 */
  readonly guideStore: ReturnType<typeof createGuideStoreBridge>;
  /** B-6 dismiss 追踪（bootcamp 桥自动 offer 抑制）。 */
  readonly dismissTracker: InMemoryGuideDismissTracker;
  /** F155 guide 生命周期服务。 */
  readonly lifecycle: GuideLifecycleService;
  /** F155 guide action 服务（start/cancel/preview/complete）。 */
  readonly actions: GuideActionService;
  /** F229 concierge 存储服务群（缺省内存 KV，宿主可注入持久后端）。 */
  readonly concierge: {
    /** per-user 前台猫配置（默认值 roster 解析）。 */
    configStore: KvConciergeConfigStore;
    /** per-user concierge thread 懒创建/获取（setNx claim + CAS-DEL）。 */
    threadService: ConciergeThreadService;
    /** relay 回执存储（draft → confirmed → dispatched | dispatch_failed）。 */
    relayStore: KvConciergeRelayStore;
    /** pending confirmation 存储（rendered → confirmed | cancelled）。 */
    confirmationStore: KvConciergeConfirmationStore;
    /** triage plan 存储（proposed → confirmed → dispatched → ...）。 */
    triagePlanStore: KvConciergeTriagePlanStore;
    /** investigation job 存储（queued → running → done | failed | cancelled）。 */
    investigationJobStore: KvConciergeInvestigationJobStore;
  };
  /** 注入的持久 KV（宿主可复用做其他 key）。 */
  readonly kv: ConciergeKeyValueStore;
  /** 线程元数据存储（缺省内存 stub）。 */
  readonly threadStore: IThreadStore;
  /** concierge 证据检索注入（可为空）。 */
  readonly evidenceStore: ConciergeEvidenceStore | undefined;
  /** thread 标题查询注入（可为空）。 */
  readonly threadLookup: ConciergeThreadTitleLookup | undefined;

  constructor(ctx: Context, options: GuidesServiceOptions = {}) {
    super(ctx, 'catsGuides');

    // 配置驱动（铁律5+P16）
    this.config = loadGuidesConfig(options.configPath);

    // F155 registry loader
    this.registry = options.registryPath
      ? new GuideRegistryLoader({ registryPath: options.registryPath })
      : new GuideRegistryLoader(loaderOptionsFromConfig(this.config));

    // F155 guide 状态存储
    this.sessionStore = new InMemoryGuideSessionStore();
    this.guideStore = createGuideStoreBridge(this.sessionStore);
    this.dismissTracker = new InMemoryGuideDismissTracker();

    // 线程元数据存储（缺省内存 stub）
    this.threadStore = options.threadStore ?? new InMemoryGuideThreadStore();

    // 持久 KV（缺省内存实现）
    this.kv = options.kv ?? new MemoryConciergeKeyValueStore();

    // F155 lifecycle/action 服务（socket/telemetry 回调注入）
    const log = {
      info: (...args: unknown[]) => this.ctx.logger.info('[cats-guides]', ...args),
      warn: (...args: unknown[]) => this.ctx.logger.warn('[cats-guides]', ...args),
    };
    const serviceDeps = {
      threadStore: this.threadStore,
      guideStore: this.guideStore,
      ...(options.emit ? { emit: options.emit } : {}),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      log,
      isValidGuideId: (id: string) => this.registry.isValidGuideId(id),
      loadGuideFlow: (id: string) => loadGuideFlowFrom(this.registry, id),
      ...(this.dismissTracker ? { dismissTracker: this.dismissTracker } : {}),
    };
    this.lifecycle = new GuideLifecycleService(serviceDeps);
    this.actions = new GuideActionService(serviceDeps);

    // F229 concierge 存储服务群
    const roster: RosterResolver = options.roster ?? (() => []);
    this.concierge = {
      configStore: new KvConciergeConfigStore(this.kv, roster),
      threadService: new ConciergeThreadService({
        threadStore: this.threadStore,
        kv: this.kv,
        conciergeConfigStore: new KvConciergeConfigStore(this.kv, roster),
      }),
      relayStore: new KvConciergeRelayStore(this.kv),
      confirmationStore: new KvConciergeConfirmationStore(this.kv),
      triagePlanStore: new KvConciergeTriagePlanStore(this.kv),
      investigationJobStore: new KvConciergeInvestigationJobStore(this.kv),
    };

    this.evidenceStore = options.evidenceStore;
    this.threadLookup = options.threadLookup;
  }
}

export default GuidesService;
