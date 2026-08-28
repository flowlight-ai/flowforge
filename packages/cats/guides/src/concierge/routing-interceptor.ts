/**
 * @flowforge/cats-guides — ConciergeRoutingInterceptor（F229）。
 *
 * Decouples concierge context logic from routing core (guides routing-interceptor 同模式).
 *
 * Called once before the per-cat loop:
 *   const conciergeCtx = await prepareConciergeContext(routeThread, userId, deps.invocationDeps.conciergeConfigStore);
 *   // Inside buildInvocationContext:
 *   ...conciergeCtx,
 *
 * 插件化改造：Thread 完整记录 → 最小形状（id/threadKind，见下方 ConciergeRouteThread）。
 *
 * @module @flowforge/cats-guides/concierge/routing-interceptor
 */

import type { ConciergeConfig } from '../models.js';
import type { IConciergeConfigStore } from './config-store.js';

/** Thread 最小形状（routing interceptor 只需 threadKind 判断）。 */
export interface ConciergeRouteThread {
  id: string;
  threadKind?: string | null;
}

/** Shape spread into buildInvocationContext when thread is a concierge thread. */
export interface ConciergeInvocationContext {
  threadKind: 'concierge';
  conciergeConfig: ConciergeConfig;
}

/**
 * Resolve concierge invocation context for the current thread.
 *
 * Returns ConciergeInvocationContext when:
 *   - thread.threadKind === 'concierge', AND
 *   - conciergeConfigStore is provided
 *
 * Returns empty object otherwise (normal threads unaffected).
 */
export async function prepareConciergeContext(
  thread: ConciergeRouteThread | null,
  userId: string,
  store: IConciergeConfigStore | undefined,
): Promise<ConciergeInvocationContext | Record<string, never>> {
  if (thread?.threadKind !== 'concierge' || !store) return {};
  const config = await store.get(userId);
  return { threadKind: 'concierge', conciergeConfig: config };
}

/**
 * Per-cat injection gate (guides routing-interceptor guideContextForCat 同模式).
 *
 * Returns ConciergeInvocationContext only when catId === config.dutyCatProfileId.
 * All other cats on a concierge thread (A2A, user @mentions) get empty context —
 * the 岗位 prompt is exclusively for the configured duty cat.
 *
 * Usage (inside per-cat loop):
 *   ...conciergeContextForCat(conciergeCtx, catId),
 */
export function conciergeContextForCat(
  ctx: ConciergeInvocationContext | Record<string, never>,
  catId: string,
): ConciergeInvocationContext | Record<string, never> {
  if (!('conciergeConfig' in ctx)) return {};
  return ctx.conciergeConfig.dutyCatProfileId === catId ? ctx : {};
}
