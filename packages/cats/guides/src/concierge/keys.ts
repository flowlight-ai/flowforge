/**
 * @flowforge/cats-guides — ConciergeKeys（F229，clowder concierge-keys.ts 直译）。
 *
 * Redis key 模式 → 插件化命名空间：无 Redis 时由注入的 KV store 使用相同 key
 * 字符串（ConciergeKeyValueStore 接口），缺省内存实现语义等价。
 *
 * TTL=0（铁律 5 LL-048：持久化，不设过期）。
 *
 * @module @flowforge/cats-guides/concierge/keys
 */

export const ConciergeKeys = {
  /** String (JSON): per-user ConciergeConfig */
  config: (userId: string) => `concierge:config:${userId}`,
  /** String: per-user concierge thread ID (懒创建，幂等) */
  threadId: (userId: string) => `concierge:thread:${userId}`,
  /** String (JSON): relay receipt by ID (TTL=0, INV R1/R4) */
  relay: (receiptId: string) => `concierge:relay:${receiptId}`,
  /** Set: per-user relay receipt IDs (for listing) */
  relayIndex: (userId: string) => `concierge:relay-idx:${userId}`,
  /** String (JSON): pending confirmation by ID (TTL=0, INV C3) */
  confirmation: (confirmationId: string) => `concierge:confirm:${confirmationId}`,
  /** Set: per-user confirmation IDs (for listing) */
  confirmationIndex: (userId: string) => `concierge:confirm-idx:${userId}`,
  /** String (JSON): triage plan by ID (TTL=0, INV T1) — Phase B */
  triagePlan: (planId: string) => `concierge:triage:${planId}`,
  /** Set: per-user triage plan IDs (for listing) — Phase B */
  triagePlanIndex: (userId: string) => `concierge:triage-idx:${userId}`,
  /** String (JSON): investigation job by ID (TTL=0, INV I1) — Phase B2 */
  investigationJob: (jobId: string) => `concierge:investigation:${jobId}`,
  /** String: triagePlanId → jobId lookup (1:1 relationship) — Phase B2 */
  investigationJobByPlan: (triagePlanId: string) => `concierge:investigation-plan:${triagePlanId}`,
  /** Set: per-user investigation job IDs (for listing) — Phase B2 */
  investigationJobIndex: (userId: string) => `concierge:investigation-idx:${userId}`,
} as const;
