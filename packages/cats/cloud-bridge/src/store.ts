import { CloudBridgeError } from './errors.ts'

export type CloudBridgeRecordStatus = 'dispatched' | 'bound' | 'failed'

export interface CloudBridgeRecord {
  invocationId: string
  threadId: string
  catId: string
  userId: string
  status: CloudBridgeRecordStatus
  dispatchedAt: number
  boundAt?: number
  boundSegmentCount?: number
  cloudInvocationId?: string
}

export interface ICloudBridgeStore {
  create(record: Omit<CloudBridgeRecord, 'status'> & { status?: CloudBridgeRecordStatus }): Promise<CloudBridgeRecord>
  get(invocationId: string): Promise<CloudBridgeRecord | null>
  markBound(invocationId: string, cloudInvocationId: string, boundSegmentCount: number, boundAt: number): Promise<CloudBridgeRecord | null>
  markFailed(invocationId: string, errorCode?: string, failedAt?: number): Promise<CloudBridgeRecord | null>
  listByStatus(status: CloudBridgeRecordStatus): Promise<CloudBridgeRecord[]>
}

export class MemoryCloudBridgeStore implements ICloudBridgeStore {
  private records = new Map<string, CloudBridgeRecord>()

  async create(record: Omit<CloudBridgeRecord, 'status'> & { status?: CloudBridgeRecordStatus }): Promise<CloudBridgeRecord> {
    if (this.records.has(record.invocationId)) {
      throw new CloudBridgeError('bridge_record_already_exists', 409)
    }
    const stored: CloudBridgeRecord = { ...record, status: record.status ?? 'dispatched' }
    this.records.set(stored.invocationId, stored)
    return clone(stored)
  }

  async get(invocationId: string): Promise<CloudBridgeRecord | null> {
    const record = this.records.get(invocationId)
    return record ? clone(record) : null
  }

  async markBound(invocationId: string, cloudInvocationId: string, boundSegmentCount: number, boundAt: number): Promise<CloudBridgeRecord | null> {
    return this.patch(invocationId, { status: 'bound', cloudInvocationId, boundSegmentCount, boundAt })
  }

  async markFailed(invocationId: string): Promise<CloudBridgeRecord | null> {
    return this.patch(invocationId, { status: 'failed' })
  }

  async listByStatus(status: CloudBridgeRecordStatus): Promise<CloudBridgeRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => record.status === status)
      .sort((a, b) => a.dispatchedAt - b.dispatchedAt)
      .map(clone)
  }

  private patch(invocationId: string, patch: Partial<CloudBridgeRecord>): CloudBridgeRecord | null {
    const existing = this.records.get(invocationId)
    if (!existing) return null
    const next: CloudBridgeRecord = { ...existing, ...patch }
    this.records.set(invocationId, next)
    return clone(next)
  }
}

function clone(record: CloudBridgeRecord): CloudBridgeRecord {
  return { ...record }
}