"use client";

/**
 * GlobalThreadDrawer — 全局会话列表抽屉
 *
 * 从左侧滑入的浮动面板，显示所有群聊会话列表。
 * 可从 ActivityBar 的"群聊"图标长按或点击抽屉按钮触发。
 * 在任意路由下都可用，不限于 /council。
 *
 * 参考 clowder-ai 的 ThreadSidebar 全局可见设计。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useThreadDrawerStore } from "@/stores/threadDrawerStore";
import { useThreadStore } from "@/stores/threadStore";
import dynamic from "next/dynamic";

// 性能优化：CouncilThreadList 动态导入（仅在抽屉打开时加载）
const CouncilThreadList = dynamic(
  () => import("./helm/CouncilThreadList").then((m) => m.CouncilThreadList),
  { ssr: false, loading: () => <div style={{ padding: "20px", color: "var(--muted)", fontSize: "12px" }}>加载会话列表...</div> }
);

export default function GlobalThreadDrawer() {
  const isOpen = useThreadDrawerStore((s) => s.isOpen);
  const close = useThreadDrawerStore((s) => s.close);
  const router = useRouter();
  const { loadThreads } = useThreadStore();

  // 打开时加载会话列表
  useEffect(() => {
    if (isOpen) {
      loadThreads();
    }
  }, [isOpen, loadThreads]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩层 — 点击关闭 */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={close}
        aria-hidden="true"
      />

      {/* 抽屉面板 */}
      <div
        className="fixed left-[52px] top-0 bottom-0 z-41 flex flex-col"
        style={{
          width: "280px",
          background: "var(--bg)",
          borderRight: "1px solid var(--border)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.2)",
          animation: "slideIn 0.2s ease-out",
        }}
        role="dialog"
        aria-label="会话列表"
      >
        {/* 抽屉头部 */}
        <div
          className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--accent)" }}
          >
            ◎ 群聊会话
          </span>
          <button
            onClick={close}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              fontSize: "14px",
            }}
            title="关闭"
            aria-label="关闭会话列表"
          >
            ✕
          </button>
        </div>

        {/* 会话列表 — 复用 CouncilThreadList */}
        <div className="flex-1 overflow-hidden">
          <CouncilThreadList
            currentThreadId={null}
            className="h-full"
            onThreadSelect={(threadId) => {
              router.push(`/council/${threadId}`);
              close();
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
