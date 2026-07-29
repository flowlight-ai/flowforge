"use client";

import { useState, useEffect } from "react";

/**
 * IM 对接页面 — 来自 clowder-ai im section
 *
 * 功能：
 *   - 飞书机器人
 *   - 钉钉应用
 *   - 企业微信应用
 *   - 消息双向同步（群聊触发任务、结果推送）
 */
export default function ImPage() {
  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>IM 对接</h2>
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
          飞书、钉钉、企微和外部消息入口 · 来自 clowder-ai im section
        </p>
        <div className="empty">暂无数据 · 功能开发中</div>
        <div style={{ marginTop: "16px", padding: "12px 16px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
          <strong style={{ color: "#a78bfa" }}>💡 说明</strong>
          <div style={{ marginTop: "4px", lineHeight: 1.5 }}>
            IM 对接管理 FlowForge 与外部即时通讯平台的连接。支持飞书机器人、钉钉应用、企业微信应用。消息可双向同步，支持群聊触发任务、任务结果推送。
          </div>
        </div>
      </div>
    </div>
  );
}
