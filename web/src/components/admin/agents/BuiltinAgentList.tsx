"use client";

/**
 * BuiltinAgentList — FlowForge 内置静态智能体列表
 *
 * 依据 WEB-FUSION-DESIGN.md §6.3：
 *   DeclarativeAgent / ReActAgent / PlanExecuteAgent / ReflexionAgent
 *
 * 这些是 FlowForge 框架内置的静态智能体（不可进化），通过 YAML 配置驱动。
 */

interface BuiltinAgentDef {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: string;
}

const BUILTIN_AGENTS: BuiltinAgentDef[] = [
  {
    id: "declarative",
    name: "DeclarativeAgent",
    type: "声明式智能体",
    description: "YAML 配置驱动，通过 FlowForge DeclarativeAgent 执行。适用于固定 SOP 流程。",
    icon: "📋",
  },
  {
    id: "react",
    name: "ReActAgent",
    type: "推理-行动智能体",
    description: "Reasoning + Acting 循环，逐步推理并调用工具。适用于需要工具调用的任务。",
    icon: "🔄",
  },
  {
    id: "plan-execute",
    name: "PlanExecuteAgent",
    type: "规划-执行智能体",
    description: "先规划完整步骤再执行，支持中途修订计划。适用于复杂多步骤任务。",
    icon: "🎯",
  },
  {
    id: "reflexion",
    name: "ReflexionAgent",
    type: "反思智能体",
    description: "执行后反思结果，基于反馈迭代改进。适用于需要自我纠错的任务。",
    icon: "🪞",
  },
];

export function BuiltinAgentList() {
  return (
    <div className="space-y-3" data-builtin-agent-list="root">
      <div className="text-xs text-[var(--cafe-text-muted,#6b7280)] uppercase tracking-wider mb-2">
        FlowForge 内置静态智能体（4 种）
      </div>
      {BUILTIN_AGENTS.map((agent) => (
        <div
          key={agent.id}
          className="flex items-start gap-3 p-3 rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] hover:border-[var(--cafe-accent,#ff5c5c)] transition-colors"
          data-builtin-agent={agent.id}
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-[var(--console-rail-item,#252633)]">
            {agent.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-mono text-sm font-semibold text-[var(--cafe-text,#e5e7eb)]">
                {agent.name}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--semantic-info-surface,rgba(59,130,246,0.15))] text-[var(--semantic-info,#3b82f6)]">
                {agent.type}
              </span>
            </div>
            <p className="text-xs text-[var(--cafe-text-secondary,#9ca3af)] leading-relaxed">
              {agent.description}
            </p>
          </div>
          <a
            href={`/admin/agents/builtin/${agent.id}`}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
            data-builtin-agent-action="configure"
          >
            配置
          </a>
        </div>
      ))}
    </div>
  );
}
