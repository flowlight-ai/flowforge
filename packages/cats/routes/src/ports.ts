/**
 * cats routes 挂载层端口（批次55，C41/C22 语义 diff 残余）。
 *
 * 对齐 clowder-ai `routes/packs.ts` / `routes/backlog.ts` /
 * `routes/profile-update-decision-routes.ts` / `routes/memory-publish.ts` 的
 * 服务依赖面，收口为结构化端口——本包只做 HTTP 挂载翻译，业务全在已交付
 * 的 store/service（cats-packs / cats-stores / cats-profile / chat-misc）。
 *
 * @module @flowforge/cats-routes/ports
 */

import type { BacklogItem, CreateBacklogInput } from '@flowforge/cats-stores/ports'

/** PackLoader 结构化端口（cats-packs `PackLoader` 兼容）。 */
export interface PackLoaderPort {
  add(source: string): Promise<{ name: string } & Record<string, unknown>>;
  list(): Promise<Array<Record<string, unknown>>>;
  remove(name: string): Promise<boolean>;
}

/** Pack 导出端口（cats-packs `PackExporter` 兼容：cat-config → masks）。 */
export interface PackExporterPort {
  exportMasks(catConfig: {
    breeds: ReadonlyArray<{ catId: string }>;
    roster: Record<string, { available?: boolean } | undefined>;
  }): Array<Record<string, unknown>>;
}

/** 积压任务结构化端口（cats-stores `IBacklogStore` 兼容）。 */
export interface BacklogPort {
  create(input: CreateBacklogInput): BacklogItem | Promise<BacklogItem>;
  getById(id: string): BacklogItem | null | Promise<BacklogItem | null>;
  listForThread(threadId: string, options?: object): BacklogItem[] | Promise<BacklogItem[]>;
  /** 按用户列出（clowder GET /api/backlog/items 语义；适配器自行聚合）。 */
  listByUser(userId: string, limit?: number): Promise<object[]> | object[];
}

/** 自领策略读取端口（clowder backlog self-claim-policy GET）。 */
export interface SelfClaimPolicyPort {
  policy(): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** 档案更新提案结构化端口（cats-stores `IProfileUpdateProposalStore` 兼容）。 */
export interface ProfileUpdatePort {
  get(proposalId: string): Promise<object | null> | object | null;
  /** operator 审批/驳回（CAS pending → approving → approved / pending → rejected）。 */
  claimForApproval(proposalId: string, approvedBy: string): unknown | Promise<unknown>;
  finalizeApproval(proposalId: string): unknown | Promise<unknown>;
  markRejected(
    proposalId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ): unknown | Promise<unknown>;
}

/** 记忆发布结构化端口（chat-misc `ChatMemoryPublishService.publish` 兼容）。 */
export interface MemoryPublishPort {
  publish(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
