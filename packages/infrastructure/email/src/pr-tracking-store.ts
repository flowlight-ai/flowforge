/**
 * PR Tracking Store — 类型 / key 模式 / 内存实现（C33）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/PrTrackingStore.ts` +
 * `pr-tracking-keys.ts`。Redis 后端见 `./redis-pr-tracking-store.ts`
 * （经注入式 RedisLikeClient 端口，不绑定驱动）。
 *
 * @module @flowforge/infrastructure-email/pr-tracking-store
 */

export interface PrTrackingEntry {
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly catId: string;
  readonly threadId: string;
  readonly userId: string;
  readonly registeredAt: number;
  // F133: CI/CD state fields（首次 CI 轮询前缺席）
  readonly headSha?: string;
  readonly lastCiFingerprint?: string;
  readonly lastCiBucket?: string;
  readonly lastCiNotifiedAt?: number;
  readonly ciTrackingEnabled?: boolean;
  // F140: Conflict state fields（首次冲突检查前缺席）
  readonly lastConflictFingerprint?: string;
  readonly lastConflictNotifiedAt?: number;
  readonly mergeState?: string;
}

export type PrTrackingInput = Omit<PrTrackingEntry, 'registeredAt'>;

/** CI state fields for partial update via patchCiState()（KD-7：不动 registeredAt）。 */
export interface CiStateFields {
  headSha?: string;
  lastCiFingerprint?: string;
  lastCiBucket?: string;
  lastCiNotifiedAt?: number;
  ciTrackingEnabled?: boolean;
}

/** F140: Conflict state fields（KD-12：与 CI 状态域独立）。 */
export interface ConflictStateFields {
  lastConflictFingerprint?: string;
  lastConflictNotifiedAt?: number;
  mergeState?: string;
}

export interface IPrTrackingStore {
  register(input: PrTrackingInput): PrTrackingEntry | Promise<PrTrackingEntry>;
  get(repoFullName: string, prNumber: number): PrTrackingEntry | null | Promise<PrTrackingEntry | null>;
  remove(repoFullName: string, prNumber: number): boolean | Promise<boolean>;
  listAll(): PrTrackingEntry[] | Promise<PrTrackingEntry[]>;
  patchCiState(repoFullName: string, prNumber: number, ciFields: CiStateFields): void | Promise<void>;
  patchConflictState(repoFullName: string, prNumber: number, conflictFields: ConflictStateFields): void | Promise<void>;
}

/** Redis key patterns（RedisPrTrackingStore 随持久化加固再补）。 */
export const PrTrackingKeys = {
  detail: (repoFullName: string, prNumber: number) => `pr-tracking:${repoFullName}#${prNumber}`,
  all: () => 'pr-tracking:all',
} as const;

function makeKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

/** In-memory implementation of PrTrackingStore. */
export class MemoryPrTrackingStore implements IPrTrackingStore {
  private readonly entries = new Map<string, PrTrackingEntry>();

  register(input: PrTrackingInput): PrTrackingEntry {
    const entry: PrTrackingEntry = { ...input, registeredAt: Date.now() };
    this.entries.set(makeKey(input.repoFullName, input.prNumber), entry);
    return entry;
  }

  get(repoFullName: string, prNumber: number): PrTrackingEntry | null {
    return this.entries.get(makeKey(repoFullName, prNumber)) ?? null;
  }

  remove(repoFullName: string, prNumber: number): boolean {
    return this.entries.delete(makeKey(repoFullName, prNumber));
  }

  listAll(): PrTrackingEntry[] {
    return [...this.entries.values()].sort((a, b) => b.registeredAt - a.registeredAt);
  }

  patchCiState(repoFullName: string, prNumber: number, ciFields: CiStateFields): void {
    const key = makeKey(repoFullName, prNumber);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ...existing, ...ciFields });
  }

  patchConflictState(repoFullName: string, prNumber: number, conflictFields: ConflictStateFields): void {
    const key = makeKey(repoFullName, prNumber);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ...existing, ...conflictFields });
  }
}
