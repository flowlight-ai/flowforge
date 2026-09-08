/**
 * 本地最小 Redis/KV seam：`SignalIntakeRedisClient` 接口 + 内存假实现 + Lua 常量。
 * 忠实移植 clowder-ai `@cat-cafe/shared/utils` RedisClient（eval/get/set NX·PX/
 * smembers/mget/sadd）；flowforge `@flowforge/infrastructure-redis-port` 的
 * `RedisLikeClient` 缺 string `set` 位，故本包以注入式 seam 本地最小化（仿 EP1-2）。
 * 真实 Redis 驱动绑定为 EP4 下游（见 design §6）。
 *
 * @flowforge/cats-signal-intake — redis/seam
 */

export interface SignalIntakeRedisSetOptions {
  readonly NX?: boolean
  readonly PX?: number
}

export interface SignalIntakeRedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: SignalIntakeRedisSetOptions): Promise<string | null>
  eval(script: string, numKeys: number, ...args: string[]): Promise<readonly string[] | number>
  smembers(key: string): Promise<string[]>
  mget(...keys: string[]): Promise<Array<string | null>>
  sadd(key: string, member: string): Promise<number>
  quit(): Promise<void> | void
}

/** Lua 脚本常量（与 clowder Redis stores 对齐；内存假实现按同一语义执行）。 */
export const SIGNAL_INTAKE_LUA = Object.freeze({
  accept: 'signal-intake:accept',
  casMeetingIntake: 'signal-intake:cas-meeting-intake',
  claimSourceGrant: 'signal-intake:claim-source-grant',
  revokeSourceGrant: 'signal-intake:revoke-source-grant',
} as const)

/** 内存假实现：以确定性内存 map 驱动三个 Redis store（契约测试用，禁 Mock）。 */
export class MemorySignalIntakeRedisClient implements SignalIntakeRedisClient {
  private readonly store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: string, options: SignalIntakeRedisSetOptions = {}): Promise<string | null> {
    if (options.NX && this.store.has(key)) return null
    this.store.set(key, value)
    return 'OK'
  }

  async eval(script: string, numKeys: number, ...args: string[]): Promise<readonly string[] | number> {
    const raw = args.slice(0, numKeys)
    const argv = args.slice(numKeys)
    if (script === SIGNAL_INTAKE_LUA.accept) return this.evalAccept(raw, argv)
    if (script === SIGNAL_INTAKE_LUA.casMeetingIntake) return this.evalCasMeetingIntake(raw, argv)
    if (script === SIGNAL_INTAKE_LUA.claimSourceGrant) return this.evalClaimSourceGrant(raw, argv)
    if (script === SIGNAL_INTAKE_LUA.revokeSourceGrant) return this.evalRevokeSourceGrant(raw)
    throw new Error(`unknown signal-intake lua script`)
  }

  async smembers(key: string): Promise<string[]> {
    const raw = this.store.get(this.setKey(key))
    return raw ? (JSON.parse(raw) as string[]) : []
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.store.get(key) ?? null)
  }

  async sadd(key: string, member: string): Promise<number> {
    const setKey = this.setKey(key)
    const members = new Set<string>(JSON.parse(this.store.get(setKey) ?? '[]') as string[])
    if (members.has(member)) return 0
    members.add(member)
    this.store.set(setKey, JSON.stringify([...members]))
    return 1
  }

  async quit(): Promise<void> {
    this.store.clear()
  }

  private setKey(key: string): string {
    return `${key}:set`
  }

  // ── Lua 语义（与 clowder 脚本一致）────────────────────────────────

  private async evalAccept(keys: readonly string[], argv: readonly string[]): Promise<readonly string[]> {
    const [settlementKey, sourceIdentityKey, intakeKey, pendingSetKey] = keys as [string, string, string, string]
    const settlementRaw = this.store.get(settlementKey)
    const canonicalDigest = argv[0] as string
    if (settlementRaw) {
      const decoded = JSON.parse(settlementRaw) as { canonicalDigest: string }
      if (decoded.canonicalDigest !== canonicalDigest) return ['idempotency_conflict']
      const intake = this.store.get(intakeKey)
      if (!intake) return ['corrupt']
      return ['duplicate', intake]
    }
    if (this.store.get(sourceIdentityKey) !== undefined) return ['source_identity_conflict']
    if (this.store.get(intakeKey) !== undefined) return ['intake_id_collision']
    const settlement = argv[1] as string
    const intakeId = argv[2] as string
    const serialized = argv[3] as string
    this.store.set(settlementKey, settlement)
    this.store.set(sourceIdentityKey, intakeId)
    this.store.set(intakeKey, serialized)
    await this.sadd(pendingSetKey, intakeId)
    return ['accepted', serialized]
  }

  private async evalCasMeetingIntake(keys: readonly string[], argv: readonly string[]): Promise<readonly string[]> {
    const [intakeKey] = keys as [string]
    const expectedRevision = argv[0] as string
    const next = argv[1] as string
    const current = this.store.get(intakeKey)
    if (current === undefined) return ['missing']
    const decoded = JSON.parse(current) as { revision: number }
    if (decoded.revision !== Number(expectedRevision)) return ['revision_conflict', current]
    this.store.set(intakeKey, next)
    return ['written', next]
  }

  private async evalClaimSourceGrant(keys: readonly string[], argv: readonly string[]): Promise<readonly string[]> {
    const [grantKey] = keys as [string]
    const [intakeId, principalId, purpose, now] = argv as [string, string, string, string]
    const raw = this.store.get(grantKey)
    if (raw === undefined) return ['not_found']
    const record = JSON.parse(raw) as {
      intakeId: string
      principalId: string
      purpose: string
      state: string
      expiresAt: number
    }
    if (record.intakeId !== intakeId || record.principalId !== principalId || record.purpose !== purpose) {
      return ['scope_mismatch']
    }
    if (record.state === 'revoked') return ['revoked']
    if (record.state === 'consumed') return ['consumed']
    if (record.expiresAt <= Number(now)) return ['expired']
    record.state = 'consumed'
    this.store.set(grantKey, JSON.stringify(record))
    return ['claimed', JSON.stringify(record)]
  }

  private async evalRevokeSourceGrant(keys: readonly string[]): Promise<number> {
    const [grantKey] = keys as [string]
    const raw = this.store.get(grantKey)
    if (raw === undefined) return 0
    const record = JSON.parse(raw) as { state: string }
    if (record.state !== 'issued') return 0
    record.state = 'revoked'
    this.store.set(grantKey, JSON.stringify(record))
    return 1
  }
}