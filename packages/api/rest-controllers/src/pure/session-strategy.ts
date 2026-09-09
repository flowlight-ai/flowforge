/**
 * Session strategy resolution + execution-status computation (pure; F33).
 *
 * Rebuilds clowder `config/session-strategy.ts` + `session-strategy-overrides.ts`
 * + `resolveSessionExecutionStatus` semantics against injected seams.
 */

import type { AgentContextCapability, SessionStrategyConfig } from '../contract/session.ts';

/** Runtime override store seam (Redis-backed in clowder). */
export interface SessionStrategyOverrideStore {
  getAll(): Promise<Record<string, SessionStrategyConfig['strategy']>> | Record<string, SessionStrategyConfig['strategy']>;
  get(catId: string): Promise<SessionStrategyConfig['strategy'] | null> | SessionStrategyConfig['strategy'] | null;
  set(catId: string, strategy: SessionStrategyConfig['strategy']): void | Promise<void>;
  delete(catId: string): void | Promise<void>;
}

export class MemorySessionStrategyOverrideStore implements SessionStrategyOverrideStore {
  private readonly overrides = new Map<string, SessionStrategyConfig['strategy']>();
  getAll(): Record<string, SessionStrategyConfig['strategy']> {
    return Object.fromEntries(this.overrides.entries());
  }
  get(catId: string): SessionStrategyConfig['strategy'] | null {
    return this.overrides.get(catId) ?? null;
  }
  set(catId: string, strategy: SessionStrategyConfig['strategy']): void {
    this.overrides.set(catId, strategy);
  }
  delete(catId: string): void {
    this.overrides.delete(catId);
  }
}

/** Lower-source strategy provider (config/DB). Host wires in EP2. */
export interface SessionStrategyLowerSource {
  getByCatId(catId: string): SessionStrategyConfig['strategy'] | null;
}

export const UNAVAILABLE_CONTEXT_CAPABILITY: AgentContextCapability = {
  provider: 'unknown',
  carrier: 'unknown',
  reportsRuntimeWindow: false,
  authoritativeUsage: false,
  usageTelemetry: 'unavailable',
  nativeWindowControl: false,
  nativeCompressionControl: false,
  observesCompression: false,
  reason: 'No concrete context capability is registered for this member',
};

/** Effective strategy with its provenance source. */
export function getSessionStrategyWithSource(
  catId: string,
  deps: { overrideStore: SessionStrategyOverrideStore; lowerSource: SessionStrategyLowerSource },
): SessionStrategyConfig {
  const override = deps.overrideStore.get(catId) ?? null;
  if (override !== null) return { strategy: override, source: 'override' };
  const lower = deps.lowerSource.getByCatId(catId);
  if (lower !== null) return { strategy: lower, source: 'config' };
  return { strategy: {}, source: 'default' };
}

export type SessionExecutionStatus = {
  sessionStrategy: string;
  bounded: boolean;
  authoritativeUsage: boolean;
  reason: string;
};

/** Determine how the strategy behaves under the current context capability. */
export function resolveSessionExecutionStatus(
  strategy: Record<string, any>,
  input: {
    managedInvocationBoundary: boolean;
    effectiveInputCeiling: boolean;
    carrierBinding: boolean;
    authoritativeUsage: boolean;
  },
): SessionExecutionStatus {
  const strategyName = typeof strategy?.name === 'string' ? strategy.name : (strategy?.mode ?? 'default');
  const bounded = input.managedInvocationBoundary && input.effectiveInputCeiling && input.carrierBinding;
  return {
    sessionStrategy: String(strategyName),
    bounded,
    authoritativeUsage: input.authoritativeUsage,
    reason: bounded ? 'window_bound' : 'window_unbounded',
  };
}

export function executionStatusFor(
  capability: AgentContextCapability,
  strategy: Record<string, any>,
): SessionExecutionStatus {
  const hasWindowBinding = capability.reportsRuntimeWindow || capability.nativeWindowControl;
  return resolveSessionExecutionStatus(strategy, {
    managedInvocationBoundary: true,
    effectiveInputCeiling: hasWindowBinding,
    carrierBinding: hasWindowBinding,
    authoritativeUsage: capability.authoritativeUsage && capability.usageTelemetry === 'available',
  });
}