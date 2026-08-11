"use client";

/**
 * BootcampWizard — 灵智训练营入口向导
 *
 * 3 步流程：
 *   1. 欢迎 — 介绍训练营目的和12阶段流程
 *   2. 环境检测 — 自动检测开发工具是否就绪（联动 doctor.py 深度检测）
 *   3. 创建会话 — 选择引导 Forgekin 并进入群聊
 *
 * 创建后跳转到 /council/{threadId}，训练营状态通过 bootcamp_state 持久化。
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { EnvCheckResult, ToolCheckResult, CliToolCheck } from "../../lib/bootcamp-types";

type WizardStep = "welcome" | "env-check" | "create" | "creating" | "done";

interface BootcampWizardProps {
  onClose?: () => void;
  /** 创建完成后回调（默认跳转到 /council/{threadId}） */
  onCreated?: (threadId: string) => void;
}

/** 核心 Forgekin 选项（训练营引导者） */
const LEAD_OPTIONS = [
  { id: "luban", name: "鲁班", nickname: "猫头鹰", emoji: "🦉", desc: "主架构师，擅长深度思考和系统设计" },
  { id: "sherlock", name: "夏洛克", nickname: "猎犬", emoji: "🐕", desc: "开发者，擅长代码分析和问题排查" },
  { id: "wenxin", name: "文心", nickname: "丹顶鹤", emoji: "🦩", desc: "文档员，擅长文档撰写和知识整理" },
];

const CORE_TOOLS = ["python", "git", "node", "npm"];
const OPTIONAL_TOOLS = ["pnpm", "docker", "uvicorn"];

