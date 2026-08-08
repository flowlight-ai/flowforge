"use client";

import { HubEnvFilesTab } from "@/components/hub/HubEnvFilesTab";

/**
 * 环境文件管理页面 — 使用 HubEnvFilesTab
 *
 * 功能：
 *   - .env 配置文件清单
 *   - 环境变量编辑（含敏感变量脱敏）
 *   - 存储模式提示（Redis/内存）
 *
 * 依据 WEB-FUSION-DESIGN.md §8：移植自 clowder-ai HubEnvFilesTab。
 */

export default function EnvPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>环境文件</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          .env 配置、环境变量、存储模式 · HubEnvFilesTab
        </p>
        <HubEnvFilesTab />
      </div>
    </div>
  );
}
