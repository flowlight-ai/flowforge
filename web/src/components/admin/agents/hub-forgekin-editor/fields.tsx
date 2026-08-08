"use client";

/**
 * fields.tsx — 基础表单字段组件
 *
 * 提供 Forgekin 编辑器的基础输入控件：名称 / 角色 / 形态 / 系统提示词 / 保存状态提示。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖 clowder-ai 任何组件。
 */

import type { RoleKind, SpeciesKind } from "./model";
import { ROLE_OPTIONS, SPECIES_OPTIONS } from "./model";

/* ------------------------------------------------------------------ */
/* 共用样式                                                            */
/* ------------------------------------------------------------------ */

const FIELD_LABEL_CLASS =
  "block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider";

const FIELD_INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-md bg-[var(--cafe-surface-sunken,#0f1015)] border border-[var(--cafe-border,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] placeholder:text-[var(--cafe-text-muted,#6b7280)] focus:outline-none focus:border-[var(--cafe-accent,#ff5c5c)] transition-colors";

/* ------------------------------------------------------------------ */
/* NameField                                                           */
/* ------------------------------------------------------------------ */

interface NameFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 名称字段 —— 单行文本输入 */
export function NameField({ value, onChange, disabled }: NameFieldProps) {
  return (
    <div className="forgekin-field" data-forgekin-field="name">
      <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-name">
        名称
      </label>
      <input
        id="forgekin-name"
        type="text"
        className={FIELD_INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={32}
        placeholder="可进化智能体名称"
        data-forgekin-input="name"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RoleField                                                           */
/* ------------------------------------------------------------------ */

interface RoleFieldProps {
  value: RoleKind;
  onChange: (value: RoleKind) => void;
  disabled?: boolean;
}

/** 角色字段 —— 下拉选择（架构师/开发者/评审员/测试员/文档员） */
export function RoleField({ value, onChange, disabled }: RoleFieldProps) {
  return (
    <div className="forgekin-field" data-forgekin-field="role">
      <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-role">
        角色
      </label>
      <select
        id="forgekin-role"
        className={FIELD_INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value as RoleKind)}
        disabled={disabled}
        data-forgekin-input="role"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SpeciesField                                                        */
/* ------------------------------------------------------------------ */

interface SpeciesFieldProps {
  value: SpeciesKind;
  onChange: (value: SpeciesKind) => void;
  disabled?: boolean;
}

/** 形态字段 —— 下拉选择（BIO/ORG/OBJ/VIRTUAL/HYBRID） */
export function SpeciesField({ value, onChange, disabled }: SpeciesFieldProps) {
  return (
    <div className="forgekin-field" data-forgekin-field="species">
      <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-species">
        形态
      </label>
      <select
        id="forgekin-species"
        className={FIELD_INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value as SpeciesKind)}
        disabled={disabled}
        data-forgekin-input="species"
      >
        {SPECIES_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SystemPromptField                                                   */
/* ------------------------------------------------------------------ */

interface SystemPromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 系统提示词字段 —— 多行文本框 */
export function SystemPromptField({ value, onChange, disabled }: SystemPromptFieldProps) {
  return (
    <div className="forgekin-field" data-forgekin-field="system-prompt">
      <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-system-prompt">
        系统提示词
      </label>
      <textarea
        id="forgekin-system-prompt"
        className={`${FIELD_INPUT_CLASS} resize-y min-h-[120px] leading-relaxed font-mono`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={4000}
        placeholder="定义该可进化智能体的人设、能力边界与行为约束..."
        data-forgekin-input="system-prompt"
      />
      <div className="mt-1 text-right text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
        {value.length} / 4000
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PersistenceBanner                                                   */
/* ------------------------------------------------------------------ */

export type PersistenceState = "idle" | "saving" | "saved" | "error";

interface PersistenceBannerProps {
  state: PersistenceState;
  message?: string;
}

const PERSISTENCE_STYLES: Record<
  PersistenceState,
  { bg: string; color: string; label: string; icon: string }
> = {
  idle: {
    bg: "transparent",
    color: "var(--cafe-text-muted,#6b7280)",
    label: "未修改",
    icon: "○",
  },
  saving: {
    bg: "var(--semantic-info-surface,rgba(59,130,246,0.15))",
    color: "var(--semantic-info,#3b82f6)",
    label: "保存中...",
    icon: "◐",
  },
  saved: {
    bg: "var(--semantic-success-surface,rgba(34,197,94,0.15))",
    color: "var(--semantic-success,#22c55e)",
    label: "已保存",
    icon: "✓",
  },
  error: {
    bg: "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
    color: "var(--semantic-critical,#ef4444)",
    label: "保存失败",
    icon: "✕",
  },
};

/**
 * PersistenceBanner —— 保存状态提示条。
 *
 * 三态：saving / saved / error（外加 idle 初始态）。
 * 当 state 为 error 且提供 message 时，展示后端返回的错误详情。
 */
export function PersistenceBanner({ state, message }: PersistenceBannerProps) {
  if (state === "idle") {
    return null;
  }
  const style = PERSISTENCE_STYLES[state];
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
      style={{ background: style.bg, color: style.color }}
      data-forgekin-persistence={state}
      role="status"
      aria-live="polite"
    >
      <span className={state === "saving" ? "animate-spin inline-block" : ""}>
        {style.icon}
      </span>
      <span className="font-medium">{style.label}</span>
      {message && <span className="opacity-80">· {message}</span>}
    </div>
  );
}
