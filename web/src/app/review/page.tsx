"use client";

import { HubEvalTab } from "@/components/hub/HubEvalTab";

/**
 * 审核中心页面 — 使用 HubEvalTab（内含 HubEvalVerdictCard）
 *
 * 功能：
 *   - 评估任务列表（可进化智能体产出物）
 *   - 质量/摩擦分数展示
 *   - 判决提交（通过/驳回/重做）
 *
 * 整合 HubEvalTab + HubEvalVerdictCard。
 * HubEvalTab 在选中任务后内部渲染 HubEvalVerdictCard。
 */

export default function ReviewCenterPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>评估中心</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          可进化智能体产出评估、质量审核、判决提交 · HubEvalTab
        </p>
        <HubEvalTab />
      </div>
    </div>
  );
}
