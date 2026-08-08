"use client";

/**
 * /memory — 记忆中心主页（默认 feed 动态视图）
 *
 * 使用 MemoryHub 容器，feed tab 展示最近召回流（简化版）。
 */

import { MemoryHub } from "@/components/memory";

export default function MemoryHomePage() {
  return (
    <MemoryHub activeTab="feed">
      <div className="card" data-memory="feed">
        <h2 className="page-title" style={{ margin: "0 0 4px 0" }}>记忆动态</h2>
        <p className="page-sub" style={{ marginBottom: "12px" }}>
          最近的索引事件、召回与异常 · 选择左侧导航查看更多视图
        </p>
        <div
          data-memory="feed-empty"
          style={{
            padding: "40px",
            textAlign: "center",
            color: "var(--muted)",
            background: "var(--bg-elevated)",
            border: "1px dashed var(--border-strong)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div style={{ fontSize: "24px", marginBottom: "8px" }}>◉</div>
          动态流稍后在此呈现 · 使用左侧导航进入其他视图
        </div>
      </div>
    </MemoryHub>
  );
}
