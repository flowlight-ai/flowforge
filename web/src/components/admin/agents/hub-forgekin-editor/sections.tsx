"use client";

/**
 * sections.tsx — 分区渲染组件
 *
 * 组合基础字段为更高层级的分区：身份 / 账户 / 路由。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖上游
 */

import type { ForgekinFormData, ModelAccount, RoutingStrategy } from "./model";
import {
  MODEL_ACCOUNT_OPTIONS,
  ROUTING_OPTIONS,
} from "./model";
import { NameField, RoleField, SpeciesField } from "./fields";
import { ColorField } from "./color-field";
import { HubTagEditor } from "@/components/hub/HubTagEditor";

/* ------------------------------------------------------------------ */
/* 共用样式                                                            */
/* ------------------------------------------------------------------ */

const SECTION_WRAPPER_CLASS =
  "rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-4 space-y-3";
const SECTION_TITLE_CLASS =
  "text-xs font-semibold text-[var(--cafe-text-secondary,#9ca3af)] uppercase tracking-wider mb-2";
const SELECT_CLASS =
  "w-full px-3 py-2 text-sm rounded-md bg-[var(--cafe-surface-sunken,#0f1015)] border border-[var(--cafe-border,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] focus:outline-none focus:border-[var(--cafe-accent,#ff5c5c)] transition-colors";

/* ------------------------------------------------------------------ */
/* IdentitySection                                                     */
/* ------------------------------------------------------------------ */

interface IdentitySectionProps {
  value: Pick<ForgekinFormData, "name" | "nickname" | "species" | "role" | "themeColor">;
  onChange: (patch: Partial<Pick<ForgekinFormData, "name" | "nickname" | "species" | "role" | "themeColor">>) => void;
  disabled?: boolean;
}

/**
 * IdentitySection —— 身份分区。
 *
 * 包含：NameField + RoleField + SpeciesField + ColorField（主题色）。
 * 这是 Forgekin 编辑器中最核心的分区，定义可进化智能体的身份标识。
 */
export function IdentitySection({ value, onChange, disabled }: IdentitySectionProps) {
  return (
    <section className={SECTION_WRAPPER_CLASS} data-forgekin-section="identity">
      <h3 className={SECTION_TITLE_CLASS}>身份（Identity）</h3>

      <NameField
        value={value.name}
        onChange={(name) => onChange({ name })}
        disabled={disabled}
      />

      <div className="forgekin-field" data-forgekin-field="nickname">
        <label className="block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider" htmlFor="forgekin-nickname">
          昵称
        </label>
        <input
          id="forgekin-nickname"
          type="text"
          className={SELECT_CLASS}
          value={value.nickname}
          onChange={(e) => onChange({ nickname: e.target.value })}
          disabled={disabled}
          maxLength={32}
          placeholder="显示昵称"
          data-forgekin-input="nickname"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <RoleField
          value={value.role}
          onChange={(role) => onChange({ role })}
          disabled={disabled}
        />
        <SpeciesField
          value={value.species}
          onChange={(species) => onChange({ species })}
          disabled={disabled}
        />
      </div>

      <ColorField
        label="主题色"
        value={value.themeColor}
        onChange={(themeColor) => onChange({ themeColor })}
        disabled={disabled}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* AccountSection                                                      */
/* ------------------------------------------------------------------ */

interface AccountSectionProps {
  value: Pick<ForgekinFormData, "model">;
  onChange: (patch: Partial<Pick<ForgekinFormData, "model">>) => void;
  disabled?: boolean;
}

/**
 * AccountSection —— 模型账户分区。
 *
 * 提供 Provider 通道选择：builtin / openai / anthropic / zhipu / doubao。
 */
export function AccountSection({ value, onChange, disabled }: AccountSectionProps) {
  return (
    <section className={SECTION_WRAPPER_CLASS} data-forgekin-section="account">
      <h3 className={SECTION_TITLE_CLASS}>模型账户</h3>

      <div className="forgekin-field" data-forgekin-field="model">
        <label className="block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider" htmlFor="forgekin-model-account">
          Provider 通道
        </label>
        <select
          id="forgekin-model-account"
          className={SELECT_CLASS}
          value={value.model}
          onChange={(e) => onChange({ model: e.target.value as ModelAccount })}
          disabled={disabled}
          data-forgekin-input="model-account"
        >
          {MODEL_ACCOUNT_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
          选择该可进化智能体调用 LLM 时使用的 Provider 通道。
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* RoutingSection                                                      */
/* ------------------------------------------------------------------ */

interface RoutingSectionProps {
  value: Pick<ForgekinFormData, "routing">;
  onChange: (patch: Partial<Pick<ForgekinFormData, "routing">>) => void;
  disabled?: boolean;
}

/**
 * RoutingSection —— 路由策略分区。
 *
 * 提供：轮询 / 优先级 / 权重 三种策略。
 */
export function RoutingSection({ value, onChange, disabled }: RoutingSectionProps) {
  return (
    <section className={SECTION_WRAPPER_CLASS} data-forgekin-section="routing">
      <h3 className={SECTION_TITLE_CLASS}>路由策略</h3>

      <div className="forgekin-field" data-forgekin-field="routing">
        <label className="block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider" htmlFor="forgekin-routing">
          多通道选择策略
        </label>
        <select
          id="forgekin-routing"
          className={SELECT_CLASS}
          value={value.routing}
          onChange={(e) => onChange({ routing: e.target.value as RoutingStrategy })}
          disabled={disabled}
          data-forgekin-input="routing"
        >
          {ROUTING_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
          轮询：依次切换通道；优先级：按顺序优先选用可用通道；权重：按权重随机分配。
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* TagSection                                                          */
/* ------------------------------------------------------------------ */

interface TagSectionProps {
  /** Forgekin ID（用于持久化标签到 /api/v1/forgemind/{id}/tags） */
  forgekinId: string;
  /** 初始标签（可选；不传则从 API 加载） */
  initialTags?: string[];
  /** 标签保存后的回调 */
  onSaved?: (tags: string[]) => void;
  disabled?: boolean;
}

/**
 * TagSection —— 标签分区。
 *
 * 包装 HubTagEditor，嵌入 Forgekin 编辑器，提供可进化智能体的
 * 标签管理能力（用于分组与过滤）。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 持久化：通过 /api/v1/forgemind/{forgekinId}/tags 端点独立保存。
 */
export function TagSection({ forgekinId, initialTags, onSaved, disabled }: TagSectionProps) {
  return (
    <section
      className={SECTION_WRAPPER_CLASS}
      data-forgekin-section="tags"
      aria-disabled={disabled || undefined}
    >
      <h3 className={SECTION_TITLE_CLASS}>标签（Tags）</h3>
      <p className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] mb-2">
        用于分组与过滤。回车或逗号确认，建议项可快速添加。
      </p>
      <HubTagEditor
        forgekinId={forgekinId}
        initialTags={initialTags}
        onSaved={onSaved}
      />
    </section>
  );
}
