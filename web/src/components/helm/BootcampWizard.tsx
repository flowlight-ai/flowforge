"use client";

/**
 * BootcampWizard — 灵智训练营入口向导
 *
 * 3 步流程：
 *   1. 欢迎 — 介绍训练营目的和12阶段流程
 *   2. 环境检测 — 联动 scripts/doctor_lib.py 深度检测（核心工具+CLI+代理+桥接）
 *   3. 创建会话 — 选择引导 Forgekin 并进入群聊
 *
 * 创建后跳转到 /council/{threadId}，训练营状态通过 bootcamp_state 持久化。
 *
 * 环境检测展示分块（与后端 EnvCheckResult 一致）：
 *   - 核心工具 (core_tools): python/node/npm/git/pnpm
 *   - AI CLI 工具 (cli_tools): 8 个灵智体所需 claude/codex/...
 *   - 协议代理 (proxy_services): claude-code-router/responses-proxy/gemini-proxy
 *   - Trae 桥接 (trae_bridge): butterfly 灵智体所需
 *   - 其他: .env / .venv / web_deps
 *   - 状态汇总: all_ready + missing[] + install_hint + 一键安装按钮
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  EnvCheckResult,
  CoreToolCheck,
  CliToolCheck,
  ProxyServiceCheck,
} from "../../lib/bootcamp-types";

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

// 展示顺序（与后端 doctor_lib.run_full_check 的 dict 顺序对齐）
const CORE_TOOL_ORDER = ["python", "node", "npm", "git", "pnpm"] as const;
const CLI_TOOL_ORDER = [
  "claude", "codex", "gemini", "opencode",
  "codebuddy", "qodercli", "iflow", "kimi",
] as const;
const PROXY_ORDER = [
  "claude-code-router", "responses-proxy", "gemini-proxy",
] as const;

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
    const ec = envCheck;
    // 兼容性兜底：若后端降级返回旧字段（tools / proxies / all_core_ok / missing_cli）
    const coreTools: Record<string, CoreToolCheck> =
      ec?.core_tools ?? (ec as any)?.tools ?? {};
    const cliTools: Record<string, CliToolCheck> = ec?.cli_tools ?? {};
    const proxyServices: Record<string, ProxyServiceCheck> =
      ec?.proxy_services ?? (ec as any)?.proxies ?? {};
    const traeBridge = ec?.trae_bridge;
    const envFile = ec?.env_file;
    const venv = ec?.venv;
    const webDeps = ec?.web_deps;
    const allReady = ec?.all_ready ?? (ec as any)?.all_core_ok ?? false;
    const missing: string[] = ec?.missing ?? (ec as any)?.missing_cli ?? [];
    const installHint = ec?.install_hint ?? "";

    // 统计就绪数
    const coreOkCount = CORE_TOOL_ORDER.filter((n) => coreTools[n]?.ok).length;
    const cliOkCount = CLI_TOOL_ORDER.filter((n) => cliTools[n]?.ok).length;
    const proxyOkCount = PROXY_ORDER.filter((n) => proxyServices[n]?.ok).length;

    // 各分块状态判定（含旧字段兼容）
    const traeBridgeOk = traeBridge?.ok === true || traeBridge?.status === "ok";
    const envFileOk = envFile?.exists === true || envFile?.status === "ok";
    const venvOk = venv?.exists === true || venv?.status === "ok";
    const webDepsOk = webDeps?.exists === true || webDeps?.status === "ok";

    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>环境检测</h2>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>联动 doctor_lib 深度检测（核心工具 + 8 CLI + 3 代理 + 桥接）</p>
          </div>

          {!ec ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>正在检测...</p>
            </div>
          ) : (
            <>
              {/* ── 状态汇总条：全部就绪 / 缺少 N 项 ── */}
              <div style={summaryStyle(allReady)}>
                {allReady ? (
                  <span>✅ 全部就绪！FlowForge 环境检测通过。</span>
                ) : (
                  <span>
                    ⚠ 缺少 <strong style={{ fontSize: "14px" }}>{missing.length}</strong> 项：
                    <code style={{ marginLeft: "6px", fontFamily: "var(--mono)", fontSize: "11px" }}>
                      {missing.join(", ")}
                    </code>
                  </span>
                )}
              </div>

              {/* ── 核心工具 ── */}
              <SectionLabel>
                核心工具 <StatusBadge ok={coreOkCount === CORE_TOOL_ORDER.length}>
                  {coreOkCount}/{CORE_TOOL_ORDER.length} 就绪
                </StatusBadge>
              </SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "14px" }}>
                {CORE_TOOL_ORDER.map((tool) => (
                  <CoreToolItem key={tool} name={tool} result={coreTools[tool]} />
                ))}
              </div>

              {/* ── AI CLI 工具 ── */}
              <SectionLabel>
                AI CLI 工具 <StatusBadge ok={cliOkCount === CLI_TOOL_ORDER.length}>
                  {cliOkCount}/{CLI_TOOL_ORDER.length} 已安装
                </StatusBadge>
              </SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "14px" }}>
                {CLI_TOOL_ORDER.map((tool) => (
                  <CliToolItem key={tool} name={tool} tool={cliTools[tool]} />
                ))}
              </div>

              {/* ── 协议代理服务 ── */}
              <SectionLabel>
                协议代理服务 <StatusBadge ok={proxyOkCount === PROXY_ORDER.length}>
                  {proxyOkCount}/{PROXY_ORDER.length} 运行中
                </StatusBadge>
              </SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "14px" }}>
                {PROXY_ORDER.map((name) => (
                  <ProxyServiceItem key={name} name={name} service={proxyServices[name]} />
                ))}
              </div>

              {/* ── 其他状态：Trae 桥接 / .env / .venv / 前端依赖 ── */}
              <SectionLabel>其他配置</SectionLabel>
              <div style={{ display: "grid", gap: "6px", marginBottom: "14px" }}>
                <StatusRow
                  label="Trae 桥接"
                  ok={traeBridgeOk}
                  detail={
                    traeBridge?.dir
                      ? `已配置: ${traeBridge.dir}`
                      : traeBridgeOk ? "已配置" : "未配置 FLOWFORGE_BRIDGE_DIR"
                  }
                />
                <StatusRow
                  label=".env 配置文件"
                  ok={envFileOk}
                  detail={
                    !envFileOk ? "不存在" :
                    envFile?.has_api_keys
                      ? `存在，API key ${envFile.configured_keys ?? "?"}/${envFile.total_keys ?? 4} 已配置`
                      : "存在，但 API key 未配置"
                  }
                />
                <StatusRow label=".venv 虚拟环境" ok={venvOk} detail={venvOk ? "已创建" : "未创建"} />
                <StatusRow label="前端依赖 (node_modules)" ok={webDepsOk} detail={webDepsOk ? "已安装" : "未安装"} />
              </div>

              {/* ── 安装提示 + 一键安装按钮 ── */}
              {installHint && (
                <div style={hintStyle(allReady)}>
                  <span style={{ flex: 1, minWidth: "200px" }}>
                    {allReady ? "✅ " : "💡 "}{installHint}
                  </span>
                  {!allReady && (
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
  return (
    <h3 style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--text)", display: "flex", alignItems: "center", gap: "8px" }}>
      {children}
    </h3>
  );
}

/** 状态徽章（如 "5/5 就绪"） */
function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      padding: "1px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 500,
      background: ok ? "var(--ok-subtle)" : "var(--warn-subtle)",
      color: ok ? "var(--ok)" : "var(--warn)",
    }}>
      {children}
    </span>
  );
}

