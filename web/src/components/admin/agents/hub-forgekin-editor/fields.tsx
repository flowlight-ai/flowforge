"use client";

/**
 * fields.tsx — 基础表单字段组件
 *
 * 提供 Forgekin 编辑器的基础输入控件：名称 / 角色 / 形态 / 系统提示词 / CLI 绑定 / 保存状态提示。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖 clowder-ai 任何组件。
 */

import { useState } from "react";
import type { CliBinding, CliTool, ConnectionMode, RoleKind, SpeciesKind } from "./model";
import {
  ROLE_OPTIONS,
  SPECIES_OPTIONS,
  CLI_TOOL_OPTIONS,
  CONNECTION_MODE_OPTIONS,
} from "./model";
import type { ForgekinBinding } from "./client";

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

/* ------------------------------------------------------------------ */
/* CliBindingSection                                                   */
/* ------------------------------------------------------------------ */

interface CliBindingSectionProps {
  /** CLI 绑定表单值 */
  value: CliBinding;
  /** 表单变更回调 */
  onChange: (patch: Partial<CliBinding>) => void;
  /** 后端绑定状态（连通性 + API key 配置状态），可选 */
  bindingStatus?: ForgekinBinding | null;
  disabled?: boolean;
}

/**
 * CliBindingSection —— CLI 工具绑定分区。
 *
 * 提供以下编辑能力：
 *   - CLI 工具下拉选择（claude_code/codex/gemini/opencode/...）
 *   - 模型 ID 输入
 *   - API Key 输入（密码类型，支持显示/隐藏切换）
 *   - 连接模式选择（cli/bridge/api）
 *
 * 当传入 bindingStatus 时，额外展示连通状态与 API key 配置状态徽章。
 *
 * 红线 11：API key 通过 PUT 请求传给后端，后端存到 .env（已 gitignore），
 * 前端不持久化密钥，仅在输入框中暂存于组件状态。
 */
export function CliBindingSection({
  value,
  onChange,
  bindingStatus,
  disabled,
}: CliBindingSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <section
      className="rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-4 space-y-3"
      data-forgekin-section="cli-binding"
    >
      <h3 className="text-xs font-semibold text-[var(--cafe-text-secondary,#9ca3af)] uppercase tracking-wider mb-2">
        CLI 工具绑定
      </h3>

      {/* CLI 工具选择 */}
      <div className="forgekin-field" data-forgekin-field="cli-tool">
        <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-cli-tool">
          CLI 工具
        </label>
        <select
          id="forgekin-cli-tool"
          className={FIELD_INPUT_CLASS}
          value={value.cli_tool}
          onChange={(e) => onChange({ cli_tool: e.target.value as CliTool })}
          disabled={disabled}
          data-forgekin-input="cli-tool"
        >
          {CLI_TOOL_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* 模型 ID */}
      <div className="forgekin-field" data-forgekin-field="model-id">
        <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-model-id">
          模型 ID
        </label>
        <input
          id="forgekin-model-id"
          type="text"
          className={`${FIELD_INPUT_CLASS} font-mono`}
          value={value.model_id}
          onChange={(e) => onChange({ model_id: e.target.value })}
          disabled={disabled}
          maxLength={128}
          placeholder="如 gemini-2.5-flash / Doubao-Seed2.0"
          data-forgekin-input="model-id"
        />
      </div>

      {/* API Key（密码类型，支持显示/隐藏） */}
      <div className="forgekin-field" data-forgekin-field="api-key">
        <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-api-key">
          API Key
        </label>
        <div className="relative">
          <input
            id="forgekin-api-key"
            type={showApiKey ? "text" : "password"}
            className={`${FIELD_INPUT_CLASS} font-mono pr-16`}
            value={value.api_key}
            onChange={(e) => onChange({ api_key: e.target.value })}
            disabled={disabled}
            maxLength={256}
            placeholder={bindingStatus?.api_key_configured ? "已配置（输入可覆盖）" : "输入 API Key"}
            data-forgekin-input="api-key"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded text-[var(--cafe-text-muted,#6b7280)] hover:text-[var(--cafe-text,#e5e7eb)] hover:bg-[var(--console-rail-item,#252633)] transition-colors"
            tabIndex={-1}
            aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
          >
            {showApiKey ? "隐藏" : "显示"}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
          密钥存储到 .env 文件（已 gitignore），YAML 中仅存环境变量引用。
        </p>
      </div>

      {/* 连接模式 */}
      <div className="forgekin-field" data-forgekin-field="connection-mode">
        <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-connection-mode">
          连接模式
        </label>
        <select
          id="forgekin-connection-mode"
          className={FIELD_INPUT_CLASS}
          value={value.mode}
          onChange={(e) => onChange({ mode: e.target.value as ConnectionMode })}
          disabled={disabled}
          data-forgekin-input="connection-mode"
        >
          {CONNECTION_MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* 绑定状态徽章 */}
      {bindingStatus && (
        <div className="flex flex-wrap items-center gap-2 pt-1" data-forgekin-binding-status="true">
          <span
            className="text-[10px] px-2 py-0.5 rounded font-medium"
            style={{
              background: bindingStatus.connected
                ? "var(--semantic-success-surface,rgba(34,197,94,0.15))"
                : "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
              color: bindingStatus.connected
                ? "var(--semantic-success,#22c55e)"
                : "var(--semantic-critical,#ef4444)",
            }}
          >
            {bindingStatus.connected ? "● CLI 已连通" : "○ CLI 未连通"}
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded font-medium"
            style={{
              background: bindingStatus.api_key_configured
                ? "var(--semantic-info-surface,rgba(59,130,246,0.15))"
                : "var(--semantic-warning-surface,rgba(245,158,11,0.15))",
              color: bindingStatus.api_key_configured
                ? "var(--semantic-info,#3b82f6)"
                : "var(--semantic-warning,#f59e0b)",
            }}
          >
            {bindingStatus.api_key_configured ? "● API Key 已配置" : "○ API Key 未配置"}
          </span>
          {bindingStatus.connectivity_reason && (
            <span className="text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
              {bindingStatus.connectivity_reason}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
