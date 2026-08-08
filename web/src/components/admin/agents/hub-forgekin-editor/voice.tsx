"use client";

/**
 * voice.tsx — 语音配置分区
 *
 * 提供可进化智能体的 TTS 语音、语速、音调配置能力。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖上游
 */

import type { VoiceConfig } from "./model";

interface VoiceSectionProps {
  value: VoiceConfig;
  onChange: (patch: Partial<VoiceConfig>) => void;
  disabled?: boolean;
}

/** 可选的 TTS 语音 ID（中文场景常用） */
const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓（女声·温和）" },
  { value: "zh-CN-YunxiNeural", label: "云希（男声·沉稳）" },
  { value: "zh-CN-YunyangNeural", label: "云扬（男声·专业）" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊（女声·活泼）" },
  { value: "zh-CN-YunjianNeural", label: "云健（男声·有力）" },
  { value: "zh-CN-XiaochenNeural", label: "晓辰（女声·成熟）" },
  { value: "zh-CN-XiaohanNeural", label: "晓涵（女声·温暖）" },
  { value: "zh-CN-XiaomengNeural", label: "晓梦（女声·柔和）" },
  { value: "zh-CN-XiaomoNeural", label: "晓墨（女声·冷静）" },
  { value: "zh-CN-XiaoqiuNeural", label: "晓秋（女声·亲切）" },
];

const SECTION_TITLE_CLASS =
  "text-xs font-semibold text-[var(--cafe-text-secondary,#9ca3af)] uppercase tracking-wider mb-3";
const FIELD_LABEL_CLASS =
  "flex items-center justify-between text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5";
const FIELD_VALUE_CLASS = "font-mono text-[var(--cafe-accent,#ff5c5c)]";
const SELECT_CLASS =
  "w-full px-3 py-2 text-sm rounded-md bg-[var(--cafe-surface-sunken,#0f1015)] border border-[var(--cafe-border,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] focus:outline-none focus:border-[var(--cafe-accent,#ff5c5c)] transition-colors";
const SLIDER_CLASS =
  "w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--console-rail-item,#252633)] accent-[var(--cafe-accent,#ff5c5c)]";

/**
 * VoiceSection —— 语音配置分区。
 *
 * 包含：
 *   - TTS 语音选择下拉
 *   - 语速滑块（0.5 - 2.0）
 *   - 音调滑块（-10 到 10）
 */
export function VoiceSection({ value, onChange, disabled }: VoiceSectionProps) {
  return (
    <section className="forgekin-section" data-forgekin-section="voice">
      <h3 className={SECTION_TITLE_CLASS}>语音配置</h3>

      <div className="space-y-4">
        {/* TTS 语音选择 */}
        <div data-forgekin-field="voice">
          <label className="block text-xs font-medium text-[var(--cafe-text-muted,#6b7280)] mb-1.5 uppercase tracking-wider" htmlFor="forgekin-voice">
            TTS 语音
          </label>
          <select
            id="forgekin-voice"
            className={SELECT_CLASS}
            value={value.voice}
            onChange={(e) => onChange({ voice: e.target.value })}
            disabled={disabled}
            data-forgekin-input="voice"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* 语速 */}
        <div data-forgekin-field="voice-rate">
          <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-voice-rate">
            <span>语速</span>
            <span className={FIELD_VALUE_CLASS}>{value.rate.toFixed(2)}x</span>
          </label>
          <input
            id="forgekin-voice-rate"
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            className={SLIDER_CLASS}
            value={value.rate}
            onChange={(e) => onChange({ rate: parseFloat(e.target.value) })}
            disabled={disabled}
            data-forgekin-input="voice-rate"
          />
          <div className="flex justify-between text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
            <span>0.5x · 慢</span>
            <span>1.0x</span>
            <span>2.0x · 快</span>
          </div>
        </div>

        {/* 音调 */}
        <div data-forgekin-field="voice-pitch">
          <label className={FIELD_LABEL_CLASS} htmlFor="forgekin-voice-pitch">
            <span>音调</span>
            <span className={FIELD_VALUE_CLASS}>{value.pitch > 0 ? `+${value.pitch}` : value.pitch}</span>
          </label>
          <input
            id="forgekin-voice-pitch"
            type="range"
            min={-10}
            max={10}
            step={1}
            className={SLIDER_CLASS}
            value={value.pitch}
            onChange={(e) => onChange({ pitch: parseInt(e.target.value, 10) })}
            disabled={disabled}
            data-forgekin-input="voice-pitch"
          />
          <div className="flex justify-between text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
            <span>-10 · 低沉</span>
            <span>0</span>
            <span>+10 · 高亢</span>
          </div>
        </div>
      </div>
    </section>
  );
}
