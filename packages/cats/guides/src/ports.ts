/**
 * @flowforge/cats-guides — 端口接口（插件化注入点，dhs 模式）。
 *
 * clowder 原版强依赖：ThreadStore（1437 行）/ SocketManager / telemetry instruments /
 * RedisClient / catRegistry。Cordis 插件化改造：
 *   - IThreadStore 裁剪为 guides/concierge 实际使用的最小接口（get/create/
 *     updatePreferredCats/updateThreadKind/softDelete/getParticipants）
 *   - socket.emitToUser → GuideEmitFn 回调（默认 no-op，宿主注入）
 *   - guideTransitions.add → TelemetryFn 回调（默认 no-op）
 *   - RedisClient / catRegistry → 可选注入（缺省用内存实现/空 roster）
 *
 * @module @flowforge/cats-guides/ports
 */

// ---------------------------------------------------------------------------
// Thread 最小形状（access control 所需字段）
// ---------------------------------------------------------------------------

/** GuideThreadAccess — guide/concierge 访问控制所需 thread 最小形状。 */
export interface GuideThreadAccess {
  id: string;
  createdBy: string;
}

/** ConciergeThread — ConciergeThreadService 所需 thread 字段。 */
export interface ConciergeThreadRecord {
  id: string;
  title?: string | null;
  deletedAt?: number | null;
  threadKind?: string | null;
  createdBy: string;
}

/** 最小线程存储接口（宿主 ThreadStore 适配注入）。 */
export interface IThreadStore {
  get(threadId: string): ConciergeThreadRecord | null | Promise<ConciergeThreadRecord | null>;
  create(userId: string, title?: string, projectPath?: string): ConciergeThreadRecord | Promise<ConciergeThreadRecord>;
  updatePreferredCats(threadId: string, catIds: string[]): void | Promise<void>;
  updateThreadKind?(threadId: string, kind: string): void | Promise<void>;
  softDelete?(threadId: string): void | Promise<void>;
  getParticipants?(threadId: string): string[] | Promise<string[]>;
}

// ---------------------------------------------------------------------------
// 事件/遥测回调（clowder socketManager.emitToUser + guideTransitions.add）
// ---------------------------------------------------------------------------

/** socket.emitToUser 回调（guide_start / guide_control / guide_complete）。 */
export type GuideEmitFn = (userId: string, event: string, payload: Record<string, unknown>) => void;

/** telemetry.add 回调（operation.name + status 计数）。 */
export type TelemetryFn = (operationName: string, status: 'success' | 'failure') => void;

/** 默认 no-op emit（插件缺省行为：无 socket 宿主）。 */
export function noopEmit(): GuideEmitFn {
  return () => {};
}

/** 默认 no-op telemetry。 */
export function noopTelemetry(): TelemetryFn {
  return () => {};
}
