"use client";

/**
 * AgentsTabBar — 智能体管理双 Tab 切换栏
 *
 *   Tab 1: 可进化智能体 (Evolvable Agent / Forgekin)
 *   Tab 2: 静态智能体 (Static Agent)
 */

export type AgentTab = "evolvable" | "static";

interface AgentsTabBarProps {
  tab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
  evolvableCount: number;
  staticCount: number;
}

export function AgentsTabBar({ tab, onTabChange, evolvableCount, staticCount }: AgentsTabBarProps) {
  const tabs: { id: AgentTab; label: string; icon: string; count: number }[] = [
    { id: "evolvable", label: "可进化智能体", icon: "🦉", count: evolvableCount },
    { id: "static", label: "静态智能体", icon: "⚙", count: staticCount },
  ];

  return (
    <div
      className="flex gap-2 mb-6 border-b border-[var(--cafe-border-subtle,#2a2c3a)]"
      data-agents-tabbar="root"
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              active
                ? "border-[var(--cafe-accent,#ff5c5c)] text-[var(--cafe-text,#e5e7eb)]"
                : "border-transparent text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)]"
            }`}
            data-agents-tab={t.id}
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
          >
            <span className="text-base">{t.icon}</span>
            <span>{t.label}</span>
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-xs font-bold"
              style={{
                background: active
                  ? "var(--cafe-accent,#ff5c5c)"
                  : "var(--console-rail-item,#252633)",
                color: active ? "#fff" : "var(--cafe-text-secondary,#9ca3af)",
              }}
            >
              {t.count > 99 ? "99+" : t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
