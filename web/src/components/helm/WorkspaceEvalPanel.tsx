"use client";

/**
 * WorkspaceEvalPanel — 评估中心
 *
 * 生命周期 / friction / routing / paw-feel 评估指标
 * 对应 clowder-ai 的 eval 模块
 */

import { useState, useEffect } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface EvalMetric {
  id: string;
  name: string;
  value: number;
  max: number;
  unit: string;
  trend: "up" | "down" | "stable";
  description: string;
}

interface EvalCategory {
  id: string;
  name: string;
  icon: string;
  metrics: EvalMetric[];
}

// ── 指标条 ─────────────────────────────────────────────────────────

function MetricBar({
  metric,
  color,
}: {
  metric: EvalMetric;
  color: string;
}) {
  const pct = Math.min((metric.value / metric.max) * 100, 100);
  const trendIcons = { up: "↑", down: "↓", stable: "→" };
  const trendColors = { up: "var(--ok)", down: "var(--destructive)", stable: "var(--muted)" };

  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text)" }}>{metric.name}</span>
          <span
            style={{
              fontSize: "10px",
              color: trendColors[metric.trend],
              fontWeight: 600,
            }}
            title={metric.trend === "up" ? "上升" : metric.trend === "down" ? "下降" : "稳定"}
          >
            {trendIcons[metric.trend]}
          </span>
        </div>
        <span style={{ fontSize: "11px", fontWeight: 600, color, fontFamily: "var(--mono)" }}>
          {metric.value}{metric.unit}
        </span>
      </div>
      <div
        style={{
          height: "6px",
          borderRadius: "3px",
          background: "var(--bg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: "3px",
            background: color,
            transition: "width 0.5s ease",
            opacity: 0.8,
          }}
        />
      </div>
      <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
        {metric.description}
      </div>
    </div>
  );
}

// ── 评估类别卡片 ───────────────────────────────────────────────────

function EvalCategoryCard({ category }: { category: EvalCategory }) {
  const categoryColors: Record<string, string> = {
    lifecycle: "var(--chart-1)",
    friction: "var(--chart-2)",
    routing: "var(--chart-3)",
    paw_feel: "var(--chart-4)",
  };
  const color = categoryColors[category.id] || "var(--accent)";

  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "var(--radius-md, 8px)",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <span style={{ fontSize: "16px" }}>{category.icon}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>{category.name}</span>
      </div>
      {category.metrics.map((metric) => (
        <MetricBar key={metric.id} metric={metric} color={color} />
      ))}
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface EvalPanelProps {
  threadId?: string | null;
}

export default function WorkspaceEvalPanel({ threadId }: EvalPanelProps) {
  const [categories, setCategories] = useState<EvalCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (threadId) params.set("threadId", threadId);

    fetch(`/api/v1/eval/metrics?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.categories) {
          setCategories(data.categories);
        } else if (data?.metrics) {
          // 按类别分组
          const grouped: Record<string, EvalMetric[]> = {};
          data.metrics.forEach((m: EvalMetric & { category?: string }) => {
            const cat = m.id.split("_")[0] || "general";
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(m);
          });
          // 如果无数据，使用默认示例数据
          setCategories([
            {
              id: "lifecycle",
              name: "生命周期",
              icon: "🔄",
              metrics: grouped["lifecycle"] || [
                { id: "lifecycle_avg_duration", name: "平均持续时间", value: 2.4, max: 10, unit: "s", trend: "down", description: "任务平均执行时长" },
                { id: "lifecycle_completion", name: "完成率", value: 87, max: 100, unit: "%", trend: "up", description: "任务成功完成百分比" },
                { id: "lifecycle_throughput", name: "吞吐量", value: 142, max: 200, unit: "/h", trend: "stable", description: "每小时完成任务数" },
              ],
            },
            {
              id: "friction",
              name: "Friction",
              icon: "⚡",
              metrics: grouped["friction"] || [
                { id: "friction_rate", name: "摩擦率", value: 12, max: 100, unit: "%", trend: "down", description: "用户遇到问题的比例" },
                { id: "friction_retry", name: "重试率", value: 8, max: 100, unit: "%", trend: "down", description: "需要重试的请求比例" },
                { id: "friction_blocked", name: "阻塞率", value: 3, max: 100, unit: "%", trend: "stable", description: "无法自动处理的任务比例" },
              ],
            },
            {
              id: "routing",
              name: "路由",
              icon: "🔀",
              metrics: grouped["routing"] || [
                { id: "routing_accuracy", name: "路由准确率", value: 94, max: 100, unit: "%", trend: "up", description: "正确路由到目标的比例" },
                { id: "routing_latency", name: "路由延迟", value: 350, max: 1000, unit: "ms", trend: "down", description: "路由决策平均耗时" },
                { id: "routing_fallback", name: "降级率", value: 5, max: 100, unit: "%", trend: "stable", description: "触发降级路由的比例" },
              ],
            },
            {
              id: "paw_feel",
              name: "Paw Feel",
              icon: "🐾",
              metrics: grouped["paw_feel"] || [
                { id: "paw_feel_satisfaction", name: "满意度", value: 4.2, max: 5, unit: "", trend: "up", description: "用户满意度评分 (1-5)" },
                { id: "paw_feel_response", name: "响应质量", value: 4.5, max: 5, unit: "", trend: "stable", description: "响应质量评分 (1-5)" },
                { id: "paw_feel_nps", name: "NPS", value: 72, max: 100, unit: "", trend: "up", description: "净推荐值" },
              ],
            },
          ]);
        } else {
          setError(null);
          setCategories([]);
        }
      })
      .catch(() => setError("无法加载评估数据"))
      .finally(() => setLoading(false));
  }, [threadId]);

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载评估数据...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--destructive)", fontSize: "12px" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "14px" }}>📊</span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>评估中心</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {categories.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
              暂无评估数据
            </div>
          ) : (
            categories.map((cat) => (
              <EvalCategoryCard key={cat.id} category={cat} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}