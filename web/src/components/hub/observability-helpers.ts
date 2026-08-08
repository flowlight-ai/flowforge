/**
 * observability-helpers — Observability 面板纯逻辑工具
 *
 * 移植自 clowder-ai observability-helpers，纯逻辑函数（无 React 依赖）。
 * 提供 HealthData / MetricsSnapshot / EnvVar 类型 + 过滤/求和/格式化工具。
 *
 * 独立性：不依赖任何 clowder-ai 模块，可直接用于单元测试。
 */

export interface HealthData {
  status: "healthy" | "degraded";
  uptime: number;
  otelEnabled: boolean;
  disabledReason?: string;
  readiness?: {
    status: "ready" | "degraded";
    checks: Record<string, { ok: boolean; ms: number; error?: string }>;
  };
  errorRate: number | null;
  traceStore: {
    spanCount: number;
    maxSpans: number;
    oldestStoredAt: number | null;
  } | null;
  metricsSnapshotStore: { snapshotCount: number; maxSnapshots: number } | null;
  timestamp: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  metrics: Record<string, number>;
}

export interface EnvVar {
  name: string;
  defaultValue: string;
  description: string;
  category: string;
  sensitive: boolean;
  currentValue: string | null;
  allowedValues?: string[];
  runtimeEditable?: boolean;
}

export const TELEMETRY_CATEGORY = "telemetry";

/**
 * 过滤出 telemetry 分类下可热更新的变量（toggle + 可编辑字段）。
 * 这些变量在 UI 中提供交互控件，无需重启即可生效。
 */
export function filterTelemetryEditable(vars: EnvVar[]): EnvVar[] {
  return vars.filter(
    (v) =>
      v.category === TELEMETRY_CATEGORY &&
      !v.sensitive &&
      v.runtimeEditable === true,
  );
}

/**
 * 返回 telemetry 分类下需重启生效的变量（只读配置参考）。
 */
export function getTelemetryConfigVars(vars: EnvVar[]): EnvVar[] {
  return vars.filter(
    (v) =>
      v.category === TELEMETRY_CATEGORY && v.runtimeEditable !== true,
  );
}

/**
 * 按前缀（可选 filter 子串）求和 metrics。
 * 例：sumByPrefix(metrics, "forgekin_invocation_completed", 'status="ok"')
 */
export function sumByPrefix(
  metrics: Record<string, number>,
  prefix: string,
  filter?: string,
): number {
  let total = 0;
  for (const [key, value] of Object.entries(metrics)) {
    if (!key.startsWith(prefix)) continue;
    if (filter && !key.includes(filter)) continue;
    total += value;
  }
  return total;
}

/** 格式化运行时长（秒 → "Xh Ym" / "Ym"） */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
