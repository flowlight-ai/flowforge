/**
 * @flowforge/forgekin-relationship — 阶段7 F37 ForgeMind 锻造关系域 Cordis 插件
 *
 * 挂载 `ctx.forgeRelationship`：forgemind 与 *Forge 关系（F036）——
 * ForgeLayer 动态承载层注册 + ForgeRelationship 跨层血缘 +
 * ForgeRelationshipManager 进化/回炉协议（Eval ≥ 0.85 + 5+ 任务 +
 * operator 审批；回炉仅蒸馏通用能力）。
 *
 * TS 移植自 `docs/features/F036-forgemind-forge-relationship.md`
 * （Python 侧无对应实现文件，按 Feature 文档直接建模）。
 * 一切皆插件：垂直承载层由 *Forge 业务项目通过 registerLayer 动态注册，
 * 核心层不硬编码具体 *Forge 项目名（F036 设计原则）。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  ForgeRelationshipManager,
  type ForgeRelationshipManagerOptions,
} from './manager.js';

export * from './config.js';
export * from './models.js';
export * from './manager.js';

export interface RelationshipServiceOptions extends ForgeRelationshipManagerOptions {}

declare module '@flowforge/cordis' {
  interface Context {
    /** 锻造关系域：通用 ↔ 垂直 双向流通（进化/回炉/血缘追踪） */
    forgeRelationship: RelationshipService;
  }
}

export class RelationshipService extends Service {
  /** Forge Relationship 管理器（承载层注册表 + 关系表 + 迁移执行） */
  readonly manager: ForgeRelationshipManager;

  constructor(ctx: Context, options: RelationshipServiceOptions = {}) {
    super(ctx, 'forgeRelationship');
    this.manager = new ForgeRelationshipManager(options);
  }

  // ── 层注册（插件扩展点）──────────────────────────────────────────

  /** 注册承载层（*Forge 插件注册垂直层；自动加入通用层 can_evolve_to） */
  registerLayer(layer: Parameters<ForgeRelationshipManager['registerLayer']>[0]): void {
    this.manager.registerLayer(layer);
  }

  /** 按 ID 查询承载层（不存在抛错） */
  getLayer(layerId: string): ReturnType<ForgeRelationshipManager['getLayer']> {
    return this.manager.getLayer(layerId);
  }

  /** 列出全部承载层 */
  listLayers(): ReturnType<ForgeRelationshipManager['listLayers']> {
    return this.manager.listLayers();
  }

  // ── 关系与迁移（F036 核心协议）──────────────────────────────────

  /** 为新生 Forgekin 建立出生关系（锻造流水线联动） */
  initRelationship(
    forgekinId: string,
    capabilityProfile: Record<string, unknown>,
    originLayerId?: string,
  ) {
    return this.manager.initRelationship(forgekinId, capabilityProfile, originLayerId);
  }

  /** 查询 Forgekin 跨层关系（不存在抛错） */
  getRelationship(forgekinId: string) {
    return this.manager.getRelationship(forgekinId);
  }

  /** 通用 → 垂直（进化请求，需 Eval ≥ 0.85 + 5+ 任务 + operator 批准） */
  requestEvolveToVertical(
    forgekinId: string,
    targetLayerId: string,
    reason: string,
    evidence: Parameters<ForgeRelationshipManager['requestEvolveToVertical']>[3],
  ): string {
    return this.manager.requestEvolveToVertical(forgekinId, targetLayerId, reason, evidence);
  }

  /** 垂直 → 通用（回炉请求，仅蒸馏通用能力） */
  requestReclaimToForgemind(
    forgekinId: string,
    reason: string,
    evidence: Parameters<ForgeRelationshipManager['requestReclaimToForgemind']>[2],
  ): string {
    return this.manager.requestReclaimToForgemind(forgekinId, reason, evidence);
  }

  /** 执行 pending 迁移（幂等） */
  executeTransition(transitionId: string) {
    return this.manager.executeTransition(transitionId);
  }

  /** 列出某 Forgekin 的跨层迁移历史（血缘追踪） */
  listTransitions(forgekinId: string) {
    return this.manager.listTransitions(forgekinId);
  }
}

export default function Plugin(ctx: Context, options?: RelationshipServiceOptions) {
  return ctx.plugin(RelationshipService, options);
}