export default function BootcampWizard({ onClose, onCreated }: BootcampWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null>(null);
  const [selectedLead, setSelectedLead] = useState("luban");
  const [error, setError] = useState<string | null>(null);
  const [showInstallCmd, setShowInstallCmd] = useState(false);
  const [copied, setCopied] = useState(false);

  /** 运行环境检测（也用于"重新检测"） */
  const runEnvCheck = useCallback(async () => {
    setStep("env-check");
    setEnvCheck(null);
    setError(null);
    setShowInstallCmd(false);
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
        body: JSON.stringify({ title: "🎓 灵智训练营", lead_forgekin_id: selectedLead }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const thread = await res.json();
      setStep("done");
      if (onCreated) onCreated(thread.id);
      else router.push(`/council/${thread.id}`);
    } catch (e) {
      setError(`创建训练营失败: ${e instanceof Error ? e.message : String(e)}`);
      setStep("create");
    }
  }, [selectedLead, router, onCreated]);

  /** 平台检测（显示对应的安装命令） */
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent || "");
  const installCmd = isWindows ? "install.bat" : "./install.sh";

  const copyInstallCmd = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [installCmd]);

  // ── 步骤1：欢迎页 ──────────────────────────────────────────
  if (step === "welcome") {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎓</div>
            <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>灵智训练营</h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
              引导你完成环境配置、使用 FlowForge、训练智能体成长。
              <br />
              共 12 个阶段，由智能体引导你逐步完成。
            </p>
          </div>
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px", color: "var(--text)" }}>训练营流程</h3>
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
                <div key={i} style={{ padding: "6px 10px", background: "var(--bg-elevated)", borderRadius: "6px", color: "var(--text)", border: "1px solid var(--border)" }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            {onClose && <button onClick={onClose} style={secondaryBtnStyle}>稍后再说</button>}
            <button onClick={runEnvCheck} style={primaryBtnStyle}>开始训练 →</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 步骤2：环境检测 ────────────────────────────────────────
  if (step === "env-check") {
    // 计算各检测项状态（兼容两种后端返回格式）
    const ec = envCheck;
    const traeBridgeOk = ec?.trae_bridge?.status === "ok";
    const envFileOk = ec?.env_file?.exists === true || ec?.env_file?.status === "ok";
    const venvOk = ec?.venv?.exists === true || ec?.venv?.status === "ok";
    const webDepsOk = ec?.web_deps?.exists === true || ec?.web_deps?.status === "ok";
    const hintReady = ec?.install_hint?.includes("就绪") ?? false;
    const cliTools = ec?.cli_tools ?? [];
    const cliOkCount = cliTools.filter((t) => t.status === "ok").length;

    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>环境检测</h2>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>检查你的机器是否已安装必要的开发工具</p>
          </div>

          {!ec ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>正在检测...</p>
            </div>
          ) : (
            <>
              {/* 核心工具 */}
              <SectionLabel>核心工具 {ec.all_core_ok ? "✓ 全部就绪" : "⚠ 部分缺失"}</SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
                {CORE_TOOLS.map((tool) => (
                  <ToolCheckItem key={tool} name={tool} result={ec.tools[tool]} isCore />
                ))}
              </div>

              {/* 可选工具 */}
              <SectionLabel>可选工具（不影响训练）</SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
                {OPTIONAL_TOOLS.map((tool) => (
                  <ToolCheckItem key={tool} name={tool} result={ec.tools[tool]} />
                ))}
              </div>

              {/* AI CLI 工具（灵智体所需，新增） */}
              {cliTools.length > 0 && (
                <>
                  <SectionLabel>AI CLI 工具（{cliOkCount}/{cliTools.length} 已安装）</SectionLabel>
                  <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
                    {cliTools.map((tool) => (
                      <CliToolItem key={tool.name} tool={tool} />
                    ))}
                  </div>
                </>
              )}

              {/* Trae 桥接 / .env / .venv / 前端依赖（新增） */}
              {ec.trae_bridge && (
                <StatusRow label="Trae 桥接" ok={traeBridgeOk}
                  detail={ec.trae_bridge.bridge_dir || (traeBridgeOk ? "已配置" : "未配置 FLOWFORGE_BRIDGE_DIR")} />
              )}
              {ec.env_file && (
                <StatusRow label=".env 配置文件" ok={envFileOk}
                  detail={ec.env_file.has_api_keys ? "存在，API key 已配置" : envFileOk ? "存在，API key 未配置" : "不存在"} />
              )}
              {ec.venv && <StatusRow label=".venv 虚拟环境" ok={venvOk} detail={venvOk ? "已创建" : "未创建"} />}
              {ec.web_deps && <StatusRow label="前端依赖 (node_modules)" ok={webDepsOk} detail={webDepsOk ? "已安装" : "未安装"} />}

              {/* 安装提示 + 一键安装按钮（新增） */}
              {ec.install_hint && (
                <div style={hintStyle(hintReady)}>
                  <span style={{ flex: 1, minWidth: "200px" }}>
                    {hintReady ? "✅ " : "💡 "}{ec.install_hint}
                  </span>
                  {!hintReady && (
                    <button onClick={() => setShowInstallCmd(!showInstallCmd)} style={installBtnStyle}>
                      {showInstallCmd ? "隐藏命令" : "一键安装"}
                    </button>
                  )}
                </div>
              )}

              {/* 安装命令指引（展开时显示，可复制） */}
              {showInstallCmd && (
                <div style={cmdBoxStyle}>
                  <code style={{ flex: 1, fontFamily: "var(--mono)", fontSize: "12px", color: "var(--accent)", wordBreak: "break-all" }}>
                    {installCmd}
                  </code>
                  <button onClick={copyInstallCmd} style={copyBtnStyle(copied)}>
                    {copied ? "✓ 已复制" : "复制"}
                  </button>
                </div>
              )}

              {/* 按钮区：上一步 / 重新检测 / 继续 */}
              <div style={btnRowStyle}>
                <button onClick={() => setStep("welcome")} style={secondaryBtnStyle}>← 上一步</button>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={runEnvCheck} style={secondaryBtnStyle}>🔄 重新检测</button>
                  <button onClick={() => setStep("create")} style={primaryBtnStyle}>继续 →</button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div style={{ marginTop: "12px", padding: "8px 12px", background: "var(--danger-subtle)", borderRadius: "6px", color: "var(--danger)", fontSize: "12px" }}>
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
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>选择引导智能体</h2>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>训练营将由你选择的智能体引导完成</p>
          </div>
          <div style={{ display: "grid", gap: "10px", marginBottom: "20px" }}>
            {LEAD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedLead(opt.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px", padding: "12px",
                  background: selectedLead === opt.id ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))" : "var(--bg-elevated)",
                  border: selectedLead === opt.id ? "2px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: "8px", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: "28px" }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                    {opt.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({opt.nickname})</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>{opt.desc}</div>
                </div>
                {selectedLead === opt.id && <span style={{ color: "var(--accent)", fontSize: "18px" }}>✓</span>}
              </button>
            ))}
          </div>
          {error && (
            <div style={{ marginBottom: "12px", padding: "8px 12px", background: "var(--danger-subtle)", borderRadius: "6px", color: "var(--danger)", fontSize: "12px" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={() => setStep("env-check")} style={secondaryBtnStyle} disabled={step === "creating"}>← 上一步</button>
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

// ── 子组件 ──────────────────────────────────────────────────

/** 区块标题 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>{children}</h3>;
}

/** 基础工具检测结果项 */
function ToolCheckItem({ name, result, isCore = false }: { name: string; result?: ToolCheckResult; isCore?: boolean }) {
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
      <span style={{ color: result.ok ? "var(--ok)" : "var(--danger)", fontSize: "11px" }}>
        {result.ok ? (result.version || "已安装") : (result.note || "未安装")}
      </span>
    </div>
  );
}

/** CLI 工具检测结果项（状态图标、名称、版本、绑定灵智体、安装命令） */
function CliToolItem({ tool }: { tool: CliToolCheck }) {
  const ok = tool.status === "ok";
  return (
    <div style={cliItemStyle(ok)}>
      <span style={{ fontWeight: 600, color: ok ? "var(--ok)" : "var(--danger)" }}>
        {ok ? "✓" : "✗"} {tool.name}
      </span>
      <span style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", flex: 1, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {tool.version && <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>{tool.version}</span>}
        {tool.forgekin && (
          <span style={{ color: "var(--accent)", padding: "1px 6px", background: "var(--accent-subtle)", borderRadius: "3px", fontSize: "10px" }}>
            {tool.forgekin}
          </span>
        )}
        {!ok && tool.install_cmd && (
          <code style={{ color: "var(--warn)", fontSize: "10px", fontFamily: "var(--mono)" }}>{tool.install_cmd}</code>
        )}
      </span>
    </div>
  );
}

/** 通用状态行（Trae 桥接 / .env / .venv / 前端依赖） */
function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div style={statusRowStyle(ok)}>
      <span style={{ fontWeight: 600, color: ok ? "var(--ok)" : "var(--warn)" }}>{ok ? "✓" : "⚠"} {label}</span>
      {detail && <span style={{ color: "var(--muted)", fontSize: "11px" }}>{detail}</span>}
    </div>
  );
}

// ── 样式 ─────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
};

const modalStyle: React.CSSProperties = {
  width: "90%", maxWidth: "560px", maxHeight: "85vh", overflowY: "auto",
  padding: "24px", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "12px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", background: "var(--accent)", color: "var(--accent-foreground, #fff)",
  border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", background: "transparent", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: "6px", fontSize: "13px", cursor: "pointer",
};

const toolItemStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "6px",
  border: "1px solid var(--border)", fontSize: "13px", color: "var(--text)",
};

