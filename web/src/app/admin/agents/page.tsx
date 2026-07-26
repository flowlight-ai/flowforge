"use client";

import { useState, useCallback } from "react";
import { AgentsTabBar, AgentTab } from "@/components/admin/agents/AgentsTabBar";
import { EvolvableAgentTab } from "@/components/admin/agents/EvolvableAgentTab";
import { StaticAgentTab } from "@/components/admin/agents/StaticAgentTab";
import { HubForgekinEditor } from "@/components/admin/agents/HubForgekinEditor";

/**
 * 智能体管理中心 — 双 Tab 布局
 *
 * 依据 WEB-FUSION-DESIGN.md §6：
 *   Tab 1: 可进化智能体 (Evolvable Agent / Forgekin) — 5 个内置 Forgekin
 *   Tab 2: 静态智能体 (Static Agent) — 内置 4 种 + 外部接入 5 种
 *
 * 命名规范（依据 naming-contract.md）：
 *   - 使用 P0 命名 "可进化智能体" / "静态智能体" / "Forgekin"
 *   - 禁止使用 P2 别名 "灵智体"
 */

export default function AgentsPage() {
  const [tab, setTab] = useState<AgentTab>("evolvable");
  const [evolvableCount, setEvolvableCount] = useState(5);
  const [staticCount] = useState(9); // 4 内置 + 5 外部
  const [editingForgekinId, setEditingForgekinId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const handleEdit = useCallback((id: string) => {
    setEditingForgekinId(id);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
  }, []);

  return (
    <div className="admin-agents animate-rise p-6" data-admin="agents">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--cafe-text,#e5e7eb)]">
          智能体管理
        </h1>
        <p className="text-sm text-[var(--cafe-text-muted,#6b7280)] mt-1">
          可进化智能体（Evolvable Agent / Forgekin）+ 静态智能体（Static Agent）
        </p>
      </div>

      {/* 双 Tab 切换栏 */}
      <AgentsTabBar
        tab={tab}
        onTabChange={setTab}
        evolvableCount={evolvableCount}
        staticCount={staticCount}
      />

      {/* Tab 内容 */}
      <div className="agents-content" data-agents-active-tab={tab}>
        {tab === "evolvable" ? (
          <EvolvableAgentTab
            onEdit={handleEdit}
            onCountChange={setEvolvableCount}
          />
        ) : (
          <StaticAgentTab />
        )}
      </div>

      {/* HubForgekinEditor 编辑抽屉 —— 右侧固定抽屉，未保存关闭时内部弹确认 */}
      <HubForgekinEditor
        forgekinId={editingForgekinId}
        open={editorOpen}
        onClose={handleEditorClose}
      />
    </div>
  );
}
