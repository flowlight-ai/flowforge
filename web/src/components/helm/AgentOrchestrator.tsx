"use client";

import { useState, useCallback, useRef } from "react";

/** Agent 配置项 */
export interface AgentItem {
  id: string;
  name: string;
  description: string;
  icon?: string;
  enabled: boolean;
  /** 当前参数配置 */
  config: AgentConfig;
}

export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
}

interface AgentOrchestratorProps {
  /** 可用 Agent 列表 */
  agents: AgentItem[];
  /** 切换 Agent 启用/禁用 */
  onToggle: (agentId: string) => void;
  /** 配置 Agent 参数 */
  onConfigure: (agentId: string, config: AgentConfig) => void;
  /** 拖拽重排后回调 */
  onReorder: (agents: AgentItem[]) => void;
}

/** Agent 编排 UI — 卡片式布局，支持拖拽排序与参数配置 */
export default function AgentOrchestrator({ agents, onToggle, onConfigure, onReorder }: AgentOrchestratorProps) {
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<AgentConfig>({});
  const dragItem = useRef<string | null>(null);
  const dragOverItem = useRef<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    dragItem.current = id;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    dragOverItem.current = id;
  }, []);

  const handleDrop = useCallback(() => {
    if (!dragItem.current || !dragOverItem.current || dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }
    const fromIdx = agents.findIndex((a) => a.id === dragItem.current);
    const toIdx = agents.findIndex((a) => a.id === dragOverItem.current);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...agents];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    onReorder(updated);
    dragItem.current = null;
    dragOverItem.current = null;
  }, [agents, onReorder]);

  const openConfig = useCallback((agent: AgentItem) => {
    setConfiguringId(agent.id);
    setDraftConfig({ ...agent.config });
  }, []);

  const saveConfig = useCallback(() => {
    if (configuringId) {
      onConfigure(configuringId, draftConfig);
      setConfiguringId(null);
    }
  }, [configuringId, draftConfig, onConfigure]);

  const activeAgent = agents.find((a) => a.id === configuringId);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="6" height="6" rx="1" />
          <rect x="16" y="2" width="6" height="6" rx="1" />
          <rect x="9" y="13" width="6" height="6" rx="1" />
          <path d="M5 8v3a2 2 0 002 2h2" />
          <path d="M19 8v3a2 2 0 01-2 2h-2" />
        </svg>
        <span className="text-sm font-semibold text-gray-200">Agent 编排</span>
        <span className="text-xs text-gray-500 ml-auto">{agents.filter((a) => a.enabled).length}/{agents.length} 已启用</span>
      </div>

      {/* Agent Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {agents.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            暂无可用 Agent
          </div>
        )}
        {agents.map((agent, idx) => (
          <div
            key={agent.id}
            draggable
            onDragStart={() => handleDragStart(agent.id)}
            onDragOver={(e) => handleDragOver(e, agent.id)}
            onDrop={handleDrop}
            className={`group relative rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
              agent.enabled
                ? "border-gray-700 bg-gray-900/60 hover:border-indigo-500/50"
                : "border-gray-800 bg-gray-900/30 opacity-50"
            }`}
          >
            {/* Connection line to next agent */}
            {idx < agents.length - 1 && (
              <div className="absolute left-1/2 -bottom-2 w-px h-2 bg-gray-700" />
            )}
            <div className="flex items-center gap-3 px-3 py-2.5">
              {/* Drag handle */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600 flex-shrink-0">
                <circle cx="9" cy="5" r="1" /><circle cx="15" cy="5" r="1" />
                <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
                <circle cx="9" cy="19" r="1" /><circle cx="15" cy="19" r="1" />
              </svg>

              {/* Agent icon */}
              <span className="text-lg flex-shrink-0">{agent.icon || "🤖"}</span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-200 truncate">{agent.name}</span>
                  <span className="text-[10px] text-gray-600 font-mono">#{idx + 1}</span>
                </div>
                <span className="text-[11px] text-gray-500 truncate block">{agent.description}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => openConfig(agent)}
                  className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-white/10 transition-colors"
                  title="配置"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button
                  onClick={() => onToggle(agent.id)}
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    agent.enabled ? "bg-indigo-500" : "bg-gray-700"
                  }`}
                  title={agent.enabled ? "禁用" : "启用"}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      agent.enabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Config preview */}
            {agent.enabled && (agent.config.model || agent.config.temperature !== undefined) && (
              <div className="px-3 pb-2 flex gap-2 flex-wrap">
                {agent.config.model && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono">
                    {agent.config.model}
                  </span>
                )}
                {agent.config.temperature !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                    T={agent.config.temperature}
                  </span>
                )}
                {agent.config.tools && agent.config.tools.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                    {agent.config.tools.length} 工具
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Config modal */}
      {activeAgent && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfiguringId(null)}>
          <div
            className="bg-[#1a1b26] border border-gray-700 rounded-xl w-[380px] max-h-[80%] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <span className="text-lg">{activeAgent.icon || "🤖"}</span>
              <span className="text-sm font-semibold text-gray-200">{activeAgent.name}</span>
              <span className="text-xs text-gray-500">配置</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">模型</label>
                <input
                  type="text"
                  value={draftConfig.model || ""}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, model: e.target.value }))}
                  placeholder="auto"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Temperature: {draftConfig.temperature ?? 0.7}</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={draftConfig.temperature ?? 0.7}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Max Tokens</label>
                <input
                  type="number"
                  value={draftConfig.maxTokens ?? 4096}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, maxTokens: parseInt(e.target.value) || 4096 }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">工具（逗号分隔）</label>
                <input
                  type="text"
                  value={(draftConfig.tools || []).join(", ")}
                  onChange={(e) => setDraftConfig((c) => ({
                    ...c,
                    tools: e.target.value ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : [],
                  }))}
                  placeholder="web_search, scraper"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setConfiguringId(null)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveConfig}
                className="px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
