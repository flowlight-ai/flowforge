"use client";

/**
 * HubTraceTree — Trace 浏览器与瀑布图
 *
 * 移植自 clowder-ai HubTraceTree，适配 FlowForge 暗色主题。
 * 用于 /admin/observability，提供：
 *   - 按 traceId / forgekinId 搜索 trace
 *   - Trace 卡片列表（展开/折叠）
 *   - 树形瀑布图（depth 缩进 + 状态着色 + 时长条）
 *   - Span 详情面板（attributes / events）
 *   - Step Summary 摘要（agent loops / tool calls / duration / tokens）
 *   - Prompt X-Ray Inspector（4 tab: system/user/effective/meta + token bar）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：仅依赖 trace-tree-utils 工具，不依赖 clowder-ai apiFetch。
 *
 * API 端点（FlowForge 风格）：
 *   - GET  /api/v1/telemetry/traces?traceId=&forgekinId=&limit=
 *   - GET  /api/v1/telemetry/step-summary?traceId=&routeSpanId=
 *   - GET  /api/v1/debug/prompt-captures?invocationId=
 *   - GET  /api/v1/debug/prompt-captures/{captureId}
 *
 * 当 API 不可用时，graceful degradation：显示空状态/错误，不抛异常。
 */

import { useCallback, useEffect, useState } from "react";
import {
  buildForest,
  flattenForest,
  type SpanNode,
  type TraceSpan,
} from "./trace-tree-utils";

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

interface TraceGroup {
  traceId: string;
  spans: TraceSpan[];
  forest: SpanNode[];
  rootName: string;
  totalDurationMs: number;
  startTime: number;
  spanCount: number;
  hasError: boolean;
}

interface StepSummaryData {
  traceId: string;
  routeSpanId?: string;
  agent_loop_count: number | null;
  tool_call_count: number | null;
  a2a_dispatch_count: number | null;
  duration_ms: number;
  token_total: number;
  error_count: number;
  is_restored: boolean;
  width_avg_tools_per_loop: number | null;
  agent_loop_partial: boolean;
}

interface PromptCaptureData {
  captureId: string;
  invocationId: string;
  catId: string;
  model: string;
  capturedAt: number;
  systemPrompt: string;
  missionPrefix?: string;
  userPrompt: string;
  effectivePrompt: string;
  injectionDecision: {
    isResume: boolean;
    canSkipOnResume: boolean;
    forceReinjection: boolean;
    injected: boolean;
  };
  promptBytes: number;
  tokenEstimate: number;
  nativeSystemPrompt?: string;
  nativeSystemPromptSource?: string;
  nativeSystemTokenEstimate?: number;
  totalTokenEstimate?: number;
  captureDiagnostics?: readonly string[];
}

type InspectorTab = "system" | "user" | "effective" | "meta";

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function groupByTrace(spans: TraceSpan[]): TraceGroup[] {
  const map = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    const arr = map.get(s.traceId) ?? [];
    arr.push(s);
    map.set(s.traceId, arr);
  }
  return [...map.entries()]
    .map(([traceId, traceSpans]) => {
      const forest = buildForest(traceSpans);
      const minStart = Math.min(...traceSpans.map((s) => s.startTimeMs));
      const maxEnd = Math.max(...traceSpans.map((s) => s.endTimeMs));
      return {
        traceId,
        spans: traceSpans,
        forest,
        rootName: (forest[0]?.span ?? traceSpans[0])!.name,
        totalDurationMs: maxEnd - minStart,
        startTime: minStart,
        spanCount: traceSpans.length,
        hasError: traceSpans.some(
          (s) => s.status.code !== 0 && s.status.code !== 1,
        ),
      };
    })
    .sort((a, b) => b.startTime - a.startTime);
}

/* ------------------------------------------------------------------ */
/* TraceBrowser 主组件                                                 */
/* ------------------------------------------------------------------ */

