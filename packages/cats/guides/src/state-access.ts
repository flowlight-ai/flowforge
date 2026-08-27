/**
 * @flowforge/cats-guides — Guide 状态访问控制（clowder guide-state-access.ts 直译）。
 *
 * 共享默认线程（id=DEFAULT_GUIDE_THREAD_ID && createdBy='system'）全局可访问；
 * owner 总是可访问；其他人仅能在共享默认线程访问自己 userId 的 guide state。
 *
 * @module @flowforge/cats-guides/state-access
 */

import type { GuideStateV1 } from './models.js';
import { DEFAULT_GUIDE_THREAD_ID } from './models.js';
import type { GuideThreadAccess } from './ports.js';

/** 是否共享默认线程（lobby 单线程模式）。 */
export function isSharedDefaultThread(thread: GuideThreadAccess | null | undefined): boolean {
  return Boolean(thread && thread.id === DEFAULT_GUIDE_THREAD_ID && thread.createdBy === 'system');
}

/** @deprecated Use isSharedDefaultThread — kept as alias during migration. */
export const isSharedDefaultGuideThread = isSharedDefaultThread;

/** 通用线程访问检查：owner 或有共享默认线程。 */
export function canAccessThread(thread: GuideThreadAccess | null, userId: string): boolean {
  if (!thread) return false;
  if (thread.createdBy === userId) return true;
  return thread.id === DEFAULT_GUIDE_THREAD_ID && thread.createdBy === 'system';
}

/** guide state 访问检查：owner 或（共享默认线程且 state 归属该用户）。 */
export function canAccessGuideState(
  thread: GuideThreadAccess | null | undefined,
  guideState: Pick<GuideStateV1, 'userId'> | null | undefined,
  userId: string,
): boolean {
  if (!thread || !guideState) return false;
  if (thread.createdBy === userId) return true;
  return isSharedDefaultThread(thread) && guideState.userId === userId;
}

/** 是否存在隐藏的他人非终态 guide state（阻止 bootcamp 自动 offer 干扰他人引导）。 */
export function hasHiddenForeignNonTerminalGuideState(
  thread: GuideThreadAccess | null | undefined,
  guideState: Pick<GuideStateV1, 'status' | 'userId'> | null | undefined,
  userId: string,
): boolean {
  if (!thread || !guideState) return false;
  if (canAccessGuideState(thread, guideState, userId)) return false;
  return guideState.status !== 'completed' && guideState.status !== 'cancelled';
}
