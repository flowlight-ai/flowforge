"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/** 终端命令记录 */
export interface TerminalCommand {
  id: string;
  command: string;
  output: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  durationMs?: number;
  /** 是否为后台长运行命令 */
  isBackground?: boolean;
}

interface TerminalPanelProps {
  /** 命令列表 */
  commands: TerminalCommand[];
  /** 复制命令输出 */
  onCopy: (commandId: string) => void;
  /** 重新运行命令 */
  onRerun: (command: string) => void;
}

/** 终端面板 — 展示已执行命令卡片，支持历史搜索与后台命令 */
export default function TerminalPanel({ commands, onCopy, onRerun }: TerminalPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-expand running commands
  useEffect(() => {
    const running = commands.find((c) => c.status === "running");
    if (running) setExpandedId(running.id);
  }, [commands]);

  const filtered = searchQuery.trim()
    ? commands.filter((c) =>
        c.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.output.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commands;

  const foreground = filtered.filter((c) => !c.isBackground);
  const background = filtered.filter((c) => c.isBackground);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">终端</span>
        <span className="text-[10px] text-gray-600 ml-1">{commands.filter((c) => c.status === "running").length} 运行中</span>
        <div className="flex-1" />
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex-shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索命令..."
          className="w-full bg-gray-900 text-gray-200 text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Command list */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {commands.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4">
            执行的命令将显示在这里
          </div>
        ) : (
          <>
            {/* Foreground commands */}
            {foreground.map((cmd) => (
              <CommandCard
                key={cmd.id}
                command={cmd}
                expanded={expandedId === cmd.id}
                onToggle={() => setExpandedId(expandedId === cmd.id ? null : cmd.id)}
                onCopy={() => onCopy(cmd.id)}
                onRerun={() => onRerun(cmd.command)}
              />
            ))}

            {/* Background island */}
            {background.length > 0 && (
              <div className="mx-3 my-2 border border-amber-500/20 rounded-lg bg-amber-500/5 overflow-hidden">
                <div className="px-3 py-1.5 flex items-center gap-2 border-b border-amber-500/10">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="text-[11px] font-medium text-amber-400">后台命令</span>
                  <span className="text-[10px] text-amber-400/60">{background.length}</span>
                </div>
                {background.map((cmd) => (
                  <CommandCard
                    key={cmd.id}
                    command={cmd}
                    expanded={expandedId === cmd.id}
                    onToggle={() => setExpandedId(expandedId === cmd.id ? null : cmd.id)}
                    onCopy={() => onCopy(cmd.id)}
                    onRerun={() => onRerun(cmd.command)}
                    compact
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 单条命令卡片 */
function CommandCard({
  command,
  expanded,
  onToggle,
  onCopy,
  onRerun,
  compact = false,
}: {
  command: TerminalCommand;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onRerun: () => void;
  compact?: boolean;
}) {
  const statusColor = command.status === "completed"
    ? "#a6e3a1"
    : command.status === "error"
    ? "#f38ba8"
    : "#f9e2af";

  return (
    <div
      className={`border-b border-gray-800/50 ${compact ? "px-2 py-1.5" : "px-4 py-2.5"} cursor-pointer hover:bg-white/[0.02] transition-colors`}
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        {command.status === "running" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2" strokeLinecap="round" className="flex-shrink-0" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
        )}

        {/* Command text */}
        <span className={`font-mono text-gray-300 flex-1 truncate ${compact ? "text-[11px]" : "text-xs"}`}>
          $ {command.command}
        </span>

        {/* Duration */}
        {command.durationMs != null && (
          <span className="text-[10px] text-gray-600 font-mono flex-shrink-0">
            {command.durationMs < 1000 ? `${command.durationMs}ms` : `${(command.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onCopy}
            className="text-gray-600 hover:text-gray-300 p-1 rounded hover:bg-white/10 transition-colors"
            title="复制输出"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            onClick={onRerun}
            className="text-gray-600 hover:text-gray-300 p-1 rounded hover:bg-white/10 transition-colors"
            title="重新运行"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded output */}
      {expanded && command.output && (
        <pre className={`mt-2 bg-[#1e1e2e] rounded-lg p-3 text-[11px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto ${compact ? "text-[10px]" : ""}`}>
          {command.output}
        </pre>
      )}
    </div>
  );
}
