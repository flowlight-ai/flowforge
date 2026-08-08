/**
 * OklchTuner — OKLCH 调色器（简化版）
 *
 * 来源：clowder-ai/packages/web/src/components/dev/OklchTuner.tsx（简化适配 flowforge）
 * 职责：实时调整 --accent-hue / --accent-chroma / --surface-hue 三个 OKLCH 锚点变量
 *
 * 与 clowder-ai 版本的差异：
 *   - clowder-ai 依赖 useThemeStore + 6 个辅助文件（engine/hooks/drag/slider/css/extra）
 *   - flowforge 版本直接操作 document.documentElement.style 修改 CSS 变量
 *   - 去除了多主题管理、拖拽、复制功能（简化为核心调色功能）
 *   - 保留了 OKLCH 色相/饱和度滑块 + 实时预览 + 重置功能
 *
 * 使用方式：
 *   <OklchTuner onClose={() => setShowTuner(false)} />
 *   通常由 ThemeMenu 的 onEditTheme 回调触发显示
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "./ThemeProvider";

interface OklchParams {
  accentHue: number;
  accentChroma: number;
  surfaceHue: number;
}

// theme-tokens.css 中的默认值
const DEFAULT_LIGHT: OklchParams = { accentHue: 50, accentChroma: 0.14, surfaceHue: 80 };
const DEFAULT_DARK: OklchParams = { accentHue: 35, accentChroma: 0.08, surfaceHue: 30 };

const STORAGE_KEY = "flowforge-oklch-tuner";

function loadParams(resolvedTheme: "light" | "dark"): OklchParams {
  if (typeof window === "undefined") return DEFAULT_LIGHT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed[resolvedTheme]) return parsed[resolvedTheme];
    }
  } catch {}
  return resolvedTheme === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT;
}

function saveParams(resolvedTheme: "light" | "dark", params: OklchParams) {
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const all = stored ? JSON.parse(stored) : {};
    all[resolvedTheme] = params;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

function applyParams(params: OklchParams) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent-hue", String(params.accentHue));
  root.style.setProperty("--accent-chroma", String(params.accentChroma));
  root.style.setProperty("--surface-hue", String(params.surfaceHue));
}

function clearParams() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.removeProperty("--accent-hue");
  root.style.removeProperty("--accent-chroma");
  root.style.removeProperty("--surface-hue");
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
  swatch,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: string;
  onChange: (v: number) => void;
  swatch?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-[10px] font-mono text-[var(--muted)] shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="flex-1 h-1 accent-[var(--accent)]"
      />
      <span className="w-12 text-right text-[10px] font-mono tabular-nums text-[var(--muted)] shrink-0">{fmt}</span>
      {swatch && (
        <div
          className="w-4 h-4 rounded border border-[var(--border)] shrink-0"
          style={{ background: swatch }}
        />
      )}
    </div>
  );
}

export function OklchTuner({ onClose }: { onClose: () => void }) {
  const { resolvedTheme } = useTheme();
  const [params, setParams] = useState<OklchParams>(() => loadParams(resolvedTheme));
  const skipSync = useRef(true);

  // 主题切换时重新加载参数
  useEffect(() => {
    skipSync.current = true;
    setParams(loadParams(resolvedTheme));
  }, [resolvedTheme]);

  // 实时应用 CSS 变量 + 持久化
  useEffect(() => {
    applyParams(params);
    if (skipSync.current) {
      skipSync.current = false;
    } else {
      saveParams(resolvedTheme, params);
    }
  }, [params, resolvedTheme]);

  const handleReset = useCallback(() => {
    const defaults = resolvedTheme === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT;
    setParams(defaults);
    clearParams();
    // 清除 localStorage
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [resolvedTheme]);

  const accentSwatch = `oklch(0.65 ${params.accentChroma} ${params.accentHue})`;
  const surfaceSwatch = `oklch(0.88 0.01 ${params.surfaceHue})`;

  return (
    <div
      className="fixed z-[9999] w-[380px] max-h-[80vh] overflow-y-auto rounded-xl bg-[var(--bg-elevated)] text-[var(--text)] shadow-2xl border border-[var(--border)] text-xs"
      style={{ left: 70, top: 80 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-elevated)] z-10">
        <span className="font-bold text-sm flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.12-.29-.29-.44-.66-.44-1.13 0-.92.75-1.67 1.67-1.67H17c3.04 0 5.5-2.5 5.5-5.56C22.5 6.01 17.96 2 12 2z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" />
            <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
          </svg>
          OKLCH 调色器
          <span className="text-[10px] text-[var(--muted)] font-normal ml-1">
            ({resolvedTheme === "dark" ? "暗色" : "亮色"})
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* 1. 全局主题色 */}
        <div className="space-y-1.5 pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-[var(--muted)] font-bold flex items-center gap-1">
              全局主题色 (按钮/链接/高亮)
            </div>
            <div
              className="w-4 h-4 rounded border border-[var(--border)] shrink-0 ml-auto"
              style={{ background: accentSwatch }}
            />
          </div>
          <Slider
            label="H"
            value={params.accentHue}
            min={0}
            max={360}
            step={1}
            fmt={`${params.accentHue}°`}
            onChange={(v) => setParams((p) => ({ ...p, accentHue: v }))}
            swatch={accentSwatch}
          />
          <Slider
            label="C"
            value={params.accentChroma}
            min={0}
            max={0.3}
            step={0.005}
            fmt={params.accentChroma.toFixed(3)}
            onChange={(v) => setParams((p) => ({ ...p, accentChroma: v }))}
            swatch={accentSwatch}
          />
          <div className="flex gap-0.5 pl-7">
            {[0.97, 0.88, 0.65, 0.55, 0.45, 0.35, 0.2].map((l) => (
              <div
                key={l}
                className="flex-1 h-3 rounded-sm border border-[var(--border)]"
                style={{ background: `oklch(${l} ${params.accentChroma} ${params.accentHue})` }}
              />
            ))}
          </div>
        </div>

        {/* 2. 页面底色 */}
        <div className="space-y-1.5 pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-[var(--muted)] font-bold flex items-center gap-1">
              页面底色色调
            </div>
            <div
              className="w-4 h-4 rounded border border-[var(--border)] shrink-0 ml-auto"
              style={{ background: surfaceSwatch }}
            />
          </div>
          <Slider
            label="H"
            value={params.surfaceHue}
            min={0}
            max={360}
            step={1}
            fmt={`${params.surfaceHue}°`}
            onChange={(v) => setParams((p) => ({ ...p, surfaceHue: v }))}
            swatch={surfaceSwatch}
          />
        </div>

        {/* 3. 预览 */}
        <div className="space-y-1 pb-2 border-b border-[var(--border)]">
          <div className="text-[10px] text-[var(--muted)] font-bold mb-1">预览</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity text-[10px] font-medium"
            >
              主按钮
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-hover)] text-[10px]"
            >
              次按钮
            </button>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="px-3 py-1.5 text-[var(--accent)] text-[10px] underline"
            >
              链接
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-elevated)] z-10">
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 rounded-lg text-[10px] text-[var(--muted)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          重置默认
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-[10px] bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium"
        >
          保存并关闭
        </button>
      </div>
    </div>
  );
}

export default OklchTuner;
