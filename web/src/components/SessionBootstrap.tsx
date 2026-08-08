/**
 * SessionBootstrap — 会话引导组件
 *
 * 来源：clowder-ai/packages/web/src/components/SessionBootstrap.tsx（简化版）
 * 职责：在应用启动时拉取会话基础数据（用户信息、配置、待审批计数）
 *
 * 设计原则：
 *   - 不渲染任何 UI（返回 null）
 *   - 只在客户端执行（"use client"）
 *   - 失败不阻塞应用启动（仅打日志）
 */

"use client";

import { useEffect } from "react";
import { useApprovalHubStore } from "@/stores/approvalHubStore";

export function SessionBootstrap() {
  const fetchPending = useApprovalHubStore((s) => s.fetchPending);

  useEffect(() => {
    // 拉取待审批数量（用于 ActivityBar 铃铛 badge）
    fetchPending().catch((err) => {
      console.warn("[SessionBootstrap] fetchPending failed:", err);
    });

    // 监听 approval 事件（SSE 或 WebSocket，后续 Phase 6 接入）
    const handleApprovalEvent = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail;
        if (detail?.type === "approval_new") {
          fetchPending();
        }
      } catch (err) {
        console.warn("[SessionBootstrap] approval event handler failed:", err);
      }
    };

    window.addEventListener("flowforge:approval", handleApprovalEvent as EventListener);
    return () => {
      window.removeEventListener("flowforge:approval", handleApprovalEvent as EventListener);
    };
  }, [fetchPending]);

  return null;
}

export default SessionBootstrap;
