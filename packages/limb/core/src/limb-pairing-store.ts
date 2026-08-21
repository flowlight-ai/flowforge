/**
 * LimbPairingStore — F126 Phase C 设备配对审批
 *
 * 远程节点注册后进入 pending 状态，需要 co-creator 审批后才能接入。
 * 审批通过 → 生成 RemoteLimbNode → 注册到 LimbRegistry。
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { LimbCapability } from './types.js';

export interface PairingRequest {
  requestId: string;
  nodeId: string;
  displayName: string;
  platform: string;
  endpointUrl: string;
  capabilities: LimbCapability[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt?: number;
  /** User who explicitly approved this physical node. Never inferred from registration. */
  approvedByUserId?: string;
  /** Generated token for the remote node to authenticate heartbeats/deregister */
  apiKey: string;
}

export interface CreatePairingParams {
  nodeId: string;
  displayName: string;
  platform: string;
  endpointUrl: string;
  capabilities: LimbCapability[];
}

export interface ApprovedLimbPairingPersistence {
  list(): Promise<PairingRequest[]>;
  put(pairing: PairingRequest): Promise<void>;
  remove(nodeId: string): Promise<void>;
}

export class LimbPairingOwnershipConflictError extends Error {
  constructor() {
    super('Limb is already approved by a different user');
    this.name = 'LimbPairingOwnershipConflictError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isApprovedPairing(value: unknown): value is PairingRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.requestId) ||
    !isNonEmptyString(candidate.nodeId) ||
    !isNonEmptyString(candidate.displayName) ||
    !isNonEmptyString(candidate.platform) ||
    !isNonEmptyString(candidate.endpointUrl) ||
    candidate.status !== 'approved' ||
    !Number.isSafeInteger(candidate.createdAt) ||
    (candidate.createdAt as number) < 0 ||
    !Number.isSafeInteger(candidate.decidedAt) ||
    (candidate.decidedAt as number) < (candidate.createdAt as number) ||
    !isNonEmptyString(candidate.approvedByUserId) ||
    !isNonEmptyString(candidate.apiKey) ||
    !Array.isArray(candidate.capabilities)
  ) {
    return false;
  }

  return candidate.capabilities.every((capability) => {
    if (typeof capability !== 'object' || capability === null || Array.isArray(capability)) return false;
    const item = capability as Record<string, unknown>;
    return (
      isNonEmptyString(item.cap) &&
      Array.isArray(item.commands) &&
      item.commands.every(isNonEmptyString) &&
      (item.authLevel === 'free' || item.authLevel === 'leased' || item.authLevel === 'gated')
    );
  });
}

function assertApprovedPairing(pairing: PairingRequest): void {
  if (!isApprovedPairing(pairing)) {
    throw new TypeError('Invalid approved limb pairing record');
  }
}

/** 内存持久化 — 组合根可注入 Sqlite 后端替换 */
export class MemoryApprovedLimbPairingPersistence implements ApprovedLimbPairingPersistence {
  private readonly pairings = new Map<string, PairingRequest>();

  async list(): Promise<PairingRequest[]> {
    return [...this.pairings.values()].map((pairing) => structuredClone(pairing));
  }

  async put(pairing: PairingRequest): Promise<void> {
    assertApprovedPairing(pairing);
    this.pairings.set(pairing.nodeId, structuredClone(pairing));
  }

  async remove(nodeId: string): Promise<void> {
    this.pairings.delete(nodeId);
  }
}

/** Redis 后端最小接口（组合根注入真实 redis 客户端） */
export interface RedisHashLike {
  hvals(key: string): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
}

const APPROVED_PAIRINGS_KEY = 'limb:pairing:approved:v1';

/** Redis 持久化 — hash 表按 nodeId 字段存储已批准配对 */
export class RedisApprovedLimbPairingPersistence implements ApprovedLimbPairingPersistence {
  constructor(private readonly redis: RedisHashLike) {}

  async list(): Promise<PairingRequest[]> {
    const records = await this.redis.hvals(APPROVED_PAIRINGS_KEY);
    return records.map((raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TypeError('Corrupt approved limb pairing record');
      }
      if (!isApprovedPairing(parsed)) {
        throw new TypeError('Corrupt approved limb pairing record');
      }
      return structuredClone(parsed);
    });
  }

  async put(pairing: PairingRequest): Promise<void> {
    assertApprovedPairing(pairing);
    // User-visible ownership state is intentionally persistent: no EX/PX.
    await this.redis.hset(APPROVED_PAIRINGS_KEY, pairing.nodeId, JSON.stringify(pairing));
  }

  async remove(nodeId: string): Promise<void> {
    await this.redis.hdel(APPROVED_PAIRINGS_KEY, nodeId);
  }
}

