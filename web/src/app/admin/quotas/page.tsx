"use client";

import { HubQuotaBoardTab } from "@/components/hub/HubQuotaBoardTab";

/**
 * 配额看板页面 — 使用 HubQuotaBoardTab
 *
 * 功能：
 *   - Token 配额监控（按日/周/月）
 *   - 调用限制
 *   - 用量统计（按可进化智能体/模型细分）
 *   - 超配额降级策略
 *
 * 依据 WEB-FUSION-DESIGN.md §8：移植自 clowder-ai HubQuotaBoardTab。
 */

export default function QuotasPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>配额看板</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          Token 配额、调用限制、用量统计 · HubQuotaBoardTab
        </p>
        <HubQuotaBoardTab />
      </div>
    </div>
  );
}
