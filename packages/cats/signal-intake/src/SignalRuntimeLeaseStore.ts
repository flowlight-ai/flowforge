/**
 * 信号运行时租约存储：授权插件实例的 Broker 会话租约。
 * 忠实移植 clowder-ai `domains/signal-intake/SignalRuntimeLeaseStore.ts`。
 *
 * @flowforge/cats-signal-intake
 */

export type SignalRuntimeLeaseState = 'live' | 'expired' | 'revoked' | 'closed'

export interface SignalRuntimeLeaseRecord {
  readonly leaseId: string
  readonly sessionId: string
  readonly pluginInstanceId: string
  readonly packageDigest: string
  readonly grantRevision: number
  readonly state: SignalRuntimeLeaseState
  readonly expiresAt: number
}

export interface SignalRuntimeLeaseStore {
  get(leaseId: string): Promise<SignalRuntimeLeaseRecord | null>
}

export class MemorySignalRuntimeLeaseStore implements SignalRuntimeLeaseStore {
  private readonly records = new Map<string, SignalRuntimeLeaseRecord>()

  async get(leaseId: string): Promise<SignalRuntimeLeaseRecord | null> {
    const record = this.records.get(leaseId)
    return record ? structuredClone(record) : null
  }

  put(record: SignalRuntimeLeaseRecord): void {
    this.records.set(record.leaseId, structuredClone(record))
  }
}