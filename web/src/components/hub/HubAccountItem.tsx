"use client";

/**
 * HubAccountItem — Provider 账户行项
 *
 * 移植自 clowder-ai HubAccountItem，适配 FlowForge 暗色主题。
 * 用于 HubAccountsTab 内部，渲染单个 Provider 账户的行项：
 *   - 显示名称、摘要元信息（host/auth/models）
 *   - 认证类型徽章（oauth / api_key）
 *   - 删除按钮（带确认弹窗）
 *   - 可选编辑回调（点击行触发）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖 clowder-ai 任何组件，内联类型与原语。
 */

import { useConfirm } from "@/components/useConfirm";

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface ProfileItem {
  id: string;
  displayName: string;
  provider: string;
  baseUrl?: string;
  clientId?: string;
  /** 'oauth' | 'api_key'；默认 'api_key' */
  authType?: "oauth" | "api_key";
  /** API Key 是否已配置 */
  hasApiKey?: boolean;
  models?: string[];
  builtin?: boolean;
  envVars?: Record<string, string>;
}

interface HubAccountItemProps {
  profile: ProfileItem;
  busy: boolean;
  onDelete: (profileId: string) => void;
  onEdit?: (profile: ProfileItem) => void;
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

/** 内置 OAuth Client 标签（简化版：按 clientId 前缀匹配） */
function builtinClientLabel(clientId: string): string | null {
  if (clientId.startsWith("forge-")) return "FlowForge 内置";
  if (clientId.startsWith("anthropic-")) return "Anthropic 官方";
  if (clientId.startsWith("openai-")) return "OpenAI 官方";
  if (clientId.startsWith("google-")) return "Google 官方";
  return null;
}

/** 生成账户摘要元信息 */
function summaryMeta(profile: ProfileItem): string {
  const parts: string[] = [];
  if (profile.authType === "oauth") {
    const label = profile.clientId ? builtinClientLabel(profile.clientId) : null;
    if (label) parts.push(label);
  } else {
    const host =
      profile.baseUrl?.replace(/^https?:\/\//, "").replace(/\/+$/, "") || null;
    if (host) parts.push(host);
    parts.push(profile.hasApiKey ? "已配置" : "未配置");
  }
  if (profile.models && profile.models.length > 0) {
    parts.push(profile.models.join(", "));
  } else {
    parts.push("0 模型");
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* 内联原语（替代 clowder-ai settings/primitives）                      */
/* ------------------------------------------------------------------ */

const TONE_CLASSES: Record<string, string> = {
  amber:
    "bg-[var(--conn-amber-bg,rgba(245,158,11,0.15))] text-[var(--conn-amber-text,#f59e0b)]",
  purple:
    "bg-[var(--conn-purple-bg,rgba(139,92,246,0.15))] text-[var(--conn-purple-text,#8b5cf6)]",
  emerald:
    "bg-[var(--conn-emerald-bg,rgba(16,185,129,0.15))] text-[var(--conn-emerald-text,#10b981)]",
  gray: "bg-[var(--cafe-surface-sunken,#0f1015)] text-[var(--cafe-text-muted,#6b7280)]",
};

function SettingsBadge({
  tone = "gray",
  children,
}: {
  tone?: "amber" | "purple" | "emerald" | "gray";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${TONE_CLASSES[tone] ?? TONE_CLASSES.gray}`}
      data-account-badge={tone}
    >
      {children}
    </span>
  );
}

function SettingsDeleteButton({
  disabled,
  "aria-label": ariaLabel,
  onClick,
}: {
  disabled?: boolean;
  "aria-label"?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--cafe-text-muted,#6b7280)] hover:text-[var(--semantic-critical,#ef4444)] hover:bg-[var(--semantic-critical-surface,rgba(239,68,68,0.1))] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      data-account-action="delete"
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke="currentColor"
      >
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

function SettingsRow({
  title,
  meta,
  badges,
  actions,
  onClick,
}: {
  title: string;
  meta?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] ${
        clickable ? "cursor-pointer hover:border-[var(--cafe-accent,#ff5c5c)] transition-colors" : ""
      }`}
      data-account-row={clickable ? "clickable" : "static"}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--cafe-text,#e5e7eb)] truncate">
            {title}
          </span>
          {badges}
        </div>
        {meta && (
          <div className="mt-0.5 text-[11px] text-[var(--cafe-text-muted,#6b7280)] truncate">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HubAccountItem 主组件                                                */
/* ------------------------------------------------------------------ */

export function HubAccountItem({ profile, busy, onDelete, onEdit }: HubAccountItemProps) {
  const confirm = useConfirm();

  return (
    <SettingsRow
      title={profile.displayName}
      meta={summaryMeta(profile)}
      badges={
        <SettingsBadge tone={profile.authType === "oauth" ? "amber" : "purple"}>
          {profile.authType === "oauth" ? "oauth" : "api_key"}
        </SettingsBadge>
      }
      actions={
        <SettingsDeleteButton
          disabled={busy}
          aria-label="删除账号"
          onClick={async () => {
            if (
              await confirm({
                title: "删除确认",
                message: `确认删除账号「${profile.displayName}」吗？该操作不可撤销。`,
                variant: "danger",
                confirmText: "删除",
              })
            ) {
              onDelete(profile.id);
            }
          }}
        />
      }
      onClick={onEdit ? () => onEdit(profile) : undefined}
    />
  );
}

export default HubAccountItem;
