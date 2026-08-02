"use client";

import { useState, useCallback } from "react";

/** MCP 服务器连接配置 */
export interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  /** stdio 模式下的启动命令 */
  command?: string;
  /** SSE 模式下的服务器 URL */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 连接状态 */
  status: "connected" | "disconnected" | "error" | "connecting";
  /** 状态描述（如错误信息） */
  statusMessage?: string;
}

interface MCPConfigPanelProps {
  /** MCP 服务器列表 */
  servers: MCPServer[];
  /** 添加服务器 */
  onAdd: (server: Omit<MCPServer, "id" | "status" | "statusMessage">) => void;
  /** 编辑服务器 */
  onEdit: (id: string, updates: Partial<Omit<MCPServer, "id" | "status">>) => void;
  /** 删除服务器 */
  onDelete: (id: string) => void;
  /** 测试连接 */
  onTest: (id: string) => void;
}

const EMPTY_FORM: Omit<MCPServer, "id" | "status" | "statusMessage"> = {
  name: "",
  transport: "stdio",
  command: "",
  url: "",
  env: {},
};

function StatusDot({ status }: { status: MCPServer["status"] }) {
  const colors: Record<string, string> = {
    connected: "#a6e3a1",
    disconnected: "#6c7086",
    error: "#f38ba8",
    connecting: "#f9e2af",
  };
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: colors[status] || colors.disconnected }}
      title={status}
    />
  );
}

/** MCP 配置面板 — 管理 MCP 服务器连接 */
export default function MCPConfigPanel({ servers, onAdd, onEdit, onDelete, onTest }: MCPConfigPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [envKey, setEnvKey] = useState("");
  const [envVal, setEnvVal] = useState("");

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setEnvKey("");
    setEnvVal("");
  }, []);

  const handleEdit = useCallback((server: MCPServer) => {
    setForm({
      name: server.name,
      transport: server.transport,
      command: server.command || "",
      url: server.url || "",
      env: { ...server.env },
    });
    setEditingId(server.id);
    setShowForm(true);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) return;
    if (editingId) {
      onEdit(editingId, form);
    } else {
      onAdd(form);
    }
    resetForm();
  }, [form, editingId, onAdd, onEdit, resetForm]);

  const addEnvVar = useCallback(() => {
    if (!envKey.trim()) return;
    setForm((f) => ({ ...f, env: { ...f.env, [envKey.trim()]: envVal } }));
    setEnvKey("");
    setEnvVal("");
  }, [envKey, envVal]);

  const removeEnvVar = useCallback((key: string) => {
    setForm((f) => {
      const env = { ...f.env };
      delete env[key];
      return { ...f, env };
    });
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
        <span className="text-sm font-semibold text-gray-200">MCP 服务器</span>
        <div className="flex-1" />
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="text-xs px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          + 添加
        </button>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {servers.length === 0 && !showForm && (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4">
            暂无 MCP 服务器配置
          </div>
        )}
        {servers.map((server) => (
          <div
            key={server.id}
            className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <StatusDot status={server.status} />
              <span className="text-sm font-medium text-gray-200 flex-1 truncate">{server.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono uppercase">
                {server.transport}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onTest(server.id)}
                  className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-white/10 transition-colors"
                  title="测试连接"
                  disabled={server.status === "connecting"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </button>
                <button
                  onClick={() => handleEdit(server)}
                  className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-white/10 transition-colors"
                  title="编辑"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => onDelete(server.id)}
                  className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-white/10 transition-colors"
                  title="删除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="mt-1.5 ml-[18px] text-[11px] text-gray-500 font-mono truncate">
              {server.transport === "stdio" ? server.command : server.url}
            </div>
            {server.statusMessage && (
              <div className={`mt-1 ml-[18px] text-[11px] ${server.status === "error" ? "text-red-400" : "text-gray-500"}`}>
                {server.statusMessage}
              </div>
            )}
            {server.env && Object.keys(server.env).length > 0 && (
              <div className="mt-1.5 ml-[18px] flex gap-1 flex-wrap">
                {Object.entries(server.env).map(([k]) => (
                  <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="border-t border-gray-800 bg-[#12131a] p-4 space-y-3 max-h-[60%] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300">
              {editingId ? "编辑服务器" : "添加服务器"}
            </span>
            <button onClick={resetForm} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="my-mcp-server"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">传输类型</label>
            <div className="flex gap-2">
              {(["stdio", "sse"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, transport: t }))}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    form.transport === t
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {t === "stdio" ? "Stdio" : "SSE"}
                </button>
              ))}
            </div>
          </div>

          {form.transport === "stdio" ? (
            <div>
              <label className="text-xs text-gray-400 block mb-1">命令</label>
              <input
                type="text"
                value={form.command || ""}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-400 block mb-1">URL</label>
              <input
                type="text"
                value={form.url || ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="http://localhost:3001/sse"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {/* Env vars */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">环境变量</label>
            {form.env && Object.entries(form.env).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xs font-mono text-gray-300 bg-gray-800 px-2 py-1 rounded flex-1 truncate">{k}</span>
                <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-1 rounded flex-1 truncate">{v}</span>
                <button onClick={() => removeEnvVar(k)} className="text-gray-500 hover:text-red-400 text-xs p-1">✕</button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={envKey}
                onChange={(e) => setEnvKey(e.target.value)}
                placeholder="KEY"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={envVal}
                onChange={(e) => setEnvVal(e.target.value)}
                placeholder="VALUE"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
              <button onClick={addEnvVar} className="text-xs px-2 py-1 bg-gray-800 text-gray-400 hover:text-gray-200 rounded transition-colors">+</button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!form.name.trim()}
            className="w-full py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editingId ? "保存修改" : "添加服务器"}
          </button>
        </div>
      )}
    </div>
  );
}
