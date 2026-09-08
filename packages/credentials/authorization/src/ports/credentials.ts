/**
 * 凭据记载端口（AuthorizationCredentialsPort）+ 真实内存实现（MemoryCredentialsStore）。
 *
 * 移植来源：dsh 中 `AuthorizationService` 依赖的 `ctx.credentials` 子面
 * （`describeRecord`、`'credentials/record-updated'` 事件）以及 `dsh-credentials`
 * 的 `CredentialKey`。原本这些是 cordis 服务，按任务铁律（T9）一律转为包内 seam：
 * 端口接口 + 真实内存实现，供契约测试直接装配，禁用 vi.mock。内存实现以 key 为
 * 单位持有记录，变更时以同步回调广播 `record-updated`（与 cordis emit 语义对齐），
 * 以便 `AuthorizationService.attempt` 观察本次尝试内的提交。
 *
 * @module @flowforge/credentials-authorization/ports/credentials
 */

import type { CredentialKey } from '../types.ts'

/** 一条记录的公开描述，绝不携带其值。 */
export interface CredentialRecordInfo {
  /** 记录是否已被配置（已提交持久值）。 */
  configured: boolean
}

/**
 * 凭据记载端口：一次尝试提交/持久化、以及观察“记录已更新”所需的最小 surface。
 * `describeRecord` 供提交确认后的复查；`onRecordUpdated` 供尝试期间观察提交。
 */
export interface AuthorizationCredentialsPort {
  /**
   * 描述一条记录而不暴露其值。
   * @param key - 待描述的记录。
   * @returns 配置状态等事实。
   */
  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>
  /**
   * 订阅 `record-updated`：某条记录发生已提交变更（写入或删除）。
   * @param listener - 变更后回调，携带发生变更的记录 key。
   * @returns 卸载订阅的清理器。
   */
  onRecordUpdated(listener: (key: CredentialKey) => void): () => void
}

/**
 * 真实内存凭据存储：契约测试底座与无宿主装配。记录写入/删除即时广播
 * `record-updated`——提交（commit）与移除（remove）两入口分别对应用户在
 * 真实凭据层写入与删除记录。
 */
export class MemoryCredentialsStore implements AuthorizationCredentialsPort {
  /** 已配置的记录集合（存在即视为已配置）。 */
  private readonly records = new Set<CredentialKey>()
  /** 当前 `record-updated` 订阅者集合。 */
  private readonly observers = new Set<(key: CredentialKey) => void>()

  /**
   * 描述一条记录。
   * @param key - 待描述的记录。
   * @returns `configured` 即当前集合中是否存在该记录。
   */
  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: this.records.has(key) })
  }

  /**
   * 订阅记录变更。
   * @param listener - 变更回调。
   * @returns 卸载订阅的清理器。
   */
  onRecordUpdated(listener: (key: CredentialKey) => void): () => void {
    this.observers.add(listener)
    return () => { this.observers.delete(listener) }
  }

  /**
   * 提交（配置）一条记录，并广播 `record-updated`。每次写入都广播（无论是否
   * 已存在）：对应 dsh `credentials/record-updated` 的“本次尝试内发生的提交”语义，
   * 让一次重新授权（re-auth）里“记录本已存在、但仍被重新写入”的提交可被观察到——
   * seam 确认的是一次*此刻发生*的写入，而不是记录的存在性。
   * @param key - 待提交的记录。
   */
  commit(key: CredentialKey): void {
    this.records.add(key)
    this.observers.forEach(listener => listener(key))
  }

  /**
   * 移除（删除）一条记录，并广播 `record-updated`。对应 flow 提交后又被删
   * 除记录的行为；移除不存在的记录是 no-op，不广播。
   * @param key - 待移除的记录。
   */
  remove(key: CredentialKey): void {
    const changed = this.records.delete(key)
    if (changed) this.observers.forEach(listener => listener(key))
  }

  /** 当前已配置记录数（供测试与装配诊断）。 */
  countConfigured(): number {
    return this.records.size
  }
}

/** 便捷构造一个内存凭据存储。 */
export function createMemoryCredentials(): MemoryCredentialsStore {
  return new MemoryCredentialsStore()
}

export default MemoryCredentialsStore