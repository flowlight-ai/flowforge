/**
 * 目标权威：将 host 目标句柄解析为私有 thread / channel 记录。
 * 忠实移植 clowder-ai `domains/signal-intake/DestinationAuthority.ts`。
 *
 * @flowforge/cats-signal-intake
 */

export type HostDestinationKind = 'private-thread' | 'channel'

export interface HostDestinationRecord {
  readonly handle: string
  readonly kind: HostDestinationKind
  readonly targetId: string
  readonly ownerId?: string
}

export interface DestinationAuthority {
  resolve(handle: string, ownerId: string): Promise<HostDestinationRecord | null>
}

export class MemoryDestinationAuthority implements DestinationAuthority {
  private readonly records = new Map<string, HostDestinationRecord>()

  put(record: HostDestinationRecord): void {
    this.records.set(record.handle, structuredClone(record))
  }

  async resolve(handle: string, ownerId: string): Promise<HostDestinationRecord | null> {
    const record = this.records.get(handle)
    if (record?.ownerId !== undefined && record.ownerId !== ownerId) return null
    return record ? structuredClone(record) : null
  }
}