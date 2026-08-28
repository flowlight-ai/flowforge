/**
 * @flowforge/cats-taste — TasteProposal store key 模式（F221 Phase B）。
 *
 * TS 移植自 clowder-ai `domains/taste/stores/redis-keys/taste-proposal-keys.ts`。
 * 保留供 KV 后端（Redis/sqlite）复用；内存 store 不消费。
 *
 * @module @flowforge/cats-taste/keys
 */

export const TasteProposalKeys = {
  detail: (id: string) => `taste-proposal:${id}`,
  userPending: (userId: string) => `taste-proposal-user-pending:${userId}`,
  userSettled: (userId: string) => `taste-proposal-user-settled:${userId}`,
  dedup: (userId: string, clientRequestId: string) => `taste-proposal-dedup:${userId}::${clientRequestId}`,
} as const;
