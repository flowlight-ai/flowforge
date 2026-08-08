"use client";

import { HubToolUsageTab } from "@/components/hub/HubToolUsageTab";

/**
 * 工具使用统计页面 — 使用 HubToolUsageTab
 *
 * 功能：
 *   - 工具调用次数统计
 *   - 成功率与平均耗时
 *   - 按工具分类（rag/publish/search/exec/io）
 *
 * 依据 WEB-FUSION-DESIGN.md §8：移植自 clowder-ai HubToolUsageTab。
 */

export default function ToolsPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>工具使用统计</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          工具调用次数、成功率、平均耗时 · HubToolUsageTab
        </p>
        <HubToolUsageTab />
      </div>
    </div>
  );
}
