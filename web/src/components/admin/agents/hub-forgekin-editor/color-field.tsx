"use client";

/**
 * color-field.tsx — 颜色字段组件
 *
 * 提供 Forgekin 主题色编辑能力：颜色预览圆 + 颜色选择器 + 十六进制文本输入。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖 clowder-ai 任何组件。
 */

import { useEffect, useState } from "react";

interface ColorFieldProps {
  /** 字段标签 */
  label: string;
  /** 当前颜色值（十六进制，如 #D4A017） */
  value: string;
  /** 颜色变化回调 */
  onChange: (value: string) => void;
  disabled?: boolean;
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * ColorField —— 颜色字段。
 *
 * 渲染三部分：
 *   1. 颜色预览圆（圆形色块，直观展示当前颜色）
 *   2. 颜色选择器（input type=color，原生取色器）
 *   3. 十六进制文本输入（手动输入色值，支持实时校验）
 *
 * 文本输入与取色器双向同步；非法输入不向上冒泡，避免污染表单状态。
 */
export function ColorField({ label, value, onChange, disabled }: ColorFieldProps) {
  const [text, setText] = useState<string>(value);

  // 当外部 value 变化（如初次加载、撤销重做）时同步文本框
  useEffect(() => {
    setText(value);
  }, [value]);

  const handleTextChange = (raw: string) => {
    setText(raw);
    // 仅在合法十六进制时向上冒泡
    if (HEX_COLOR_RE.test(raw)) {
      onChange(raw);
    }
  };

  const handleTextBlur = () => {
    // 失焦时若非法，回退到当前合法 value
    if (!HEX_COLOR_RE.test(text)) {
      setText(value);
    }
  };

  const handlePickerChange = (raw: string) => {
    onChange(raw);
    setText(raw);
  };

  const isValid = HEX_COLOR_RE.test(text);

  return (
    <div className="forgekin-color-field" data-forgekin-field="color">
      <label className="block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* 颜色预览圆 */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full border border-[var(--cafe-border,#2a2c3a)]"
          style={{
            background: isValid ? text : "var(--cafe-surface-sunken,#0f1015)",
            boxShadow: isValid ? `0 0 0 2px ${text}33` : "none",
          }}
          data-forgekin-color-preview="true"
          aria-hidden="true"
        />

        {/* 颜色选择器（原生 input type=color） */}
        <input
          type="color"
          className="flex-shrink-0 w-8 h-8 rounded cursor-pointer bg-transparent border border-[var(--cafe-border,#2a2c3a)] p-0"
          value={isValid ? text : "#000000"}
          onChange={(e) => handlePickerChange(e.target.value)}
          disabled={disabled}
          aria-label={`${label} 颜色选择器`}
          data-forgekin-input="color-picker"
        />

        {/* 十六进制文本输入 */}
        <input
          type="text"
          className={`flex-1 px-3 py-1.5 text-sm font-mono rounded-md bg-[var(--cafe-surface-sunken,#0f1015)] border text-[var(--cafe-text,#e5e7eb)] focus:outline-none transition-colors ${
            isValid
              ? "border-[var(--cafe-border,#2a2c3a)] focus:border-[var(--cafe-accent,#ff5c5c)]"
              : "border-[var(--semantic-critical,#ef4444)]"
          }`}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleTextBlur}
          disabled={disabled}
          maxLength={7}
          placeholder="#RRGGBB"
          data-forgekin-input="color-hex"
        />
      </div>
    </div>
  );
}