/** 安装提示框样式（根据是否就绪切换颜色） */
const hintStyle = (ready: boolean): React.CSSProperties => ({
  marginTop: "12px", padding: "10px 12px", borderRadius: "6px", fontSize: "12px", lineHeight: 1.5,
  display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
  background: ready ? "var(--ok-subtle)" : "var(--warn-subtle)",
  color: ready ? "var(--ok)" : "var(--warn)",
});

/** 安装命令展示框样式 */
const cmdBoxStyle: React.CSSProperties = {
  marginTop: "8px", padding: "10px 12px", background: "var(--bg-elevated)",
  border: "1px solid var(--border)", borderRadius: "6px",
  display: "flex", alignItems: "center", gap: "8px",
};

/** "一键安装"按钮样式 */
const installBtnStyle: React.CSSProperties = {
  padding: "4px 12px", background: "var(--accent)", color: "var(--accent-foreground, #fff)",
  border: "none", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap",
};

/** "复制"按钮样式（根据是否已复制切换颜色） */
const copyBtnStyle = (copied: boolean): React.CSSProperties => ({
  padding: "4px 10px", background: "transparent", border: "1px solid var(--border)",
  borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap",
  color: copied ? "var(--ok)" : "var(--muted)",
});

/** 按钮行样式 */
const btnRowStyle: React.CSSProperties = {
  display: "flex", gap: "8px", justifyContent: "space-between",
  marginTop: "20px", flexWrap: "wrap",
};

/** CLI 工具检测项样式（根据状态切换边框/背景色） */
const cliItemStyle = (ok: boolean): React.CSSProperties => ({
  ...toolItemStyle, flexWrap: "wrap", gap: "4px 8px",
  borderColor: ok ? "var(--border)" : "var(--danger)",
  background: ok ? "var(--bg-elevated)" : "var(--danger-subtle)",
});

/** 通用状态行样式（根据状态切换边框色） */
const statusRowStyle = (ok: boolean): React.CSSProperties => ({
  ...toolItemStyle, marginBottom: "6px",
  borderColor: ok ? "var(--border)" : "var(--warn)",
});
