"use client";

/**
 * HubObservabilityOverview — Observability 概览面板
 *
 * 用于 /admin/observability 的主视图，提供：
 *   - OTel 启用状态横幅（disabled 时给出原因 + 配置指引）
 *   - 指标卡片网格（invocation ok/error/active/snapshots）
 *   - 趋势图（30 分钟内的 invocation completed 折线图）
 *   - 功能开关区（telemetry 类别的 hot-reloadable env vars）
 *     - toggle 型：on/off 切换
 *     - multi-value 型：在 allowedValues 间循环
 *     - 文本型：InlineEditField 编辑
 *   - 配置参考区（telemetry 类别的 startup-only env vars，只读）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：仅依赖 observability-helpers 类型/工具，不依赖上游
 *
 * API 端点（FlowForge 风格）：
 *   - GET /api/v1/telemetry/metrics/history?since=   获取指标历史快照
 *   - GET /api/v1/telemetry/health                   获取 OTel 健康状态
 *   - GET /api/v1/config/env-summary                 获取 env 变量清单
 *   - PATCH /api/v1/config/env                       热更新 env 变量
 *
 * 当 API 不可用时，graceful degradation：显示空状态，不抛异常。
 * 每 30 秒自动刷新一次（fetchAll + setInterval）。
 */

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EnvVar,
  HealthData,
  MetricsSnapshot,
} from "./observability-helpers";
import {
  filterTelemetryEditable,
  getTelemetryConfigVars,
  sumByPrefix,
} from "./observability-helpers";

