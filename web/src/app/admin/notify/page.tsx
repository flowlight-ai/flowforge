"use client";

import { useState, useEffect } from "react";

/**
 * 通知设置页面 — 
 *
 * 功能：
 *   - 推送订阅
 *   - 提醒策略（任务完成/错误告警/配额预警/审核提醒）
 *   - 多通道推送（IM、邮件、Webhook）
 *   - 设备联动
 */
export default function NotifyPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>通知设置</h2>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "6px 14px", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600,
            }}
          >
            🔄 刷新
          </button>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          推送订阅、提醒策略、设备联动 · 
        </p>
        <div className="empty">暂无数据 · 功能开发中</div>
        <div style={{ marginTop: "16px", padding: "12px 16px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
          <strong style={{ color: "#a78bfa" }}>💡 说明</strong>
          <div style={{ marginTop: "4px", lineHeight: 1.5 }}>
            通知设置管理 FlowForge 的消息推送策略。包括任务完成通知、错误告警、配额预警、审核提醒。支持多通道推送（IM、邮件、Webhook）。
          </div>
        </div>
      </div>
    </div>
  );
}
