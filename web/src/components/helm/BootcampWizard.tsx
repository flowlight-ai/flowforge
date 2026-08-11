"use client";

/**
 * BootcampWizard — 灵智训练营入口向导
 *
 * 参考 clowder-ai FirstRunQuestWizard.tsx（packages/web/src/components/
 * FirstRunQuestWizard.tsx）
 *
 * 3 步流程：
 *   1. 欢迎 — 介绍训练营目的和12阶段流程
 *   2. 环境检测 — 自动检测开发工具是否就绪
 *   3. 创建会话 — 选择引导 Forgekin 并进入群聊
 *
 * 创建后跳转到 /council/{threadId}，训练营状态通过 bootcamp_state 持久化。
 * 12 阶段的实际推进由用户在群聊中与智能体交互完成（参考 clowder-ai 猫驱动模式）。
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BootcampPhase,
  EnvCheckResult,
  ToolCheckResult,
} from "../../lib/bootcamp-types";

type WizardStep = "welcome" | "env-check" | "create" | "creating" | "done";

interface BootcampWizardProps {
  onClose?: () => void;
  /** 创建完成后回调（默认跳转到 /council/{threadId}） */
  onCreated?: (threadId: string) => void;
}

/** 核心 Forgekin 选项（训练营引导者） */
const LEAD_OPTIONS = [
  {
    id: "luban",
    name: "鲁班",
    nickname: "猫头鹰",
    emoji: "🦉",
    desc: "主架构师，擅长深度思考和系统设计",
    color: "#8B7355",
  },
  {
    id: "sherlock",
    name: "夏洛克",
    nickname: "猎犬",
    emoji: "🐕",
    desc: "开发者，擅长代码分析和问题排查",
    color: "#4A6FA5",
  },
  {
    id: "wenxin",
    name: "文心",
    nickname: "丹顶鹤",
    emoji: "🦩",
    desc: "文档员，擅长文档撰写和知识整理",
    color: "#D4A017",
  },
];

/** 核心工具列表（与后端 CORE_TOOLS 对应） */
const CORE_TOOLS = ["python", "git", "node", "npm"];
const OPTIONAL_TOOLS = ["pnpm", "docker", "uvicorn"];