/** 核心工具检测项（python/node/npm/git/pnpm） */
function CoreToolItem({ name, result }: { name: string; result?: CoreToolCheck }) {
  if (!result) {
    return (
      <div style={toolItemStyle}>
        <span>{name}</span>
        <span style={{ color: "var(--muted)" }}>检测中...</span>
      </div>
    );
  }
  const detail = result.ok
    ? (result.version || "已安装")
    : (result.required ? `需要 ${result.required}` : "未安装");
  return (
    <div style={toolItemStyle}>
      <span style={{ fontWeight: 600 }}>
        {result.ok ? "✓" : "✗"} {name}
      </span>
      <span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}>{detail}</span>
        {result.path && (
          <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={result.path}>
            {result.path}
          </span>
        )}
      </span>
    </div>
  );
}

/** CLI 工具检测项（8 个灵智体所需）.
 *  支持新格式（ok/version/path/error/install_cmd/forgekin）和旧格式（status/name）兼容。
 */
function CliToolItem({ name, tool }: { name: string; tool?: CliToolCheck }) {
  if (!tool) {
    return (
      <div style={cliItemStyle(false)}>
        <span>{name}</span>
        <span style={{ color: "var(--muted)" }}>检测中...</span>
      </div>
    );
  }
  // 兼容旧格式：status 字段
  const ok = tool.ok === true || tool.status === "ok";
  const forgekin = tool.forgekin;
  const version = tool.version;
  const installCmd = tool.install_cmd;
  const error = tool.error || (tool.status === "missing" ? "not found" : "");

  return (
    <div style={cliItemStyle(ok)}>
      <span style={{ fontWeight: 600, color: ok ? "var(--ok)" : "var(--danger)" }}>
        {ok ? "✓" : "✗"} {name}
      </span>
      <span style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", flex: 1, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {ok ? (
          <>
            {version && <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>{version}</span>}
            {forgekin && (
              <span style={{ color: "var(--accent)", padding: "1px 6px", background: "var(--accent-subtle)", borderRadius: "3px", fontSize: "10px" }}>
                {forgekin}
              </span>
            )}
          </>
        ) : (
          <>
            {forgekin && (
              <span style={{ color: "var(--muted)", padding: "1px 6px", background: "var(--bg)", borderRadius: "3px", fontSize: "10px" }}>
                {forgekin}
              </span>
            )}
            {error && <span style={{ color: "var(--danger)", fontSize: "10px" }}>{error}</span>}
            {installCmd && (
              <code style={{ color: "var(--warn)", fontSize: "10px", fontFamily: "var(--mono)" }}>{installCmd}</code>
            )}
          </>
        )}
      </span>
    </div>
  );
}

