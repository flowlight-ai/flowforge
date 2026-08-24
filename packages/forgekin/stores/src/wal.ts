/**
 * @flowforge/forgekin-stores — F21 Side-Effect WAL（记忆写前日志）。
 *
 * TS 重写自 `core/reliability/wal.py` 的 spec（`tests/core/reliability/test_wal.py`，
 * P-79：Python 侧尚未实现，spec tests 先行；本插件按同一契约落地）：
 *   - append：写入一条 PENDING 记录，深拷贝 params（调用方后续修改不影响已存记录）
 *   - get：按 entry_id 读取；未知 id 抛 StoresError
 *   - mark_committed / mark_rolled_back：PENDING → COMMITTED / ROLLED_BACK 单向转移；
 *     非法转移（重复提交 / 已回滚再提交 / 未知 id）一律抛 StoresError
 *   - list_uncommitted：只返回 PENDING 记录（供崩溃恢复重放）
 *   - count：总条数（已 settle 的记录保留作审计，不删除）
 *
 * 铁律遵守（移植自 Python 原版注释）：
 *   - 铁律 4：不直接操作数据库，持久化由调用方注入 backend（见 collection.ts）
 *   - 状态机单向转移保证回放安全：已提交/已回滚的记录不可再变
 */

/** WAL 记录状态机：PENDING → COMMITTED / ROLLED_BACK（单向）。 */
export enum WalStatus {
  PENDING = 'PENDING',
  COMMITTED = 'COMMITTED',
  ROLLED_BACK = 'ROLLED_BACK',
}

/** WAL 记录 — 一次待执行副作用（写前日志项）。 */
export interface WalEntry {
  /** 记录唯一标识（UUID）。 */
  readonly entry_id: string;
  /** 动作名（如 publish_article / send_email）。 */
  readonly action: string;
  /** 目标（如 wechat:column-life / smtp:server-1）。 */
  readonly target: string;
  /** 动作参数（append 时深拷贝，之后与调用方对象完全隔离）。 */
  readonly params: Record<string, unknown>;
  /** 当前状态（PENDING / COMMITTED / ROLLED_BACK）。 */
  readonly status: WalStatus;
  /** 创建时间 ISO 8601。 */
  readonly created_at: string;
}

/** Stores 域错误 — WAL / 集合 / 治理共用（对齐 Python ReliabilityError 语义）。 */
export class StoresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoresError';
  }
}

/** 合法状态转移表：仅 PENDING 可转移到终态。 */
const ALLOWED_TRANSITIONS: Readonly<Record<WalStatus, readonly WalStatus[]>> = {
  [WalStatus.PENDING]: [WalStatus.COMMITTED, WalStatus.ROLLED_BACK],
  [WalStatus.COMMITTED]: [],
  [WalStatus.ROLLED_BACK]: [],
};

/**
 * Side-Effect Write-Ahead Log — 事件写前日志。
 *
 * 语义对齐 `tests/core/reliability/test_wal.py` 的 WriteAheadLog spec：
 * 记忆/副作用先落 PENDING 日志，副作用执行成功 mark_committed、
 * 失败 mark_rolled_back；崩溃后以 list_uncommitted 重放未完成项。
 */
export class WriteAheadLog {
  private readonly entries = new Map<string, WalEntry>();

  /**
   * 追加一条 PENDING 记录。
   *
   * @param action 动作名（非空）。
   * @param target 目标（非空）。
   * @param params 动作参数（深拷贝存储）。
   * @returns 新记录 id（UUID）。
   * @throws StoresError action/target 为空时。
   */
  async append(
    action: string,
    target: string,
    params: Record<string, unknown> = {},
  ): Promise<string> {
    if (action.length === 0) {
      throw new StoresError('WAL append: action must not be empty');
    }
    if (target.length === 0) {
      throw new StoresError('WAL append: target must not be empty');
    }
    const entry: WalEntry = {
      entry_id: crypto.randomUUID(),
      action,
      target,
      params: deepCopy(params),
      status: WalStatus.PENDING,
      created_at: new Date().toISOString(),
    };
    this.entries.set(entry.entry_id, entry);
    return entry.entry_id;
  }

  /**
   * 按 id 读取记录。
   *
   * @throws StoresError 记录不存在时。
   */
  async get(entry_id: string): Promise<WalEntry> {
    const entry = this.entries.get(entry_id);
    if (entry === undefined) {
      throw new StoresError(`WAL entry not found: ${entry_id}`);
    }
    return entry;
  }

  /**
   * 标记为已提交（PENDING → COMMITTED）。
   *
   * @throws StoresError 记录不存在或状态非法时。
   */
  async mark_committed(entry_id: string): Promise<void> {
    await this.transition(entry_id, WalStatus.COMMITTED);
  }

  /**
   * 标记为已回滚（PENDING → ROLLED_BACK）。
   *
   * @throws StoresError 记录不存在或状态非法时。
   */
  async mark_rolled_back(entry_id: string): Promise<void> {
    await this.transition(entry_id, WalStatus.ROLLED_BACK);
  }

  /**
   * 列出所有未提交（PENDING）记录 — 崩溃恢复重放入口。
   */
  async list_uncommitted(): Promise<WalEntry[]> {
    return [...this.entries.values()].filter(
      (e) => e.status === WalStatus.PENDING,
    );
  }

  /** 总记录数（含已 settle 项，保留作审计）。 */
  count(): number {
    return this.entries.size;
  }

  private async transition(entry_id: string, next: WalStatus): Promise<void> {
    const entry = this.entries.get(entry_id);
    if (entry === undefined) {
      throw new StoresError(`WAL entry not found: ${entry_id}`);
    }
    if (!ALLOWED_TRANSITIONS[entry.status].includes(next)) {
      throw new StoresError(
        `WAL illegal transition ${entry.status} -> ${next} for entry ${entry_id}`,
      );
    }
    this.entries.set(entry_id, { ...entry, status: next });
  }
}

/** 深拷贝参数对象（structuredClone，含嵌套结构）。 */
function deepCopy(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}
