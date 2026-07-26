"use client";

/**
 * ModeSelector — Solo 模式选择器（精简版）
 *
 * 重构说明：
 *   - 原 4 模式（normal/helm/auto/council）精简为 1 模式（仅 helm）
 *   - 原因：normal 和 auto 模式无实际价值，已废弃
 *   - 群聊（council）已迁移到独立路由 /council，使用 clowder-ai 移植的 UI 框架
 *   - /solo 路由现专注于单 Agent 的 Helm 模式（AI 自主规划执行）
 *
 * 兼容性：
 *   - 仍接受 HelmMode 类型，但渲染时仅显示 helm 按钮
 *   - URL 参数 ?mode=council 会触发 /solo → /council 的重定向（在 HelmLayout 中处理）
 *   - 旧 ?mode=normal 或 ?mode=auto 会被静默映射为 helm
 */

import { useEffect, useState } from "react";

export type HelmMode = "normal" | "helm" | "auto" | "council";

interface ModeSelectorProps {
  mode: HelmMode;
  onModeChange: (mode: HelmMode) => void;
  /** 已废弃：原 normal 模式的工作流选择器，保留 prop 兼容性 */
  selectedWorkflow?: string | null;
  onWorkflowChange?: (wf: string | null) => void;
}

interface WorkflowItem {
  name: string;
  display_name: string;
  description: string;
}

const MODE_DESC: Record<HelmMode, string> = {
  normal: "已废弃 — 自动切换到 Helm 模式",
  helm: "AI 自主规划执行（可进化智能体）",
  auto: "已废弃 — 自动切换到 Helm 模式",
  council: "已迁移到 /council 独立路由",
};

export default function ModeSelector({
  mode,
  onModeChange,
  selectedWorkflow: _selectedWorkflow,
  onWorkflowChange: _onWorkflowChange,
}: ModeSelectorProps) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

  useEffect(() => {
    fetch("/api/v1/graph/workflows")
      .then((r) => r.json())
      .then((data) => setWorkflows(Array.isArray(data) ? data : []))
      .catch(() => setWorkflows([]));
  }, []);

  // 兼容性处理：若外部传入 normal/auto/council，静默映射为 helm
  useEffect(() => {
    if (mode !== "helm") {
      onModeChange("helm");
    }
  }, [mode, onModeChange]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_80%,transparent)]"
      data-mode-selector="container"
    >
      <div className="flex gap-1 bg-[var(--bg-hover)] rounded-lg p-1" data-mode-selector="tabs">
        <button
          onClick={() => onModeChange("helm")}
          className="px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-[var(--accent)] text-white shadow-sm"
          title={MODE_DESC.helm}
          data-mode="helm"
          data-active="true"
          aria-current="page"
        >
          Helm
        </button>
      </div>

      <span className="text-xs text-[var(--muted)] ml-auto" data-mode-selector-hint="true">
        {MODE_DESC.helm}
      </span>

      {/* 隐藏的工作流数据加载（保留用于未来扩展） */}
      {workflows.length > 0 && (
        <span className="sr-only" data-mode-selector-workflows-count={workflows.length}>
          {workflows.length} workflows available
        </span>
      )}
    </div>
  );
}