export const ApprovedLimbPairingRedisKeys = {
  approved: APPROVED_PAIRINGS_KEY,
} as const;

export class LimbPairingStore {
  private readonly requests = new Map<string, PairingRequest>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly persistence?: ApprovedLimbPairingPersistence) {}

  static async restore(persistence: ApprovedLimbPairingPersistence): Promise<LimbPairingStore> {
    const store = new LimbPairingStore(persistence);
    const approved = await persistence.list();
    const nodeIds = new Set<string>();
    for (const request of approved) {
      if (request.status !== 'approved' || !request.approvedByUserId) {
        throw new TypeError('Invalid approved limb pairing record');
      }
      if (nodeIds.has(request.nodeId) || store.requests.has(request.requestId)) {
        throw new TypeError('Duplicate approved limb pairing record');
      }
      nodeIds.add(request.nodeId);
      store.requests.set(request.requestId, structuredClone(request));
    }
    return store;
  }

  createRequest(params: CreatePairingParams): PairingRequest {
    // Check for duplicate nodeId in pending/approved
    for (const req of this.requests.values()) {
      if (req.nodeId === params.nodeId && req.status !== 'rejected') {
        return structuredClone(req); // Idempotent: return existing
      }
    }

    const request: PairingRequest = {
      requestId: randomUUID(),
      ...params,
      status: 'pending',
      createdAt: Date.now(),
      apiKey: randomUUID(),
    };

    this.requests.set(request.requestId, request);
    return structuredClone(request);
  }

  async approve(requestId: string, userId: string): Promise<PairingRequest | null> {
    return this.runMutation(async () => {
      if (userId.length === 0) throw new TypeError('Approving user is required');
      const req = this.requests.get(requestId);
      if (!req) return null;
      if (req.status === 'approved') {
        if (req.approvedByUserId !== userId) {
          throw new LimbPairingOwnershipConflictError();
        }
        return structuredClone(req); // Idempotent for the same owner.
      }
      const approved: PairingRequest = {
        ...structuredClone(req),
        status: 'approved',
        decidedAt: Date.now(),
        approvedByUserId: userId,
      };
      await this.persistence?.put(approved);
      this.requests.set(requestId, approved);
      return structuredClone(approved);
    });
  }

  reject(requestId: string): boolean {
    const req = this.requests.get(requestId);
    if (!req || req.status === 'approved') return false;
    req.status = 'rejected';
    req.decidedAt = Date.now();
    return true;
  }

  getPending(): PairingRequest[] {
    return [...this.requests.values()].filter((r) => r.status === 'pending').map((request) => structuredClone(request));
  }

  getApproved(): PairingRequest[] {
    return [...this.requests.values()]
      .filter((r) => r.status === 'approved')
      .map((request) => structuredClone(request));
  }

  findByApiKey(apiKey: string): PairingRequest | undefined {
    const found = [...this.requests.values()].find(
      (request) => request.status === 'approved' && secretsEqual(request.apiKey, apiKey),
    );
    return found ? structuredClone(found) : undefined;
  }

  findApprovedByNodeId(nodeId: string): PairingRequest | undefined {
    const found = [...this.requests.values()].find(
      (request) => request.nodeId === nodeId && request.status === 'approved',
    );
    return found ? structuredClone(found) : undefined;
  }

  async updateApprovedEndpoint(nodeId: string, endpointUrl: string): Promise<PairingRequest | undefined> {
    return this.runMutation(async () => {
      const current = [...this.requests.values()].find(
        (request) => request.nodeId === nodeId && request.status === 'approved',
      );
      if (!current) return undefined;
      const updated = { ...structuredClone(current), endpointUrl };
      await this.persistence?.put(updated);
      this.requests.set(updated.requestId, updated);
      return structuredClone(updated);
    });
  }

  get(requestId: string): PairingRequest | undefined {
    const request = this.requests.get(requestId);
    return request ? structuredClone(request) : undefined;
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function secretsEqual(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
