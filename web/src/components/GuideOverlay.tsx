/**
 * GuideOverlay — 引导覆盖层
 *
 * 来源：clowder-ai/packages/web/src/components/GuideOverlay.tsx（简化版）
 * 职责：首次访问应用时显示引导教程，引导用户认识 4 种聊天模式、智能体管理、设置中心
 *
 * 设计原则：
 *   - 通过 localStorage 记录用户是否完成引导
 *   - 支持"跳过"和"下一步"
 *   - 高亮目标元素（通过 data-guide-id 属性匹配）
 *   - 不阻塞应用渲染（半透明覆盖层 + 高亮目标）
 */

"use client";

import { useEffect, useState, useCallback } from "react";

interface GuideStep {
  id: string;
  /** 目标元素的 data-guide-id */
  target?: string;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 高亮位置（如果无 target，则居中显示） */
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "welcome",
    title: "欢迎使用 FlowForge",
    content: "FlowForge 是 AI Agent 操作系统。本引导将带您认识核心功能（约 1 分钟）。",
    placement: "center",
  },
  {
    id: "helm-studio",
    target: "nav.helm-studio",
    title: "对话 — 4 种聊天模式",
    content: "支持普通工作流、AI 自主规划（Helm）、全自动、群聊（5 个可进化智能体协作）4 种模式。",
    placement: "right",
  },
  {
    id: "agents",
    target: "nav.agents",
    title: "智能体管理",
    content: "区分可进化智能体（Forgekin，具备持久身份、经验记忆、能力画像）与静态智能体（Static Agent）。",
    placement: "right",
  },
  {
    id: "settings",
    target: "hub.trigger",
    title: "设置中心",
    content: "14 个设置分区：成员管理、能力画像、账户密钥、IM 对接、Skill、MCP、插件、能力市场等。",
    placement: "left",
  },
  {
    id: "brake",
    title: "紧急刹车",
    content: "按 Ctrl+Shift+Esc（macOS: Cmd+Shift+Esc）可触发紧急刹车，中断所有正在执行的任务。",
    placement: "center",
  },
];

const STORAGE_KEY = "flowforge-guide-completed";

export function GuideOverlay() {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const completed = window.localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // 延迟 1 秒显示，等应用渲染完成
      const timer = window.setTimeout(() => setVisible(true), 1000);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // 查找目标元素位置
  useEffect(() => {
    if (!visible) return;
    const step = GUIDE_STEPS[stepIndex];
    if (!step?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-guide-id="${step.target}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [visible, stepIndex]);

  const handleNext = useCallback(() => {
    if (stepIndex < GUIDE_STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      handleComplete();
    }
  }, [stepIndex]);

  const handleSkip = useCallback(() => {
    handleComplete();
  }, []);

  const handleComplete = useCallback(() => {
    setVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
  }, []);

  if (!visible) return null;

  const step = GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === GUIDE_STEPS.length - 1;

  // 计算引导框位置
  let tooltipStyle: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    maxWidth: "400px",
  };

  if (targetRect && step.placement !== "center") {
    const spacing = 16;
    switch (step.placement) {
      case "right":
        tooltipStyle = {
          position: "fixed",
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.right + spacing,
          transform: "translateY(-50%)",
          maxWidth: "320px",
        };
        break;
      case "left":
        tooltipStyle = {
          position: "fixed",
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.left - spacing,
          transform: "translate(-100%, -50%)",
          maxWidth: "320px",
        };
        break;
      case "bottom":
        tooltipStyle = {
          position: "fixed",
          top: targetRect.bottom + spacing,
          left: targetRect.left + targetRect.width / 2,
          transform: "translateX(-50%)",
          maxWidth: "320px",
        };
        break;
      case "top":
        tooltipStyle = {
          position: "fixed",
          top: targetRect.top - spacing,
          left: targetRect.left + targetRect.width / 2,
          transform: "translate(-50%, -100%)",
          maxWidth: "320px",
        };
        break;
    }
  }

  return (
    <>
      {/* 半透明覆盖层 + 高亮目标 */}
      {targetRect ? (
        <div
          className="fixed inset-0 z-[9995] pointer-events-none"
          style={{
            background: `rgba(0,0,0,0.6)`,
            clipPath: `polygon(0% 0%, 0% 100%, ${targetRect.left}px 100%, ${targetRect.left}px ${targetRect.top}px, ${targetRect.right}px ${targetRect.top}px, ${targetRect.right}px ${targetRect.bottom}px, ${targetRect.left}px ${targetRect.bottom}px, ${targetRect.left}px 100%, 100% 100%, 100% 0%)`,
          }}
          data-guide-overlay="true"
        />
      ) : (
        <div
          className="fixed inset-0 z-[9995]"
          style={{ background: "rgba(0,0,0,0.6)" }}
          data-guide-overlay="true"
        />
      )}

      {/* 引导气泡 */}
      <div
        className="z-[9996] bg-[var(--cafe-surface)] text-[var(--cafe-text)] rounded-lg shadow-2xl p-5"
        style={tooltipStyle}
        data-guide-tooltip="true"
        role="dialog"
        aria-labelledby="guide-title"
      >
        <div className="flex items-start justify-between mb-3">
          <h3 id="guide-title" className="text-base font-bold">
            {step.title}
          </h3>
          <span className="text-xs opacity-60 ml-2">
            {stepIndex + 1} / {GUIDE_STEPS.length}
          </span>
        </div>
        <p className="text-sm mb-5 leading-relaxed">{step.content}</p>
        <div className="flex justify-between items-center">
          <button
            onClick={handleSkip}
            className="text-xs opacity-60 hover:opacity-100"
            data-guide-skip="true"
          >
            跳过引导
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-1.5 text-sm rounded-md bg-[var(--cafe-accent)] text-[var(--cafe-accent-foreground)] hover:bg-[var(--cafe-accent-hover)]"
            data-guide-next="true"
          >
            {isLast ? "完成" : "下一步"}
          </button>
        </div>
      </div>
    </>
  );
}

export default GuideOverlay;
