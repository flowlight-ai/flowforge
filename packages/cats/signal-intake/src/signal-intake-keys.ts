/**
 * 信号准入域 Redis/KV key 模式。宿主（Redis/KV 后端）负责加载。
 * 忠实移植 clowder-ai `domains/signal-intake/signal-intake-keys.ts`。
 *
 * @flowforge/cats-signal-intake
 */

export const SignalIntakeKeys = {
  intake: (intakeId: string): string => `signal-intake:v1:intake:${intakeId}`,
  allIntakes: (): string => 'signal-intake:v1:intakes',
  settlement: (settlementKey: string): string => `signal-intake:v1:settlement:${settlementKey}`,
  sourceIdentity: (sourceIdentityKey: string): string => `signal-intake:v1:source:${sourceIdentityKey}`,
  route: (routeKey: string): string => `signal-intake:v1:route:${routeKey}`,
  sourceGrant: (grantHash: string): string => `signal-intake:v1:source-grant:${grantHash}`,
} as const