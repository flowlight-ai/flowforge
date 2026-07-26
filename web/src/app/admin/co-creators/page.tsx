"use client";

import { HubCoCreatorEditor } from "@/components/hub/HubCoCreatorEditor";

/**
 * 共创管理页面 — 使用 HubCoCreatorEditor
 *
 * 功能：
 *   - 可进化智能体共创关系管理
 *   - 角色权限分配（Owner/Editor/Viewer）
 *   - 共创者增删改
 *
 * 依据 WEB-FUSION-DESIGN.md §8：移植自 clowder-ai HubCoCreatorEditor。
 */

export default function CoCreatorsPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>共创管理</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          可进化智能体共创关系、角色权限、共创者管理 · HubCoCreatorEditor
        </p>
        <HubCoCreatorEditor />
      </div>
    </div>
  );
}
