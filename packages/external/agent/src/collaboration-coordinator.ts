/**
 * @flowforge/external-agent collaboration-coordinator — 多 Agent 协作协调器。
 *
 * TS 重写自 flowforge/core/external_agent/collaboration_coordinator.py：
 *   - CollaborationMode: SYNC / ASYNC / SWARM
 *   - CollaborationResult / CollaborationHandle
 *   - CollaborationCoordinator: coordinate 骨架实现（立即 completed，
 *     不实际调度）/ cancel 标记状态 / _genHandleId = collab-{uuid8}
 */

/** 协作模式（collaboration_coordinator.py CollaborationMode）。 */
export enum CollaborationMode {
  /** 同步协作（等待全部完成）。 */
  SYNC = 'sync',
  /** 异步协作（后台调度）。 */
  ASYNC = 'async',
  /** 群体协作（swarm）。 */
  SWARM = 'swarm',
}

/** 协作结果（collaboration_coordinator.py CollaborationResult）。 */
export interface CollaborationResult {
  /** 协作句柄 ID。 */
  readonly handle_id: string;
  /** 协作模式。 */
  readonly mode: CollaborationMode;
  /** 参与的 Provider 列表。 */
  readonly providers: readonly string[];
  /** 状态（completed / cancelled）。 */
  readonly status: string;
  /** 结果（按 provider 索引）。 */
  readonly results: Record<string, unknown>;
}

/** 协作句柄（collaboration_coordinator.py CollaborationHandle）。 */
export interface CollaborationHandle {
  /** 句柄 ID（格式 collab-{uuid8}）。 */
  readonly handle_id: string;
  /** 协作模式。 */
  readonly mode: CollaborationMode;
  /** 参与的 Provider 列表。 */
  readonly providers: readonly string[];
  /** 当前状态。 */
  status: string;
  /** 取消请求标志。 */
  cancelled: boolean;
}

/** 多 Agent 协作协调器（collaboration_coordinator.py CollaborationCoordinator）。 */
export class CollaborationCoordinator {
  private readonly _handles = new Map<string, CollaborationHandle>();

  /**
   * 协调多 Agent 协作（骨架实现：立即 completed，不实际调度）。
   *
   * 实际实现应按 provider 逐个调度任务并汇总结果（SYNC 等待 /
   * ASYNC 后台 / SWARM 分组）。
   */
  async coordinate(
    mode: CollaborationMode,
    providers: readonly string[],
    _task: string,
    _context: Record<string, unknown> = {},
  ): Promise<CollaborationResult> {
    const handleId = this._genHandleId();
    const handle: CollaborationHandle = {
      handle_id: handleId,
      mode,
      providers: [...providers],
      status: 'completed',
      cancelled: false,
    };
    this._handles.set(handleId, handle);

    return {
      handle_id: handleId,
      mode,
      providers: [...providers],
      status: 'completed',
      results: {},
    };
  }

  /** 取消协作（标记状态为 cancelled）。 */
  cancel(handleId: string): boolean {
    const handle = this._handles.get(handleId);
    if (!handle) {
      return false;
    }
    handle.cancelled = true;
    handle.status = 'cancelled';
    return true;
  }

  /** 获取协作句柄。 */
  getHandle(handleId: string): CollaborationHandle | undefined {
    return this._handles.get(handleId);
  }

  /** 生成句柄 ID（collaboration_coordinator.py _gen_handle_id）。 */
  private _genHandleId(): string {
    return `collab-${random8()}`;
  }
}

/** 生成 8 位随机 hex（uuid8 语义）。 */
function random8(): string {
  return Math.random().toString(16).slice(2, 10);
}