/* ------------------------------------------------------------------ */
/* MetricCard                                                          */
/* ------------------------------------------------------------------ */

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ background: "var(--cafe-surface-elevated,#15151c)" }}
      data-hub-metric-card={label}
    >
      <div
        className="text-xs"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-xl font-semibold"
        style={{ color: "var(--cafe-text,#e5e7eb)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-xs"
          style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* InlineEditField                                                     */
/* ------------------------------------------------------------------ */

interface InlineEditFieldProps {
  value: string;
  displayValue?: string;
  disabled: boolean;
  onSubmit: (newVal: string) => void;
}

function InlineEditField({
  value,
  displayValue,
  disabled,
  onSubmit,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={`max-w-[50%] truncate rounded px-2 py-0.5 text-right font-mono text-[10px] ${
          disabled ? "opacity-50" : ""
        }`}
        style={{
          color: "var(--cafe-text-secondary,#9ca3af)",
        }}
        title="点击编辑"
        data-hub-inline-edit="trigger"
      >
        {displayValue ?? value}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft !== value) onSubmit(draft);
        setEditing(false);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 rounded border px-1.5 py-0.5 font-mono text-[10px] outline-none"
        style={{
          borderColor: "var(--cafe-border,#2a2c3a)",
          background: "var(--cafe-surface-sunken,#0f1015)",
          color: "var(--cafe-text,#e5e7eb)",
        }}
        data-hub-inline-edit="input"
      />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* TrendChart                                                          */
/* ------------------------------------------------------------------ */

function TrendChart({
  snapshots,
  metricPrefix,
  label,
}: {
  snapshots: MetricsSnapshot[];
  metricPrefix: string;
  label: string;
}) {
  if (snapshots.length < 2) return null;

  const values = snapshots.map((s) => sumByPrefix(s.metrics, metricPrefix));
  const max = Math.max(...values, 1);
  const width = 400;
  const height = 80;
  const step = width / (values.length - 1);

  const points = values
    .map((v, i) => `${i * step},${height - (v / max) * height}`)
    .join(" ");

  const containerStyle: CSSProperties = {
    background: "var(--cafe-surface-elevated,#15151c)",
    // 自定义 CSS 变量，供 polyline stroke 引用
    ["--dataviz-trend-line" as string]: "var(--chart-4,#a855f7)",
  };

  return (
    <div
      className="rounded-lg p-3"
      style={containerStyle}
      data-hub-trend-chart={metricPrefix}
    >
      <div
        className="mb-2 text-xs"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        {label}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--dataviz-trend-line)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* OverviewPanel 主组件                                                */
/* ------------------------------------------------------------------ */

export function OverviewPanel() {
  const [snapshots, setSnapshots] = useState<MetricsSnapshot[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const editableVars = useMemo(() => filterTelemetryEditable(envVars), [envVars]);
  const configVars = useMemo(() => getTelemetryConfigVars(envVars), [envVars]);

  const fetchAll = useCallback(async () => {
    try {
      const [historyRes, healthRes, envRes] = await Promise.all([
        fetch(
          `/api/v1/telemetry/metrics/history?since=${Date.now() - 30 * 60 * 1000}`,
        ),
        fetch("/api/v1/telemetry/health"),
        fetch("/api/v1/config/env-summary"),
      ]);
      if (historyRes.ok) {
        const data = (await historyRes.json().catch(() => ({}))) as {
          snapshots?: MetricsSnapshot[];
        };
        setSnapshots(data.snapshots ?? []);
      }
      if (healthRes.ok || healthRes.status === 503) {
        const body = (await healthRes.json().catch(() => null)) as HealthData | null;
        if (body) setHealth(body);
      }
      if (envRes.ok) {
        const envData = (await envRes.json().catch(() => ({}))) as {
          variables?: EnvVar[];
        };
        setEnvVars(envData.variables ?? []);
      }
    } catch {
      /* ignore — 各分区独立 graceful degradation */
    } finally {
      setLoading(false);
    }
  }, []);

  const patchEnvVar = useCallback(
    async (name: string, newValue: string) => {
      setUpdatingKey(name);
      try {
        await fetch("/api/v1/config/env", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: [{ name, value: newValue }] }),
        });
        await fetchAll();
      } catch {
        /* fetchAll 会刷新状态 */
      } finally {
        setUpdatingKey(null);
      }
    },
    [fetchAll],
  );

  const cycleEnvVar = useCallback(
    (name: string, currentValue: string | null, allowedValues?: string[]) => {
      let newValue: string;
      if (allowedValues && allowedValues.length > 1) {
        const idx = allowedValues.indexOf(currentValue ?? allowedValues[0]!);
        newValue = allowedValues[(idx + 1) % allowedValues.length]!;
      } else {
        newValue = currentValue === "on" ? "off" : "on";
      }
      void patchEnvVar(name, newValue);
    },
    [patchEnvVar],
  );

  useEffect(() => {
    void fetchAll();
    timerRef.current = setInterval(() => {
      void fetchAll();
    }, 30_000);
    return () => clearInterval(timerRef.current);
  }, [fetchAll]);

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.metrics : {};

  // 兼容 forgekin_* 与 legacy cat_cafe_* 指标名
  const invOk =
    sumByPrefix(latest, "forgekin_invocation_completed", 'status="ok"') ||
    sumByPrefix(latest, "cat_cafe_invocation_completed", 'status="ok"');
  const invErr =
    sumByPrefix(latest, "forgekin_invocation_completed", 'status="error"') ||
    sumByPrefix(latest, "cat_cafe_invocation_completed", 'status="error"');
  const invocations =
    sumByPrefix(latest, "forgekin_invocation_count") ||
    sumByPrefix(latest, "cat_cafe_cat_invocation_count");
  const activeInv =
    sumByPrefix(latest, "forgekin_invocation_active") ||
    sumByPrefix(latest, "cat_cafe_invocation_active");

  if (loading) {
    return (
      <p
        className="text-sm"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        加载中...
      </p>
    );
  }

  const otelEnabled = health?.otelEnabled ?? false;

  return (
    <div className="space-y-4" data-hub-overview-panel="root">
      {/* OTel 状态横幅：未启用时给出原因与配置指引 */}
      {health && !otelEnabled && (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "var(--conn-amber-border,rgba(245,158,11,0.35))",
            background: "var(--conn-amber-bg,rgba(245,158,11,0.10))",
          }}
          data-hub-overview-panel-banner="otel-disabled"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠</span>
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--conn-amber-text,#f59e0b)" }}
            >
              可观测性未启用
            </span>
          </div>
          <p
            className="mt-1 text-[10px]"
            style={{ color: "var(--conn-amber-text,#f59e0b)" }}
          >
            {health.disabledReason
              ? `原因：${health.disabledReason}。`
              : "OTel SDK 未启动，监控数据不会采集。"}
            请在下方「配置参考」中检查相关配置，修改后需重启服务生效。
          </p>
        </div>
      )}

      {/* 指标卡片网格 — OTel 未启用时数据自然为 0 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Invocation (ok)" value={String(invOk)} />
        <MetricCard
          label="Invocation (error)"
          value={String(invErr)}
          sub={
            invOk + invErr > 0
              ? `${((invErr / (invOk + invErr)) * 100).toFixed(1)}% error`
              : undefined
          }
        />
        <MetricCard label="Invocations" value={String(invocations)} />
        <MetricCard label="Active" value={String(activeInv)} />
        <MetricCard
          label="Snapshots"
          value={`${snapshots.length}`}
          sub="(last 30min)"
        />
      </div>

      {snapshots.length > 1 && (
        <TrendChart
          snapshots={snapshots}
          metricPrefix="forgekin_invocation_completed"
          label="Invocation Completed"
        />
      )}

      {/* 功能开关区：telemetry 类别的 hot-reloadable env vars */}
      {editableVars.length > 0 && (
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--cafe-surface-elevated,#15151c)" }}
          data-hub-overview-panel-section="editable-vars"
        >
          <h3
            className="mb-2 text-xs font-semibold"
            style={{ color: "var(--cafe-text,#e5e7eb)" }}
          >
            功能开关
          </h3>
          {editableVars.map((v) => {
            const isToggle = v.allowedValues && v.allowedValues.length >= 2;
            const isOn = v.currentValue === "on";
            const hasMultiValues = v.allowedValues && v.allowedValues.length > 2;
            const isUpdating = updatingKey === v.name;
            const current = v.currentValue ?? v.defaultValue;

            return (
              <div
                key={v.name}
                className="flex items-center justify-between rounded-lg px-2 py-2"
                data-hub-overview-panel-var={v.name}
              >
                <div className="flex-1 pr-3">
                  <div
                    className="text-xs font-medium"
                    style={{ color: "var(--cafe-text,#e5e7eb)" }}
                  >
                    {v.name}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
                  >
                    {v.description}
                  </div>
                </div>
                {isToggle && hasMultiValues ? (
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() =>
                      cycleEnvVar(v.name, v.currentValue, v.allowedValues)
                    }
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      isUpdating ? "opacity-50" : ""
                    }`}
                    style={{
                      background:
                        current === "on" || current === "apply"
                          ? "var(--cafe-accent,#ff5c5c)"
                          : current === "off"
                            ? "var(--cafe-surface-sunken,#0f1015)"
                            : "var(--conn-amber-bg,rgba(245,158,11,0.10))",
                      color:
                        current === "on" || current === "apply"
                          ? "var(--cafe-surface,#1e1f26)"
                          : current === "off"
                            ? "var(--cafe-text-secondary,#9ca3af)"
                            : "var(--conn-amber-text,#f59e0b)",
                    }}
                    title={`点击切换: ${v.allowedValues!.join(" → ")}`}
                    data-hub-overview-panel-var-action="cycle-multi"
                  >
                    {current}
                  </button>
                ) : isToggle ? (
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => cycleEnvVar(v.name, v.currentValue)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      isUpdating ? "opacity-50" : ""
                    }`}
                    style={{
                      background: isOn
                        ? "var(--cafe-accent,#ff5c5c)"
                        : "var(--cafe-surface-sunken,#0f1015)",
                    }}
                    aria-pressed={isOn}
                    data-hub-overview-panel-var-action="toggle"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow transition-transform ${
                        isOn ? "translate-x-4" : ""
                      }`}
                      style={{ background: "var(--cafe-surface,#1e1f26)" }}
                    />
                  </button>
                ) : (
                  <InlineEditField
                    value={v.currentValue ?? ""}
                    displayValue={current}
                    disabled={isUpdating}
                    onSubmit={(newVal) => patchEnvVar(v.name, newVal)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 配置参考区：telemetry 类别的 startup-only env vars（只读） */}
      {configVars.length > 0 && (
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--cafe-surface-elevated,#15151c)" }}
          data-hub-overview-panel-section="config-vars"
        >
          <h3
            className="mb-2 text-xs font-semibold"
            style={{ color: "var(--cafe-text,#e5e7eb)" }}
          >
            配置参考
          </h3>
          <p
            className="mb-2 text-[10px]"
            style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
          >
            以下配置需在 .env 中设置，修改后重启生效。
          </p>
          {configVars.map((v) => (
            <div key={v.name} className="rounded-lg px-2 py-2">
              <div className="flex items-center justify-between">
                <span
                  className="font-mono text-xs font-medium"
                  style={{ color: "var(--cafe-text,#e5e7eb)" }}
                >
                  {v.name}
                </span>
                <span
                  className="max-w-[50%] truncate text-right font-mono text-[10px]"
                  style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
                >
                  {v.sensitive ? "••••••" : v.currentValue || v.defaultValue}
                </span>
              </div>
              <div
                className="mt-0.5 text-[10px]"
                style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
              >
                {v.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OverviewPanel;