/** 代理服务检测项（claude-code-router/responses-proxy/gemini-proxy）.
 *  支持新格式（ok/port/status/desc）和旧格式（name/port/status）兼容。
 */
function ProxyServiceItem({ name, service }: { name: string; service?: ProxyServiceCheck }) {
  if (!service) {
    return (
      <div style={proxyItemStyle(false)}>
        <span>{name}</span>
        <span style={{ color: "var(--muted)" }}>检测中...</span>
      </div>
    );
  }
  // 兼容旧格式：service.name 或 ok 派生自 status
  const ok = service.ok === true || service.status === "running";
  const port = service.port;
  const statusText = service.status === "running" ? "运行中"
    : service.status === "stopped" ? "未运行"
    : service.status === "unknown" ? "检测失败"
    : service.status || "未知";
  return (
    <div style={proxyItemStyle(ok)}>
      <span style={{ fontWeight: 600, color: ok ? "var(--ok)" : "var(--warn)" }}>
        {ok ? "✓" : "⚠"} {name}
      </span>
      <span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>:{port}</span>
        <span style={{ color: ok ? "var(--ok)" : "var(--warn)" }}>{statusText}</span>
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
  width: "90%", maxWidth: "580px", maxHeight: "85vh", overflowY: "auto",
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

/** 状态汇总条样式（根据是否全部就绪切换颜色） */
const summaryStyle = (ready: boolean): React.CSSProperties => ({
  marginBottom: "16px", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", lineHeight: 1.5,
  display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
  background: ready ? "var(--ok-subtle)" : "var(--warn-subtle)",
  color: ready ? "var(--ok)" : "var(--warn)",
  border: `1px solid ${ready ? "var(--ok)" : "var(--warn)"}`,
});

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

/** 代理服务检测项样式（缺失时用警告色而非错误色） */
const proxyItemStyle = (ok: boolean): React.CSSProperties => ({
  ...toolItemStyle, flexWrap: "wrap", gap: "4px 8px",
  borderColor: ok ? "var(--border)" : "var(--warn)",
  background: ok ? "var(--bg-elevated)" : "var(--warn-subtle)",
});

/** 通用状态行样式（根据状态切换边框色） */
const statusRowStyle = (ok: boolean): React.CSSProperties => ({
  ...toolItemStyle,
  borderColor: ok ? "var(--border)" : "var(--warn)",
});
