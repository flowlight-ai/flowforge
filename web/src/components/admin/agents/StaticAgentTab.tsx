"use client";

/**
 * StaticAgentTab — 静态智能体 Tab
 *
 *   子 Tab 1: FlowForge 内置（DeclarativeAgent / ReActAgent / PlanExecuteAgent / ReflexionAgent）
 *   子 Tab 2: 外部接入（Claude Code / Codex / OpenCode / Trae / Gemini）
 *
 * 底部：Agent 熔断器状态表（老版保留）
 *
 * 命名规范：使用 P0 "静态智能体"（非 "灵智体"）
 */

import { useState } from "react";
import { BuiltinAgentList } from "./BuiltinAgentList";
import { ExternalAgentList } from "./ExternalAgentList";
import { AgentStatusTable } from "./AgentStatusTable";

type StaticSubTab = "builtin" | "external";

interface StaticAgentTabProps {
  onCountChange?: (count: number) => void;
}

export function StaticAgentTab({ onCountChange }: StaticAgentTabProps) {
  const [subTab, setSubTab] = useState<StaticSubTab>("builtin");

  return (
    <div className="static-tab" data-agents-content="static">
      {/* 子 Tab 切换栏 */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg bg-[var(--console-rail-bg,#1e1f26)]" data-static-subtab-bar="root">
        <button
          type="button"
          onClick={() => setSubTab("builtin")}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            subTab === "builtin"
              ? "bg-[var(--console-rail-active,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)]"
              : "text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)]"
          }`}
          data-static-subtab="builtin"
          data-active={subTab === "builtin" ? "true" : "false"}
        >
          FlowForge 内置（4）
        </button>
        <button
          type="button"
          onClick={() => setSubTab("external")}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            subTab === "external"
              ? "bg-[var(--console-rail-active,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)]"
              : "text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)]"
          }`}
          data-static-subtab="external"
          data-active={subTab === "external" ? "true" : "false"}
        >
          外部接入（5）
        </button>
      </div>

      {/* 子 Tab 内容 */}
      {subTab === "builtin" ? <BuiltinAgentList /> : <ExternalAgentList />}

      {/* 底部：熔断器状态表（老版保留） */}
      <AgentStatusTable />
    </div>
  );
}
