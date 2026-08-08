"use client";

import { HubGovernanceTab } from "@/components/hub/HubGovernanceTab";

/**
 * 治理中心页面 — 使用 HubGovernanceTab
 *
 * 功能：
 *   - 治理规则（VISION.md 七条愿景锚点）
 *   - 合规审计
 *   - 价值锚点 + Magic Words 逃生舱
 *
 * 依据 WEB-FUSION-DESIGN.md §8：移植自 clowder-ai HubGovernanceTab。
 */

export default function GovernancePage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>治理中心</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          治理规则、合规审计、价值锚点 · HubGovernanceTab
        </p>
        <HubGovernanceTab />
      </div>
    </div>
  );
}
