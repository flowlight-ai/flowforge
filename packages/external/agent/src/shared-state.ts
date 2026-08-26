/**
 * @flowforge/external-agent shared-state — F33 外部 Agent 共享状态（EX-004）。
 *
 * TS 重写自 flowforge/core/external_agent/shared_state.py：
 *   - SharedStateStore Protocol（DI 注入点）：read / write / list_keys
 *   - SharedStateEntry: forgekin_id / provider_name / key / value / timestamp /
 *     decision_context
 *   - ExternalAgentSharedState: write / read / listHistory / clear
 */

/** 共享状态存储后端协议（shared_state.py SharedStateStore）。 */
export interface SharedStateStore {
  /** 读取某 Forgekin 的某个 key（无则返回 undefined）。 */
  read(forgekinId: string, key: string): Promise<unknown>;
  /** 写入某 Forgekin 的某个 key。 */
  write(forgekinId: string, key: string, value: unknown): Promise<void>;
  /** 列出某 Forgekin 的全部 key。 */
  listKeys(forgekinId: string): Promise<string[]>;
}

/** 共享状态条目（shared_state.py SharedStateEntry）。 */
export interface SharedStateEntry {
  /** Forgekin ID。 */
  readonly forgekin_id: string;
  /** Provider 名称（可为空）。 */
  readonly provider_name: string;
  /** 状态 key。 */
  readonly key: string;
  /** 状态值。 */
  readonly value: unknown;
  /** 写入时间戳（ISO 8601）。 */
  readonly timestamp: string;
  /** 决策上下文（调用方附加）。 */
  readonly decision_context?: Record<string, unknown>;
}

/** 外部 Agent 共享状态（shared_state.py ExternalAgentSharedState）。 */
export class ExternalAgentSharedState {
  private readonly _store: SharedStateStore;
  /** 内存条目索引（forgekin_id -> entries，供 listHistory 排序）。 */
  private readonly _entries = new Map<string, SharedStateEntry[]>();

  constructor(store: SharedStateStore) {
    this._store = store;
  }

  /**
   * 写入共享状态（EX-004）。
   *
   * @param forgekinId Forgekin ID。
   * @param key 状态 key（如 task_result/2026-08-26T00:00:00Z）。
   * @param value 状态值。
   * @param providerName Provider 名称（可为空）。
   * @param decisionContext 决策上下文（调用方附加）。
   */
  async write(
    forgekinId: string,
    key: string,
    value: unknown,
    providerName = '',
    decisionContext?: Record<string, unknown>,
  ): Promise<void> {
    const entry: SharedStateEntry = {
      forgekin_id: forgekinId,
      provider_name: providerName,
      key,
      value,
      timestamp: new Date().toISOString(),
      ...(decisionContext !== undefined ? { decision_context: decisionContext } : {}),
    };
    const entries = this._entries.get(forgekinId) ?? [];
    entries.push(entry);
    this._entries.set(forgekinId, entries);
    await this._store.write(forgekinId, key, value);
  }

  /** 读取共享状态（透传 store）。 */
  async read(forgekinId: string, key: string): Promise<unknown> {
    return this._store.read(forgekinId, key);
  }

  /** 列出某 Forgekin 的历史条目（按 timestamp 升序）。 */
  async listHistory(forgekinId: string): Promise<SharedStateEntry[]> {
    const entries = this._entries.get(forgekinId) ?? [];
    return [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** 清除某 Forgekin 的共享状态（置空索引）。 */
  clear(forgekinId: string): void {
    this._entries.delete(forgekinId);
  }

  /** 列出某 Forgekin 的全部 key（透传 store）。 */
  async listKeys(forgekinId: string): Promise<string[]> {
    return this._store.listKeys(forgekinId);
  }
}
