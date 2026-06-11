"use client";

import { useState, useEffect, useCallback } from "react";
import StaticGraphModal from "../../../components/helm/StaticGraphModal";

interface WorkflowStep {
  id: string;
  display_name: string;
  agent: string;
  human_review: boolean;
}

interface Workflow {
  name: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  file: string;
  steps: number;
  step_details: WorkflowStep[];
}

interface AgentItem { name: string; description: string; enabled: boolean; mode?: string; model?: string; display_name?: string; mode_display_name?: string; default_mode?: string; }
interface ToolItem { name: string; description: string; enabled: boolean; category?: string; }
interface ModeItem { name: string; description: string; enabled: boolean; display_name?: string; capabilities?: string[]; }
interface MemoryItem { name: string; description: string; enabled: boolean; type?: string; }

interface PromptItem {
  key: string;
  template?: string;
}

interface MemoryRecord {
  id: string;
  task_id?: string;
  agent_name?: string;
  memory_type?: string;
  content?: string;
  created_at?: string;
}

type Tab = "workflows" | "agents" | "modes" | "tools" | "memory" | "prompts" | "terminal";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("workflows");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [graphModal, setGraphModal] = useState<{ type: "workflow" | "agent" | "mode"; name: string } | null>(null);

  const [promptKeys, setPromptKeys] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptItem | null>(null);
  const [promptEditValue, setPromptEditValue] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);

  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryFilter, setMemoryFilter] = useState("");

  const [terminalHistory, setTerminalHistory] = useState<{cmd: string; output: string; timestamp: number}[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);

  const categoryLabel = (c: string) => {
    const map: Record<string, string> = { generic: "通用", content: "内容" };
    return map[c] || c;
  };

  const categories = ["all", ...Array.from(new Set(workflows.map((w) => w.category)))];
  const filteredWorkflows = selectedCategory === "all" ? workflows : workflows.filter((w) => w.category === selectedCategory);

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "workflows") {
        const data = await fetch("/api/v1/workflows").then((r) => r.json()).catch(() => ({ data: { workflows: [] } }));
        setWorkflows(data?.data?.workflows || []);
      } else if (t === "agents") {
        const d = await fetch("/api/v1/graph/agents").then((r) => r.json()).catch(() => []);
        setAgents(Array.isArray(d) ? d.map((a: any) => ({
          name: a.name, display_name: a.display_name || a.name,
          description: a.description || "", enabled: true,
          mode: a.default_mode, mode_display_name: a.mode_display_name, default_mode: a.default_mode,
        })) : []);
      } else if (t === "modes") {
        const d = await fetch("/api/v1/graph/modes").then((r) => r.json()).catch(() => []);
        setModes(Array.isArray(d) ? d.map((m: any) => ({
          name: m.name, display_name: m.display_name || m.name,
          description: m.description || "", enabled: true, capabilities: m.capabilities,
        })) : []);
      } else if (t === "tools") {
        const d = await fetch("/api/v1/system/tools").then((r) => r.json()).then((d) => d?.tools || []).catch(() => []);
        setTools(Array.isArray(d) ? d.map((t: any) => ({ name: t.name || t, description: t.description || "", enabled: t.enabled !== false, category: t.category })) : []);
      } else if (t === "memory") {
        const d = await fetch("/api/v1/system/memory").then((r) => r.json()).then((d) => d?.memory || []).catch(() => []);
        setMemory(Array.isArray(d) ? d.map((m: any) => ({ name: m.name || m, description: m.description || "", enabled: m.enabled !== false, type: m.type })) : []);
        setMemoryLoading(true);
        const mr = await fetch("/api/v1/memory?limit=50").then((r) => r.json()).catch(() => ({ data: { records: [] } }));
        setMemoryRecords(mr?.data?.records || mr?.records || []);
        setMemoryLoading(false);
      } else if (t === "prompts") {
        const data = await fetch("/api/v1/prompts").then((r) => r.json()).catch(() => ({ data: { keys: [], total: 0 } }));
        setPromptKeys(data?.data?.keys || []);
        setSelectedPrompt(null);
        setPromptEditValue("");
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const handleSelectPrompt = useCallback(async (key: string) => {
    try {
      const data = await fetch(`/api/v1/prompts/${encodeURIComponent(key)}`).then((r) => r.json());
      const item = { key, template: data?.data?.template || "" };
      setSelectedPrompt(item);
      setPromptEditValue(item.template || "");
    } catch {
      setSelectedPrompt({ key, template: "" });
      setPromptEditValue("");
    }
  }, []);

  const handleSavePrompt = useCallback(async () => {
    if (!selectedPrompt) return;
    setPromptSaving(true);
    try {
      await fetch(`/api/v1/prompts/${encodeURIComponent(selectedPrompt.key)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: promptEditValue }),
      });
      setSelectedPrompt((prev) => prev ? { ...prev, template: promptEditValue } : null);
    } catch {}
    setPromptSaving(false);
  }, [selectedPrompt, promptEditValue]);

  const handleReloadPrompts = useCallback(async () => {
    try { await fetch("/api/v1/prompts/reload", { method: "POST" }); await loadTab("prompts"); } catch {}
  }, [loadTab]);

  const handleDeleteMemoryRecord = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/memory/${id}`, { method: "DELETE" });
      setMemoryRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {}
  }, []);

  const handleTerminalCommand = useCallback(async () => {
    if (!terminalInput.trim() || terminalRunning) return;
    const cmd = terminalInput.trim();
    setTerminalInput("");
    setTerminalRunning(true);
    const startTime = Date.now();
    try {
      const r = await fetch("/api/v1/system/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await r.json();
      const output = data.output || data.error || "（无输出）";
      setTerminalHistory(prev => [...prev, { cmd, output, timestamp: startTime }]);
    } catch (e: any) {
      setTerminalHistory(prev => [...prev, { cmd, output: `错误: ${e.message}`, timestamp: startTime }]);
    }
    setTerminalRunning(false);
  }, [terminalInput, terminalRunning]);

  if (loading) return <div className="animate-rise"><div className="card"><div className="empty">加载中...</div></div></div>;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "workflows", label: "工作流", icon: "📋" },
    { key: "agents", label: "Agent", icon: "🤖" },
    { key: "modes", label: "执行模式", icon: "⚡" },
    { key: "tools", label: "工具", icon: "🔧" },
    { key: "memory", label: "记忆", icon: "🧠" },
    { key: "prompts", label: "提示词", icon: "💬" },
    { key: "terminal", label: "终端", icon: "💻" },
  ];

  const PluginCard = ({ item, onToggle, onGraphClick, graphType }: { item: { name: string; description: string; enabled: boolean; [k: string]: any }; onToggle?: (name: string) => void; onGraphClick?: () => void; graphType?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border)", transition: "all 0.15s" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)" }}>{item.display_name || item.name}</div>
        {item.description && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
        {item.default_mode && (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "var(--bg-hover)", color: "var(--muted)", fontWeight: 500, marginTop: "4px", display: "inline-block" }}>
            模式: {item.mode_display_name || item.default_mode}
          </span>
        )}
        {item.capabilities && item.capabilities.length > 0 && (
          <div style={{ display: "flex", gap: "3px", marginTop: "4px", flexWrap: "wrap" }}>
            {item.capabilities.slice(0, 3).map((c: string) => (
              <span key={c} style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "3px", background: "var(--bg-hover)", color: "var(--muted)" }}>{c}</span>
            ))}
          </div>
        )}
      </div>
      {onGraphClick && (
        <button onClick={onGraphClick} style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--accent)", background: "var(--accent-subtle, rgba(255,92,92,0.1))", color: "var(--accent)", cursor: "pointer", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>
          ◈ 流程图
        </button>
      )}
      {onToggle && (
        <button onClick={() => onToggle(item.name)} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "12px", border: `1px solid ${item.enabled ? "var(--ok)" : "var(--border)"}`, background: item.enabled ? "var(--ok-subtle)" : "var(--bg)", color: item.enabled ? "var(--ok)" : "var(--muted)", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: item.enabled ? "var(--ok)" : "var(--muted)", display: "inline-block" }} />
          {item.enabled ? "启用" : "禁用"}
        </button>
      )}
    </div>
  );

  const filteredMemoryRecords = memoryFilter
    ? memoryRecords.filter((r) => r.task_id?.includes(memoryFilter) || r.agent_name?.includes(memoryFilter) || r.content?.includes(memoryFilter))
    : memoryRecords;

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "12px" }}>
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>系统设置</h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>管理工作流、Agent、执行模式、工具、记忆与提示词</p>

        <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid var(--border-strong)", marginBottom: "16px", flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "8px 14px", border: "none", borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent", background: "none", color: tab === t.key ? "var(--accent)" : "var(--muted)", cursor: "pointer", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, marginBottom: "-2px", transition: "all 0.15s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "workflows" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{workflows.length} 个工作流可用</span>
            </div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
              {categories.map((c) => (
                <button key={c} onClick={() => setSelectedCategory(c)} style={{ cursor: "pointer", border: "1px solid var(--border-strong)", background: selectedCategory === c ? "var(--accent)" : "transparent", color: selectedCategory === c ? "#fff" : "var(--muted)", borderRadius: "20px", padding: "4px 12px", fontSize: "12px", fontWeight: 500 }}>
                  {c === "all" ? "全部" : categoryLabel(c)}
                </button>
              ))}
            </div>
            {filteredWorkflows.length === 0 ? (
              <div className="empty">暂无工作流</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {filteredWorkflows.map((wf) => (
                  <div key={wf.name} style={{ padding: "16px", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", border: "1px solid var(--border)", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                    onClick={() => setGraphModal({ type: "workflow", name: wf.name })}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "24px" }}>{wf.icon || "📋"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.display_name}</div>
                        <div style={{ fontSize: "11px", color: "var(--muted)" }}>{wf.steps} 步 · {categoryLabel(wf.category)}</div>
                      </div>
                      <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "var(--accent-subtle, rgba(255,92,92,0.1))", color: "var(--accent)", fontWeight: 600 }}>◈ 流程图</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "10px" }}>{wf.description}</div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {wf.step_details?.slice(0, 4).map((step) => (
                        <span key={step.id} style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: step.human_review ? "var(--warn-subtle)" : "var(--bg-hover)", color: step.human_review ? "var(--warn)" : "var(--muted)", fontWeight: 500 }}>
                          {step.human_review && "👤 "}{step.display_name}
                        </span>
                      ))}
                      {wf.step_details?.length > 4 && <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "var(--bg-hover)", color: "var(--muted)" }}>+{wf.step_details.length - 4}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "agents" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{agents.length} 个 Agent 已注册 · 点击「流程图」查看依赖</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {agents.map((a) => <PluginCard key={a.name} item={a} graphType="agent" onGraphClick={() => setGraphModal({ type: "agent", name: a.name })} />)}
              {agents.length === 0 && <div className="empty">暂无 Agent</div>}
            </div>
          </div>
        )}

        {tab === "modes" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{modes.length} 个执行模式可用 · 点击「流程图」查看内部步骤</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {modes.map((m) => <PluginCard key={m.name} item={m} graphType="mode" onGraphClick={() => setGraphModal({ type: "mode", name: m.name })} />)}
              {modes.length === 0 && <div className="empty">暂无执行模式</div>}
            </div>
          </div>
        )}

        {tab === "tools" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{tools.length} 个工具已注册</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {tools.map((t) => <PluginCard key={t.name} item={t} />)}
              {tools.length === 0 && <div className="empty">暂无工具</div>}
            </div>
          </div>
        )}

        {tab === "memory" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{memory.length} 个记忆存储已注册</div>
            {memory.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
                {memory.map((m) => <PluginCard key={m.name} item={m} />)}
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px", marginTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>记忆记录</h3>
                <input
                  value={memoryFilter} onChange={(e) => setMemoryFilter(e.target.value)}
                  placeholder="搜索 task_id / agent / 内容..."
                  style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "11px", width: "220px", outline: "none" }}
                />
              </div>
              {memoryLoading ? (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--muted)", fontSize: "12px" }}>加载中...</div>
              ) : filteredMemoryRecords.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--muted)", fontSize: "12px" }}>暂无记忆记录</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflowY: "auto" }}>
                  {filteredMemoryRecords.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 12px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: "11px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "8px", marginBottom: "3px" }}>
                          {r.agent_name && <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{r.agent_name}</span>}
                          {r.memory_type && <span style={{ padding: "1px 5px", borderRadius: "3px", background: "var(--bg-hover)", color: "var(--muted)", fontSize: "10px" }}>{r.memory_type}</span>}
                          {r.task_id && <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "10px" }}>{r.task_id.slice(0, 8)}...</span>}
                        </div>
                        {r.content && <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "500px" }}>{r.content.slice(0, 120)}</div>}
                        {r.created_at && <div style={{ color: "var(--muted)", fontSize: "10px", marginTop: "2px" }}>{r.created_at}</div>}
                      </div>
                      <button onClick={() => handleDeleteMemoryRecord(r.id)} style={{ padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--danger-subtle, rgba(239,68,68,0.2))", background: "var(--danger-subtle, rgba(239,68,68,0.1))", color: "var(--danger)", cursor: "pointer", fontSize: "10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "prompts" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{promptKeys.length} 个提示词模板</span>
              <button onClick={handleReloadPrompts} style={{ padding: "4px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--muted)", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}>
                🔄 重新加载
              </button>
            </div>
            <div style={{ display: "flex", gap: "12px", minHeight: "400px" }}>
              <div style={{ width: "240px", minWidth: "200px", borderRight: "1px solid var(--border)", paddingRight: "12px", overflowY: "auto", maxHeight: "500px" }}>
                {promptKeys.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>暂无提示词</div>
                ) : (
                  promptKeys.map((key) => (
                    <div key={key} onClick={() => handleSelectPrompt(key)} style={{
                      padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                      fontWeight: selectedPrompt?.key === key ? 700 : 400,
                      color: selectedPrompt?.key === key ? "var(--accent)" : "var(--text-secondary)",
                      background: selectedPrompt?.key === key ? "var(--accent-subtle, rgba(255,92,92,0.1))" : "transparent",
                      marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {key}
                    </div>
                  ))
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {selectedPrompt ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)" }}>{selectedPrompt.key}</span>
                      <button onClick={handleSavePrompt} disabled={promptSaving} style={{
                        padding: "4px 14px", borderRadius: "6px", border: "1px solid var(--ok)",
                        background: "var(--ok-subtle)", color: "var(--ok)", cursor: promptSaving ? "not-allowed" : "pointer",
                        fontSize: "11px", fontWeight: 600, opacity: promptSaving ? 0.6 : 1,
                      }}>
                        {promptSaving ? "保存中..." : "💾 保存"}
                      </button>
                    </div>
                    <textarea value={promptEditValue} onChange={(e) => setPromptEditValue(e.target.value)} style={{
                      width: "100%", minHeight: "360px", padding: "12px", borderRadius: "8px",
                      border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-strong)",
                      fontSize: "12px", fontFamily: "monospace", lineHeight: 1.6, resize: "vertical", outline: "none",
                    }} />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "300px", color: "var(--muted)", fontSize: "13px" }}>
                    ← 从左侧选择一个提示词模板进行编辑
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "terminal" && (
          <div>
            <div style={{ marginBottom: "12px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", margin: "0 0 4px" }}>终端命令</h3>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>在此执行系统命令，支持 shell 命令和 FlowForge 内置命令</p>
            </div>
            <div style={{
              background: "#1e1e2e",
              borderRadius: "8px",
              padding: "16px",
              fontFamily: "monospace",
              fontSize: "13px",
              color: "#cdd6f4",
              minHeight: "400px",
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{
                flex: 1,
                maxHeight: "400px",
                overflowY: "auto",
                marginBottom: "12px",
              }}>
                {terminalHistory.length === 0 && (
                  <div style={{ color: "#585b70", fontStyle: "italic" }}>等待命令输入...</div>
                )}
                {terminalHistory.map((entry, idx) => (
                  <div key={idx} style={{ marginBottom: "12px" }}>
                    <div style={{ color: "#a6e3a1" }}>$ {entry.cmd}</div>
                    <pre style={{
                      color: entry.output.startsWith("错误") ? "#f38ba8" : "#cdd6f4",
                      margin: "4px 0 0",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      fontSize: "12px",
                      lineHeight: 1.5,
                    }}>{entry.output}</pre>
                  </div>
                ))}
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                borderTop: "1px solid #313244",
                paddingTop: "12px",
              }}>
                <span style={{ color: "#a6e3a1", fontFamily: "monospace", fontSize: "14px", fontWeight: 700 }}>$</span>
                <input
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleTerminalCommand(); }}
                  placeholder="输入命令..."
                  disabled={terminalRunning}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#cdd6f4",
                    fontFamily: "monospace",
                    fontSize: "13px",
                    caretColor: "#a6e3a1",
                  }}
                />
                <button
                  onClick={handleTerminalCommand}
                  disabled={terminalRunning || !terminalInput.trim()}
                  style={{
                    padding: "4px 14px",
                    borderRadius: "6px",
                    border: "1px solid #a6e3a1",
                    background: "rgba(166,227,161,0.1)",
                    color: "#a6e3a1",
                    cursor: terminalRunning || !terminalInput.trim() ? "not-allowed" : "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    opacity: terminalRunning || !terminalInput.trim() ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {terminalRunning ? "⏳ 执行中" : "▶ 执行"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {graphModal && (
        <StaticGraphModal type={graphModal.type} name={graphModal.name} onClose={() => setGraphModal(null)} />
      )}
    </div>
  );
}
