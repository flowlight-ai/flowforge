"use client";

/**
 * advanced.tsx — 高级运行时参数分区
 *
 * 提供温度 / top_p / max_tokens 三个运行时参数的编辑能力。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖 clowder-ai 任何组件。
 */

import type { ForgekinFormData } from "./model";

interface AdvancedRuntimeSectionProps {
  value: Pick<ForgekinFormData, "temperature" | "topP" | "maxTokens">;
  onChange: (patch: Partial<Pick<ForgekinFormData, "temperature" | "topP" | "maxTokens">>) => void;
  disabled?: boolean;
}

const SECTION_TITLE_CLASS =
  "text-xs font-semibold text-[var(--cafe-text-secondary,#9ca3af)] uppercase tracking-wider mb-3";
const FIELD_LABEL_CLASS =
  "flex items-center justify-between text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5";
const FIELD_VALUE_CLASS = "font-mono text-[var(--cafe-accent,#ff5c5c)]";

const SLIDER_CLASS =
  "w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--console-rail-item,#252633)] accent-[var(--cafe-accent,#ff5c5c)]";

const NUMBER_INPUT_CLASS =
  "w-full px-3 py-2 text-sm font-mono rounded-md bg-[var(--cafe-surface-sunken,#0f1015)] border border-[var(--cafe-border,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] focus:outline-none focus:border-[var(--cafe-accent,#ff5c5c)] transition-colors";

/**
 * AdvancedRuntimeSection —— 高级运行时参数分区。
 *
 * 包含：
 *   - 温度滑块（0 - 2，步进 0.1）
 *   - top_p 滑块（0 - 1，步进 0.05）
 *   - max_tokens 数字输入（1 - 32768）
 *
 * 每个 slider 实时显示当前数值。
 */
export function AdvancedRuntimeSection({ value, onChange, disabled }: AdvancedRuntimeSectionProps) {
  return (
    <section className="forgekin-section" data-forgekin-section="advanced-runtime">
      <h3 className={SECTION_TITLE_CLASS}>高级运行时参数</h3>

      <div className="space-y-4">
        {/* 温度 */}
        <div data-forgekin-field="temperature">
          <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-temperature">
            <span>温度（Temperature）</span>
            <span className={FIELD_VALUE_CLASS}>{value.temperature.toFixed(1)}</span>
          </label>
          <input
            id="forgekin-temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            className={SLIDER_CLASS}
            value={value.temperature}
            onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
            disabled={disabled}
            data-forgekin-input="temperature"
          />
          <div className="flex justify-between text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
            <span>0 · 确定</span>
            <span>1 · 平衡</span>
            <span>2 · 发散</span>
          </div>
        </div>

        {/* top_p */}
        <div data-forgekin-field="top-p">
          <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-top-p">
            <span>Top P</span>
            <span className={FIELD_VALUE_CLASS}>{value.topP.toFixed(2)}</span>
          </label>
          <input
            id="forgekin-top-p"
            type="range"
            min={0}
            max={1}
            step={0.05}
            className={SLIDER_CLASS}
            value={value.topP}
            onChange={(e) => onChange({ topP: parseFloat(e.target.value) })}
            disabled={disabled}
            data-forgekin-input="top-p"
          />
          <div className="flex justify-between text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
            <span>0.00</span>
            <span>0.50</span>
            <span>1.00</span>
          </div>
        </div>

        {/* max_tokens */}
        <div data-forgekin-field="max-tokens">
          <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-max-tokens">
            <span>最大 Token 数</span>
            <span className={FIELD_VALUE_CLASS}>{value.maxTokens}</span>
          </label>
          <input
            id="forgekin-max-tokens"
            type="number"
            min={1}
            max={32768}
            step={1}
            className={NUMBER_INPUT_CLASS}
            value={value.maxTokens}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (Number.isFinite(raw)) {
                onChange({ maxTokens: Math.min(32768, Math.max(1, raw)) });
              }
            }}
            disabled={disabled}
            data-forgekin-input="max-tokens"
          />
          <div className="flex justify-between text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
            <span>1</span>
            <span>32768</span>
          </div>
        </div>
      </div>
    </section>
  );
}
