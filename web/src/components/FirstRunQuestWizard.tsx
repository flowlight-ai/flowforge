"use client";

/**
 * FirstRunQuestWizard — 首次访问引导（简化版）
 *
 * 引导新用户完成基础配置：选择身份、配置模型 Provider、创建首个 Forgekin。
 * 移植自 clowder-ai FirstRunQuestWizard，简化为单卡片多步骤向导。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 控制项：localStorage 标记 "flowforge.firstrun.done" 防止重复弹出。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "flowforge.firstrun.done";

type Step = 0 | 1 | 2 | 3;

interface WizardProps {
  readonly onClose?: () => void;
  readonly forceOpen?: boolean;
}

export function FirstRunQuestWizard({ onClose, forceOpen = false }: WizardProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [role, setRole] = useState<"creator" | "developer" | "operator" | "">("");

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      if (!done) setOpen(true);
    } catch {
      // localStorage 不可用时静默忽略
    }
  }, [forceOpen]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // 忽略写入失败
    }
    onClose?.();
  }, [onClose]);

  const next = useCallback(() => setStep((s) => (Math.min(3, s + 1) as Step)), []);
  const prev = useCallback(() => setStep((s) => (Math.max(0, s - 1) as Step)), []);

  if (!open) return null;

  return (
    <div
      data-firstrun="wizard"
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--bg) 80%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          padding: "24px",
          maxWidth: "520px",
          width: "100%",
          boxShadow: "var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.2))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--fg)" }}>
            欢迎使用 FlowForge · 第 {step + 1}/4 步
          </h2>
          <button
            onClick={close}
            data-firstrun-action="close"
            aria-label="关闭"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: "18px",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          data-firstrun="progress"
          style={{
            display: "flex",
            gap: "4px",
            marginBottom: "16px",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: "3px",
                borderRadius: "2px",
                background: i <= step ? "var(--accent)" : "var(--border)",
              }}
            />
          ))}
        </div>

        {step === 0 && (
          <div data-firstrun-step="role">
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "12px" }}>
              选择你的主要角色，我们将推荐对应的工作流模板。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {[
                { id: "creator", label: "内容创作者", icon: "✎" },
                { id: "developer", label: "开发者", icon: "⚙" },
                { id: "operator", label: "运营者", icon: "◈" },
              ].map((r) => (
                <button
                  key={r.id}
                  data-firstrun-role={r.id}
                  onClick={() => setRole(r.id as typeof role)}
                  style={{
                    padding: "12px",
                    background: role === r.id ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "var(--bg)",
                    border: `1px solid ${role === r.id ? "var(--accent)" : "var(--border-strong)"}`,
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                    color: role === r.id ? "var(--accent)" : "var(--fg)",
                  }}
                >
                  <span style={{ fontSize: "20px" }}>{r.icon}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>{r.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div data-firstrun-step="provider">
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "12px" }}>
              前往「管理中心 → Provider」配置你的首个 LLM Provider。
            </p>
            <Link
              href="/admin/models"
              data-firstrun-link="models"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              打开 Provider 配置 →
            </Link>
          </div>
        )}

        {step === 2 && (
          <div data-firstrun-step="forgekin">
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "12px" }}>
              前往「管理中心 → 智能体」创建你的首个可进化智能体（Forgekin）。
            </p>
            <Link
              href="/admin/agents"
              data-firstrun-link="agents"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              创建可进化智能体 →
            </Link>
          </div>
        )}

        {step === 3 && (
          <div data-firstrun-step="done">
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "12px" }}>
              一切就绪！点击下方按钮进入对话开始你的第一次任务。
            </p>
            <Link
              href="/solo"
              data-firstrun-link="solo"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              进入对话 →
            </Link>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px" }}>
          <button
            onClick={prev}
            disabled={step === 0}
            data-firstrun-action="prev"
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--muted)",
              fontSize: "12px",
              cursor: step === 0 ? "not-allowed" : "pointer",
              opacity: step === 0 ? 0.5 : 1,
            }}
          >
            上一步
          </button>
          {step < 3 ? (
            <button
              onClick={next}
              data-firstrun-action="next"
              disabled={step === 0 && !role}
              style={{
                padding: "6px 14px",
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: step === 0 && !role ? "not-allowed" : "pointer",
                opacity: step === 0 && !role ? 0.5 : 1,
              }}
            >
              下一步
            </button>
          ) : (
            <button
              onClick={close}
              data-firstrun-action="finish"
              style={{
                padding: "6px 14px",
                background: "var(--ok)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