export function TraceBrowser() {
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (search) {
        if (search.length === 32 && /^[0-9a-f]+$/i.test(search)) {
          params.set("traceId", search);
        } else {
          params.set("forgekinId", search);
        }
      }
      const res = await fetch(
        `/api/v1/telemetry/traces?${params.toString()}`,
      );
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          spans?: TraceSpan[];
        };
        setSpans(data.spans ?? []);
      } else {
        setSpans([]);
      }
    } catch {
      setSpans([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchTraces();
  }, [fetchTraces]);

  const traces = groupByTrace(spans);

  return (
    <div className="space-y-3" data-hub-trace-tree="root">
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="traceId 或 forgekinId..."
          className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none transition focus:ring-1"
          style={{
            background: "var(--cafe-surface-sunken,#0f1015)",
            color: "var(--cafe-text,#e5e7eb)",
            border: "1px solid var(--cafe-border,#2a2c3a)",
          }}
          data-hub-trace-tree-input="search"
        />
        <button
          type="button"
          onClick={() => void fetchTraces()}
          disabled={!search.trim()}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
          style={{
            background: "var(--cafe-accent,#ff5c5c)",
            color: "var(--cafe-surface,#1e1f26)",
          }}
          data-hub-trace-tree-action="search"
        >
          搜索
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--cafe-text-muted,#6b7280)" }}>加载中...</p>
      ) : traces.length === 0 ? (
        <p style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}>
          未找到 trace。请确认 OpenTelemetry 已启用，或调整搜索条件。
        </p>
      ) : (
        <div
          className="max-h-[500px] space-y-2 overflow-y-auto"
          data-hub-trace-tree-list="true"
        >
          {traces.map((trace) => (
            <TraceCard
              key={trace.traceId}
              trace={trace}
              expanded={expandedTrace === trace.traceId}
              onToggle={() =>
                setExpandedTrace(
                  expandedTrace === trace.traceId ? null : trace.traceId,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TraceCard                                                           */
/* ------------------------------------------------------------------ */

function TraceCard({
  trace,
  expanded,
  onToggle,
}: {
  trace: TraceGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);
  const selectedSpanData = selectedSpan
    ? trace.spans.find((s) => s.spanId === selectedSpan)
    : undefined;
  const selectedRouteSpanId =
    selectedSpanData?.name === "forgekin.route"
      ? selectedSpanData.spanId
      : undefined;

  return (
    <div
      className="rounded-lg border"
      style={{
        borderColor: "var(--cafe-border,#2a2c3a)",
        background: "var(--cafe-surface,#1e1f26)",
      }}
      data-hub-trace-card={trace.traceId}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
        style={{ background: "transparent" }}
        data-hub-trace-card-action="toggle"
      >
        <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
          {expanded ? "▼" : "▶"}
        </span>
        <span
          className="flex-1 truncate text-xs font-medium"
          style={{ color: "var(--cafe-text,#e5e7eb)" }}
        >
          {trace.rootName}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "var(--cafe-surface-elevated,#15151c)",
            color: "var(--cafe-text-muted,#6b7280)",
          }}
        >
          {trace.spanCount} span{trace.spanCount > 1 ? "s" : ""}
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
        >
          {trace.totalDurationMs.toFixed(0)}ms
        </span>
        {trace.hasError && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: "var(--conn-red-bg,rgba(239,68,68,0.15))",
              color: "var(--conn-red-text,#ef4444)",
            }}
          >
            error
          </span>
        )}
        <span
          className="text-[10px]"
          style={{ color: "var(--cafe-text-muted,#6b7280)" }}
        >
          {new Date(trace.startTime).toLocaleTimeString()}
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-3 pb-3 pt-2 space-y-2"
          style={{ borderColor: "var(--cafe-border,#2a2c3a)" }}
        >
          <div
            className="text-[10px] font-mono"
            style={{ color: "var(--cafe-text-muted,#6b7280)" }}
          >
            traceId: {trace.traceId}
          </div>
          <StepSummaryPanel
            traceId={trace.traceId}
            routeSpanId={selectedRouteSpanId}
          />
          <TreeWaterfall
            trace={trace}
            selectedSpan={selectedSpan}
            onSelectSpan={setSelectedSpan}
          />
          {selectedSpan && <SpanDetail span={selectedSpanData} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TreeWaterfall                                                       */
/* ------------------------------------------------------------------ */

function TreeWaterfall({
  trace,
  selectedSpan,
  onSelectSpan,
}: {
  trace: TraceGroup;
  selectedSpan: string | null;
  onSelectSpan: (id: string | null) => void;
}) {
  const flat = flattenForest(trace.forest);
  const totalDuration = trace.totalDurationMs || 1;

  return (
    <div className="space-y-0.5" data-hub-trace-waterfall="root">
      {flat.map((node) => {
        const left =
          ((node.span.startTimeMs - trace.startTime) / totalDuration) * 100;
        const width = Math.max(
          (node.span.durationMs / totalDuration) * 100,
          0.5,
        );
        const statusOk =
          node.span.status.code === 0 || node.span.status.code === 1;
        const selected = selectedSpan === node.span.spanId;
        const forgekinId = node.span.attributes["forgekin.id"] as
          | string
          | undefined;
        const agentId = node.span.attributes["agent.id"] as string | undefined;
        const displayId = forgekinId ?? agentId;

        return (
          <div
            key={node.span.spanId}
            onClick={() => onSelectSpan(selected ? null : node.span.spanId)}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-colors"
            style={{
              background: selected
                ? "var(--conn-blue-bg,rgba(59,130,246,0.20))"
                : "transparent",
            }}
            data-hub-trace-waterfall-span={node.span.spanId}
          >
            <div
              className="flex items-center gap-1 truncate text-[10px]"
              style={{
                paddingLeft: `${node.depth * 16}px`,
                width: "160px",
                flexShrink: 0,
              }}
            >
              {node.depth > 0 && (
                <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
                  └
                </span>
              )}
              <span
                className="truncate"
                style={{
                  color:
                    node.depth === 0
                      ? "var(--cafe-text,#e5e7eb)"
                      : "var(--cafe-text-secondary,#9ca3af)",
                  fontWeight: node.depth === 0 ? 600 : 400,
                }}
                title={node.span.name}
              >
                {node.span.name}
              </span>
            </div>
            {displayId ? (
              <span
                className="w-14 flex-shrink-0 truncate text-[10px]"
                style={{ color: "var(--cafe-text-muted,#6b7280)" }}
              >
                {displayId}
              </span>
            ) : (
              <span className="w-14 flex-shrink-0" />
            )}
            <div
              className="relative h-3 flex-1 rounded"
              style={{
                background: "var(--cafe-surface-elevated,#15151c)",
              }}
            >
              <div
                className="absolute h-full rounded"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: statusOk
                    ? "var(--conn-blue-text,#3b82f6)"
                    : "var(--conn-red-text,#ef4444)",
                }}
              />
            </div>
            <span
              className="w-14 flex-shrink-0 text-right text-[10px] tabular-nums"
              style={{ color: "var(--cafe-text-muted,#6b7280)" }}
            >
              {node.span.durationMs.toFixed(0)}ms
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SpanDetail                                                          */
/* ------------------------------------------------------------------ */

function SpanDetail({ span }: { span: TraceSpan | undefined }) {
  const [xrayOpen, setXrayOpen] = useState(false);

  if (!span) return null;

  const invocationId = span.attributes.invocationId as string | undefined;
  const hasInvocationId = Boolean(invocationId);
  const forgekinId = span.attributes["forgekin.id"] as string | undefined;
  const agentId = span.attributes["agent.id"] as string | undefined;
  const displayId = forgekinId ?? agentId;

  return (
    <div
      className="rounded-lg p-3 text-xs"
      style={{ background: "var(--cafe-surface-elevated,#15151c)" }}
      data-hub-span-detail={span.spanId}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              spanId:
            </span>{" "}
            <span className="font-mono">{span.spanId}</span>
          </div>
          {hasInvocationId && (
            <button
              type="button"
              onClick={() => setXrayOpen(!xrayOpen)}
              className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{
                background: "var(--conn-purple-bg,rgba(168,85,247,0.15))",
                color: "var(--conn-purple-text,#a855f7)",
              }}
              data-hub-span-detail-action="xray-toggle"
            >
              {xrayOpen ? "关闭" : "X-Ray"}
            </button>
          )}
        </div>
        {span.parentSpanId && (
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              parent:
            </span>{" "}
            <span className="font-mono">{span.parentSpanId}</span>
          </div>
        )}
        <div>
          <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
            duration:
          </span>{" "}
          <span className="tabular-nums">{span.durationMs.toFixed(1)}ms</span>
          <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
            {" "}
            ({new Date(span.startTimeMs).toLocaleTimeString()} →{" "}
            {new Date(span.endTimeMs).toLocaleTimeString()})
          </span>
        </div>
        {Object.keys(span.attributes).length > 0 && (
          <div className="mt-2">
            <div style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              Attributes:
            </div>
            {Object.entries(span.attributes).map(([k, v]) => (
              <div key={k} className="ml-2">
                <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
                  {k}:
                </span>{" "}
                {String(v)}
              </div>
            ))}
          </div>
        )}
        {span.events.length > 0 && (
          <div className="mt-2">
            <div style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              Events ({span.events.length}):
            </div>
            {span.events.map((ev, i) => (
              <div key={`${ev.timeMs}-${i}`} className="ml-2">
                {new Date(ev.timeMs).toLocaleTimeString()} - {ev.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {xrayOpen && (
        <PromptInspector
          invocationId={invocationId}
          forgekinId={displayId}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PromptInspector — F153 Prompt X-Ray                                 */
/* ------------------------------------------------------------------ */

function PromptInspector({
  invocationId,
  forgekinId,
}: {
  invocationId?: string;
  forgekinId?: string;
}) {
  const [selected, setSelected] = useState<PromptCaptureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("system");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const params = new URLSearchParams();
        if (invocationId) params.set("invocationId", invocationId);
        const res = await fetch(
          `/api/v1/debug/prompt-captures?${params.toString()}`,
        );
        if (!res.ok) {
          setError(
            res.status === 404
              ? "未找到 prompt capture"
              : `错误 ${res.status}`,
          );
          return;
        }
        const index = (await res.json().catch(() => [])) as Array<{
          captureId: string;
          catId: string;
          forgekinId?: string;
        }>;
        const matching = forgekinId
          ? index.filter(
              (e) => e.forgekinId === forgekinId || e.catId === forgekinId,
            )
          : index;
        if (matching.length === 0) {
          setError(
            "此 span 没有 prompt capture。需开启 PROMPT_CAPTURE=on 才能采集。",
          );
          return;
        }
        const detailRes = await fetch(
          `/api/v1/debug/prompt-captures/${matching[0]!.captureId}`,
        );
        if (detailRes.ok) {
          const data = (await detailRes.json()) as PromptCaptureData;
          setSelected(data);
        }
      } catch {
        setError("加载 prompt capture 失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [invocationId, forgekinId]);

  if (loading) {
    return (
      <div
        className="mt-2 text-[10px]"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        加载 prompt capture...
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="mt-2 text-[10px]"
        style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
      >
        {error}
      </div>
    );
  }
  if (!selected) return null;

  const tabs: { key: InspectorTab; label: string; color: string }[] = [
    {
      key: "system",
      label: "System",
      color: "var(--conn-blue-text,#3b82f6)",
    },
    { key: "user", label: "User", color: "var(--conn-green-text,#10b981)" },
    {
      key: "effective",
      label: "Full Prompt",
      color: "var(--conn-purple-text,#a855f7)",
    },
    {
      key: "meta",
      label: "Meta",
      color: "var(--conn-amber-text,#f59e0b)",
    },
  ];

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--conn-purple-ring,rgba(168,85,247,0.35))",
        background: "var(--cafe-surface,#1e1f26)",
      }}
      data-hub-prompt-inspector="root"
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-xs font-medium"
          style={{ color: "var(--conn-purple-text,#a855f7)" }}
        >
          Prompt X-Ray
        </span>
        <div
          className="flex items-center gap-2 text-[10px]"
          style={{ color: "var(--cafe-text-muted,#6b7280)" }}
        >
          <span>{selected.model}</span>
          <span>·</span>
          <span>{(selected.promptBytes / 1024).toFixed(1)} KB</span>
          <span>·</span>
          <span>
            ~{selected.totalTokenEstimate ?? selected.tokenEstimate} tokens
          </span>
        </div>
      </div>

      <PromptTokenBar capture={selected} />

      <div
        className="mt-2 flex gap-1 border-b pb-1"
        style={{ borderColor: "var(--cafe-border,#2a2c3a)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="rounded-t px-2 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              color:
                tab === t.key
                  ? t.color
                  : "var(--cafe-text-muted,#6b7280)",
              background:
                tab === t.key
                  ? "var(--cafe-surface-elevated,#15151c)"
                  : "transparent",
            }}
            data-hub-prompt-inspector-tab={t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2 max-h-[300px] overflow-y-auto">
        {tab === "system" && (
          <>
            {selected.nativeSystemPrompt && (
              <PromptSection
                content={selected.nativeSystemPrompt}
                label={`Native L0 (system role)${
                  selected.nativeSystemPromptSource
                    ? ` · ${selected.nativeSystemPromptSource}`
                    : ""
                }`}
                className="mb-2"
              />
            )}
            {!selected.injectionDecision.injected && (
              <div
                className="mb-2 rounded px-2 py-1 text-[10px]"
                style={{
                  background: "var(--conn-amber-bg,rgba(245,158,11,0.10))",
                  color: "var(--conn-amber-text,#f59e0b)",
                }}
              >
                {selected.nativeSystemPrompt
                  ? "Resume — message-system pack 未附加（Native L0 仍通过 system-role 发送）"
                  : "Resume — system prompt 未在此 turn 注入"}
              </div>
            )}
            <PromptSection
              content={selected.systemPrompt}
              label={
                selected.nativeSystemPrompt
                  ? selected.injectionDecision.injected
                    ? "Message system prompt (pack appendix)"
                    : "Message system prompt (pack appendix · 未发送)"
                  : selected.injectionDecision.injected
                    ? "System Prompt"
                    : "System Prompt (未发送)"
              }
            />
            {selected.captureDiagnostics &&
              selected.captureDiagnostics.length > 0 && (
                <div
                  className="mt-2 rounded border p-2 text-[10px]"
                  style={{
                    borderColor:
                      "var(--conn-amber-ring,rgba(245,158,11,0.35))",
                    background: "var(--conn-amber-bg,rgba(245,158,11,0.10))",
                    color: "var(--conn-amber-text,#f59e0b)",
                  }}
                >
                  <div className="mb-1 font-medium">Capture diagnostics</div>
                  <ul className="ml-3 list-disc space-y-0.5">
                    {selected.captureDiagnostics.map((d, i) => (
                      <li key={`${d}-${i}`}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
          </>
        )}
        {tab === "user" && (
          <>
            {selected.missionPrefix && (
              <PromptSection
                content={selected.missionPrefix}
                label="Mission Prefix"
                className="mb-2"
              />
            )}
            <PromptSection content={selected.userPrompt} label="User Prompt" />
          </>
        )}
        {tab === "effective" && (
          <PromptSection
            content={selected.effectivePrompt}
            label="Effective Prompt (Full)"
          />
        )}
        {tab === "meta" && <PromptMeta capture={selected} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PromptTokenBar                                                      */
/* ------------------------------------------------------------------ */

function PromptTokenBar({ capture }: { capture: PromptCaptureData }) {
  const injected = capture.injectionDecision.injected;
  const nativeLen = capture.nativeSystemPrompt?.length ?? 0;
  const sysLen = injected ? capture.systemPrompt.length : 0;
  const userLen = capture.userPrompt.length;
  const missionLen = capture.missionPrefix?.length ?? 0;
  const total = nativeLen + capture.effectivePrompt.length || 1;

  const nativePct = (nativeLen / total) * 100;
  const sysPct = (sysLen / total) * 100;
  const missionPct = (missionLen / total) * 100;
  const userPct = (userLen / total) * 100;

  return (
    <div>
      <div
        className="flex h-2 overflow-hidden rounded-full"
        style={{ background: "var(--cafe-surface-elevated,#15151c)" }}
      >
        {nativePct > 0 && (
          <div
            style={{
              width: `${nativePct}%`,
              background: "var(--conn-purple-text,#a855f7)",
            }}
            title={`Native L0: ${nativePct.toFixed(0)}%`}
          />
        )}
        <div
          style={{
            width: `${sysPct}%`,
            background: "var(--conn-blue-text,#3b82f6)",
          }}
          title={`System: ${sysPct.toFixed(0)}%`}
        />
        {missionPct > 0 && (
          <div
            style={{
              width: `${missionPct}%`,
              background: "var(--conn-amber-text,#f59e0b)",
            }}
            title={`Mission: ${missionPct.toFixed(0)}%`}
          />
        )}
        <div
          style={{
            width: `${userPct}%`,
            background: "var(--conn-green-text,#10b981)",
          }}
          title={`User: ${userPct.toFixed(0)}%`}
        />
      </div>
      <div
        className="mt-0.5 flex gap-3 text-[10px]"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        {nativePct > 0 && (
          <span>
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--conn-purple-text,#a855f7)",
                marginRight: "4px",
              }}
            />
            Native L0 {nativePct.toFixed(0)}%
          </span>
        )}
        <span>
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--conn-blue-text,#3b82f6)",
              marginRight: "4px",
            }}
          />
          System {sysPct.toFixed(0)}%
        </span>
        {missionPct > 0 && (
          <span>
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--conn-amber-text,#f59e0b)",
                marginRight: "4px",
              }}
            />
            Mission {missionPct.toFixed(0)}%
          </span>
        )}
        <span>
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--conn-green-text,#10b981)",
              marginRight: "4px",
            }}
          />
          User {userPct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PromptSection                                                       */
/* ------------------------------------------------------------------ */

function PromptSection({
  content,
  label,
  className = "",
}: {
  content: string;
  label: string;
  className?: string;
}) {
  if (!content) {
    return (
      <div
        className="text-[10px]"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        Empty
      </div>
    );
  }
  return (
    <div className={className}>
      <div
        className="mb-1 text-[10px] font-medium"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        {label}
      </div>
      <pre
        className="whitespace-pre-wrap break-words rounded p-2 font-mono text-[10px] leading-relaxed"
        style={{
          background: "var(--cafe-surface,#1e1f26)",
          color: "var(--cafe-text,#e5e7eb)",
        }}
      >
        {content}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PromptMeta                                                          */
/* ------------------------------------------------------------------ */

function PromptMeta({ capture }: { capture: PromptCaptureData }) {
  const { injectionDecision } = capture;
  return (
    <div className="space-y-2 text-[10px]">
      <div>
        <div className="font-medium" style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
          Capture Info
        </div>
        <div className="ml-2 space-y-0.5">
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              captureId:
            </span>{" "}
            <span className="font-mono">{capture.captureId}</span>
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              invocationId:
            </span>{" "}
            <span className="font-mono">{capture.invocationId}</span>
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              forgekinId:
            </span>{" "}
            {capture.catId}
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              model:
            </span>{" "}
            {capture.model}
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              captured:
            </span>{" "}
            {new Date(capture.capturedAt).toLocaleString()}
          </div>
        </div>
      </div>
      <div>
        <div className="font-medium" style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
          Injection Decision
        </div>
        <div className="ml-2 space-y-0.5">
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              injected:
            </span>{" "}
            <span
              style={{
                color: injectionDecision.injected
                  ? "var(--conn-green-text,#10b981)"
                  : "var(--conn-red-text,#ef4444)",
              }}
            >
              {String(injectionDecision.injected)}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              isResume:
            </span>{" "}
            {String(injectionDecision.isResume)}
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              canSkipOnResume:
            </span>{" "}
            {String(injectionDecision.canSkipOnResume)}
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              forceReinjection:
            </span>{" "}
            {String(injectionDecision.forceReinjection)}
          </div>
        </div>
      </div>
      <div>
        <div className="font-medium" style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
          Size
        </div>
        <div className="ml-2 space-y-0.5">
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              bytes:
            </span>{" "}
            {capture.promptBytes.toLocaleString()}
          </div>
          <div>
            <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
              tokens · message (est):
            </span>{" "}
            ~{capture.tokenEstimate.toLocaleString()}
          </div>
          {capture.nativeSystemTokenEstimate !== undefined && (
            <div>
              <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
                tokens · native L0 (est):
              </span>{" "}
              ~{capture.nativeSystemTokenEstimate.toLocaleString()}
              {capture.nativeSystemPromptSource && (
                <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
                  {" "}
                  ({capture.nativeSystemPromptSource})
                </span>
              )}
            </div>
          )}
          {capture.totalTokenEstimate !== undefined &&
            capture.totalTokenEstimate !== capture.tokenEstimate && (
              <div>
                <span style={{ color: "var(--cafe-text-muted,#6b7280)" }}>
                  tokens · total (est):
                </span>{" "}
                ~{capture.totalTokenEstimate.toLocaleString()}
              </div>
            )}
        </div>
      </div>
      {capture.captureDiagnostics && capture.captureDiagnostics.length > 0 && (
        <div>
          <div
            className="font-medium"
            style={{ color: "var(--cafe-text-muted,#6b7280)" }}
          >
            Capture Diagnostics
          </div>
          <ul className="ml-3 list-disc space-y-0.5">
            {capture.captureDiagnostics.map((d, i) => (
              <li key={`${d}-${i}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StepSummaryPanel — F153 Phase I                                     */
/* ------------------------------------------------------------------ */

function StepSummaryPanel({
  traceId,
  routeSpanId,
}: {
  traceId: string;
  routeSpanId?: string;
}) {
  const [data, setData] = useState<StepSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    const qs = new URLSearchParams({ traceId });
    if (routeSpanId) qs.set("routeSpanId", routeSpanId);

    fetch(`/api/v1/telemetry/step-summary?${qs.toString()}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          return;
        }
        const json = (await res.json().catch(() => null)) as StepSummaryData | null;
        setData(json);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [traceId, routeSpanId]);

  if (loading) {
    return (
      <div
        className="text-[10px]"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        加载 Step Summary...
      </div>
    );
  }
  if (!data) return null;

  const fmt = (n: number | null): string =>
    n === null ? "—" : n.toString();

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--cafe-border,#2a2c3a)",
        background: "var(--cafe-surface-elevated,#15151c)",
      }}
      data-hub-step-summary={traceId}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-xs font-medium"
          style={{ color: "var(--cafe-text,#e5e7eb)" }}
        >
          Step Summary
        </span>
        {data.is_restored && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px]"
            style={{
              background: "var(--cafe-surface,#1e1f26)",
              color: "var(--cafe-text-muted,#6b7280)",
            }}
          >
            Restored (history)
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StepCell
          label="Agent loops"
          value={
            data.agent_loop_partial
              ? `${fmt(data.agent_loop_count)}+`
              : fmt(data.agent_loop_count)
          }
          primary
        />
        <StepCell label="Tool calls" value={fmt(data.tool_call_count)} />
        <StepCell label="A2A dispatch" value={fmt(data.a2a_dispatch_count)} />
        <StepCell label="Duration" value={`${data.duration_ms.toFixed(0)} ms`} />
        <StepCell label="Tokens" value={data.token_total.toLocaleString()} />
        <StepCell label="Errors" value={data.error_count.toString()} />
      </div>
      <div
        className="mt-2 border-t pt-2 text-[10px]"
        style={{
          borderColor: "var(--cafe-border,#2a2c3a)",
          color: "var(--cafe-text-muted,#6b7280)",
        }}
      >
        Length × Width = {fmt(data.agent_loop_count)} loop ×{" "}
        {data.width_avg_tools_per_loop != null
          ? `${data.width_avg_tools_per_loop.toFixed(1)} tools/loop`
          : "—"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StepCell                                                            */
/* ------------------------------------------------------------------ */

function StepCell({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px]"
        style={{ color: "var(--cafe-text-muted,#6b7280)" }}
      >
        {label}
      </div>
      <div
        className={`font-mono text-xs ${primary ? "font-semibold" : ""}`}
        style={{
          color: primary
            ? "var(--cafe-text,#e5e7eb)"
            : "var(--cafe-text,#e5e7eb)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default TraceBrowser;
