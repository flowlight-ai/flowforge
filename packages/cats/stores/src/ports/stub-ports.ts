/**
 * Stub port interfaces for batch 2 — declared so the aggregate CatStores
 * has a single source of truth for all 29 cats-domain stores (5 core ports
 * with full Memory implementation live in sibling files; the 24 stub ports
 * below have method signatures deferred to incremental batches as their
 * dependent services land: cats-invocation, cats-orchestration, cats-profile).
 * Method shapes here are intentionally permissive (`Record<string, unknown>`)
 * to keep the contract honest about its stub status.
 *
 * The full contracts will be ported from clowder-ai
 * `packages/api/src/domains/cats/services/stores/ports/` as their dependent
 * services land (cats-invocation, cats-orchestration, cats-profile).
 *
 * @module @flowforge/cats-stores/ports
 */

/** Read-state cursor (per-user, per-thread). */
export interface IReadStateStore {
  markRead(userId: string, threadId: string, messageId: string, at: number): void | Promise<void>
  getReadCursor(userId: string, threadId: string): { messageId: string | null; at: number | null } | Promise<{ messageId: string | null; at: number | null }>
  listUnreadForUser(userId: string): ReadonlyArray<{ threadId: string; lastReadMessageId: string | null }> | Promise<ReadonlyArray<{ threadId: string; lastReadMessageId: string | null }>>
}

/** Per-thread label set. */
export interface ILabelStore {
  setLabels(threadId: string, labels: readonly string[]): void | Promise<void>
  getLabels(threadId: string): readonly string[] | Promise<readonly string[]>
  listThreadsByLabel(label: string): readonly string[] | Promise<readonly string[]>
}

/** Pending MCP callback requests awaiting approval. */
export interface IPendingRequestStore {
  enqueue(requestId: string, payload: Record<string, unknown>, ttlMs: number): void | Promise<void>
  claim(requestId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  expire(now?: number): number | Promise<number>
}

/** Cross-cat proposals (F-suggested cross-thread coordination). */
export interface IProposalStore {
  create(proposal: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForThread(threadId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  delete(id: string): boolean | Promise<boolean>
}

/** Push subscription registration. */
export interface IPushSubscriptionStore {
  register(userId: string, subscription: Record<string, unknown>): void | Promise<void>
  unregister(userId: string, endpoint: string): void | Promise<void>
  listForUser(userId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Authorization audit log (per-cat-per-action). */
export interface IAuthorizationAuditStore {
  append(entry: Record<string, unknown>): void | Promise<void>
  listForCat(catId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Authorization rules (rule-based cat capability gating). */
export interface IAuthorizationRuleStore {
  setRule(ruleId: string, rule: Record<string, unknown>): void | Promise<void>
  getRule(ruleId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listAll(): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  deleteRule(ruleId: string): boolean | Promise<boolean>
}

/** Community issue store (open-source community integration). */
export interface ICommunityIssueStore {
  create(issue: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForRepo(repo: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Community issue draft store. */
export interface ICommunityIssueDraftStore {
  create(draft: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForUser(userId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  delete(id: string): boolean | Promise<boolean>
}

/** Community PR store. */
export interface ICommunityPrStore {
  create(pr: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForRepo(repo: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Frustration issue store (F143). */
export interface IFrustrationIssueStore {
  create(issue: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForCat(catId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  resolve(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Dossier distillation proposal store. */
export interface IDossierDistillationProposalStore {
  create(proposal: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForCat(catId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  approve(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  reject(id: string, reason: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Dossier observation store. */
export interface IDossierObservationStore {
  record(observation: Record<string, unknown>): void | Promise<void>
  listForCat(catId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Delivery cursor store (per-thread delivery position). */
export interface IDeliveryCursorStore {
  set(threadId: string, userId: string, cursor: string): void | Promise<void>
  get(threadId: string, userId: string): string | null | Promise<string | null>
}

/** Game store (game state). */
export interface IGameStore {
  create(game: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  delete(id: string): boolean | Promise<boolean>
}

/** Memory governance store (memory access audit). */
export interface IMemoryGovernanceStore {
  record(entry: Record<string, unknown>): void | Promise<void>
  listForCat(catId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Profile update proposal store. */
export interface IProfileUpdateProposalStore {
  create(proposal: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForCat(catId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  approve(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  reject(id: string, reason: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Session handoff proposal store. */
export interface ISessionHandoffProposalStore {
  create(proposal: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
  getById(id: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForThread(threadId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  update(id: string, patch: Record<string, unknown>): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

/** Workflow SOP store. */
export interface IWorkflowSopStore {
  register(sopId: string, sop: Record<string, unknown>): void | Promise<void>
  getSop(sopId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listAll(): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  unregister(sopId: string): boolean | Promise<boolean>
}

/** Session chain store (per-cat session lineage for handoff). */
export interface ISessionChainStore {
  append(chainId: string, entry: Record<string, unknown>): void | Promise<void>
  getChain(chainId: string): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  listChainsForCat(catId: string): readonly string[] | Promise<readonly string[]>
}

/** Draft store (per-thread unsent draft). */
export interface IDraftStore {
  set(threadId: string, userId: string, draft: Record<string, unknown>): void | Promise<void>
  get(threadId: string, userId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  clear(threadId: string, userId: string): boolean | Promise<boolean>
}

/** Summary store (per-thread auto-summary). */
export interface ISummaryStore {
  set(threadId: string, summary: Record<string, unknown>): void | Promise<void>
  get(threadId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listRecent(limit?: number): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Turn execution store (per-cat-turn execution metadata). */
export interface ITurnExecutionStore {
  record(turnId: string, entry: Record<string, unknown>): void | Promise<void>
  getTurn(turnId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listTurnsForThread(threadId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}

/** Invocation record store (per-invocation audit + outcome). */
export interface IInvocationRecordStore {
  record(invocationId: string, entry: Record<string, unknown>): void | Promise<void>
  getInvocation(invocationId: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>
  listForThread(threadId: string, options?: { readonly limit?: number }): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
}