export default function BootcampWizard({ onClose, onCreated }: BootcampWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null>(null);
  const [selectedLead, setSelectedLead] = useState("luban");
  const [error, setError] = useState<string | null>(null);

  /** 运行环境检测 */
  const runEnvCheck = useCallback(async () => {
    setStep("env-check");
    setError(null);
    try {
      const res = await fetch("/api/v1/bootcamp/env-check");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: EnvCheckResult = await res.json();
      setEnvCheck(data);
    } catch (e) {
      setError(`环境检测失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** 创建训练营会话 */
  const createBootcamp = useCallback(async () => {
    setStep("creating");
    setError(null);
    try {
      const res = await fetch("/api/v1/bootcamp/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "🎓 灵智训练营",
          lead_forgekin_id: selectedLead,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const thread = await res.json();
      setStep("done");
      // 跳转到群聊会话
      if (onCreated) {
        onCreated(thread.id);
      } else {
        router.push(`/council/${thread.id}`);
      }
    } catch (e) {
      setError(`创建训练营失败: ${e instanceof Error ? e.message : String(e)}`);
      setStep("create");
    }
  }, [selectedLead, router, onCreated]);

  // ── 步骤1：欢迎页 ──────────────────────────────────────────
  if (step === "welcome") {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎓</div>
            <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>
              灵智训练营
            </h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
              引导你完成环境配置、使用 FlowForge、训练智能体成长。
              <br />
              共 12 个阶段，由智能体引导你逐步完成。
            </p>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px", color: "var(--text)" }}>
              训练营流程
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
              {[
                "1. 自我介绍 — 认识你的智能体",
                "2. 环境检测 — 检查开发工具",
                "3. 配置帮助 — 修复缺失工具",
                "4. 选择任务 — 确定训练目标",
                "5-7. 设计与开发 — 智能体协助你完成项目",
                "8. 多智能体协作 — 体验团队协作",
                "9-10. 完成与回顾 — 总结成果",
                "11. 毕业 — 独立使用 FlowForge",
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: "6px 10px",
                    background: "var(--bg-elevated)",
                    borderRadius: "6px",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            {onClose && (
              <button onClick={onClose} style={secondaryBtnStyle}>
                稍后再说
              </button>
            )}
            <button onClick={runEnvCheck} style={primaryBtnStyle}>
              开始训练 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 步骤2：环境检测 ────────────────────────────────────────
  if (step === "env-check") {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>
              环境检测
            </h2>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>
              检查你的机器是否已安装必要的开发工具
            </p>
          </div>

          {!envCheck ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>正在检测...</p>
            </div>
          ) : (
            <>
              {/* 核心工具 */}
              <div style={{ marginBottom: "16px" }}>
                <h3 style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>
                  核心工具 {envCheck.all_core_ok ? "✓ 全部就绪" : "⚠ 部分缺失"}
                </h3>
                <div style={{ display: "grid", gap: "6px" }}>
                  {CORE_TOOLS.map((tool) => (
                    <ToolCheckItem
                      key={tool}
                      name={tool}
                      result={envCheck.tools[tool]}
                      isCore
                    />
                  ))}
                </div>
              </div>

              {/* 可选工具 */}
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>
                  可选工具（不影响训练）
                </h3>
                <div style={{ display: "grid", gap: "6px" }}>
                  {OPTIONAL_TOOLS.map((tool) => (
                    <ToolCheckItem
                      key={tool}
                      name={tool}
                      result={envCheck.tools[tool]}
                    />
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setStep("welcome")} style={secondaryBtnStyle}>
                  ← 上一步
                </button>
                <button onClick={() => setStep("create")} style={primaryBtnStyle}>
                  继续 →
                </button>
              </div>
            </>
          )}

          {error && (
            <div style={{ marginTop: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: "6px", color: "#ef4444", fontSize: "12px" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 步骤3：创建会话 ────────────────────────────────────────
  if (step === "create" || step === "creating") {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>
              选择引导智能体
            </h2>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>
              训练营将由你选择的智能体引导完成
            </p>
          </div>

          <div style={{ display: "grid", gap: "10px", marginBottom: "20px" }}>
            {LEAD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedLead(opt.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px",
                  background: selectedLead === opt.id ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))" : "var(--bg-elevated)",
                  border: selectedLead === opt.id ? "2px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: "28px" }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                    {opt.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({opt.nickname})</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                    {opt.desc}
                  </div>
                </div>
                {selectedLead === opt.id && (
                  <span style={{ color: "var(--accent)", fontSize: "18px" }}>✓</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div style={{ marginBottom: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: "6px", color: "#ef4444", fontSize: "12px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={() => setStep("env-check")} style={secondaryBtnStyle} disabled={step === "creating"}>
              ← 上一步
            </button>
            <button onClick={createBootcamp} style={primaryBtnStyle} disabled={step === "creating"}>
              {step === "creating" ? "创建中..." : "开始训练营 →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // done 状态（通常已跳转，这里只是占位）
  if (step === "done") {
    return (
      <div style={overlayStyle}>
        <div style={{ ...modalStyle, textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
          <p style={{ fontSize: "14px", color: "var(--text)" }}>训练营已创建，正在跳转...</p>
        </div>
      </div>
    );
  }

  return null;
}

// ── 子组件：工具检测结果项 ───────────────────────────────────

function ToolCheckItem({
  name,
  result,
  isCore = false,
}: {
  name: string;
  result?: ToolCheckResult;
  isCore?: boolean;
}) {
  if (!result) {
    return (
      <div style={toolItemStyle}>
        <span>{name}</span>
        <span style={{ color: "var(--muted)" }}>检测中...</span>
      </div>
    );
  }
  return (
    <div style={toolItemStyle}>
      <span style={{ fontWeight: isCore ? 600 : 400 }}>
        {result.ok ? "✓" : "✗"} {name}
      </span>
      <span style={{ color: result.ok ? "var(--accent)" : "#ef4444", fontSize: "11px" }}>
        {result.ok ? (result.version || "已安装") : (result.note || "未安装")}
      </span>
    </div>
  );
}

// ── 样式 ─────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(4px)",
};

const modalStyle: React.CSSProperties = {
  width: "90%",
  maxWidth: "520px",
  maxHeight: "85vh",
  overflowY: "auto",
  padding: "24px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "var(--accent)",
  color: "var(--accent-foreground, #fff)",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
};

const toolItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  background: "var(--bg-elevated)",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  fontSize: "13px",
  color: "var(--text)",
};
