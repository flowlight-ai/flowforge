"use client";

import { SettingsShell } from "@/components/settings/SettingsShell";

/**
 * 设置中心 — Phase 5 SettingsShell 架构
 *
 * 依据 WEB-FUSION-DESIGN.md §7 重构：
 *   - 旧版 509 行单页 7-Tab 设置已迁移为 SettingsShell 架构
 *   - 14 个 section + 22 个 primitives（从 clowder-ai 移植并简化）
 *   - 左侧导航 + 右侧内容，支持 URL 深链（?s=sectionId）
 *
 * 旧版功能映射：
 *   - workflows/agents/modes/tools → system section
 *   - prompts → rules section
 *   - terminal → 暂未迁移（后续可在 ops section 扩展）
 *   - memory → 暂未迁移（后续可在 ops section 扩展）
 */
export default function AdminSettingsPage() {
  return <SettingsShell />;
}
