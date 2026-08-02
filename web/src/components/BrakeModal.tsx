/**
 * BrakeModal — 紧急刹车模态框
 *
 * 职责：监听全局 "flowforge:brake" 事件，弹出紧急刹车确认框
 * 用户确认后调用 /api/v1/brake 触发后端紧急停止所有任务
 *
 * 触发场景：
 *   - 后端检测到严重异常（如 LLM 越狱、成本超限）主动推送
 *   - 用户手动触发（Cmd+Shift+Esc 快捷键）
 *   - 审批被拒绝达到阈值
 *
 * 设计原则：
 *   - 全局只挂载一个（在 RootLayout 中）
 *   - 不阻塞应用渲染，只在事件触发时显示
 *   - 必须二次确认（防止误触）
 */

"use client";

import { useEffect, useState } from "react";

interface BrakeEventData {
  reason?: string;
  severity?: "low" | "medium" | "high" | "critical";
  source?: string;
  timestamp?: number;
}

export function BrakeModal() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BrakeEventData | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail as BrakeEventData;
        setData(detail);
        setOpen(true);
      } catch (err) {
        console.warn("[BrakeModal] event handler failed:", err);
      }
    };
    window.addEventListener("flowforge:brake", handler as EventListener);

    // 快捷键 Cmd+Shift+Esc（macOS）/ Ctrl+Shift+Esc（Windows）
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Escape") {
        e.preventDefault();
        setData({ reason: "手动触发紧急刹车", severity: "high", source: "keyboard", timestamp: Date.now() });
        setOpen(true);
      }
    };
    document.addEventListener("keydown", keyHandler);

    return () => {
      window.removeEventListener("flowforge:brake", handler as EventListener);
      document.removeEventListener("keydown", keyHandler);
    };
  }, []);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await fetch("/api/v1/brake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: data?.reason, source: data?.source }),
      });
    } catch (err) {
      console.error("[BrakeModal] brake API failed:", err);
    } finally {
      setConfirming(false);
      setOpen(false);
      setData(null);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setData(null);
  };

  if (!open || !data) return null;

  const severityColor =
    data.severity === "critical"
      ? "#dc2626"
      : data.severity === "high"
      ? "#ea580c"
      : data.severity === "medium"
      ? "#ca8a04"
      : "#0891b2";

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      data-brake-overlay="true"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="brake-title"
    >
      <div
        className="bg-[var(--cafe-surface)] text-[var(--cafe-text)] rounded-lg shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
        data-brake-dialog="true"
      >
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{ background: severityColor, color: "white" }}
        >
          <span className="text-2xl" aria-hidden="true">🛑</span>
          <h2 id="brake-title" className="text-lg font-bold">
            紧急刹车 — Severity: {data.severity || "unknown"}
          </h2>
        </div>
        <div className="p-6">
          <p className="text-sm mb-4" data-brake-reason="true">
            <strong>原因：</strong>
            {data.reason || "未指定原因"}
          </p>
          {data.source && (
            <p className="text-xs mb-4 opacity-70">
              来源：{data.source}
              {data.timestamp && ` · ${new Date(data.timestamp).toLocaleString("zh-CN")}`}
            </p>
          )}
          <p className="text-xs mb-6 opacity-70">
            确认后将向后端发送紧急停止信号，所有正在执行的任务将被中断。
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm rounded-md border border-[var(--cafe-border)]"
              data-brake-cancel="true"
              disabled={confirming}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm rounded-md text-white"
              style={{ background: severityColor }}
              data-brake-confirm="true"
              disabled={confirming}
            >
              {confirming ? "执行中..." : "确认刹车"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BrakeModal;
