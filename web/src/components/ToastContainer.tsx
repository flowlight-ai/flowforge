/**
 * ToastContainer — 全局 Toast 通知容器
 *
 * 职责：在应用右下角显示 toast 通知，支持自动消失、手动关闭
 *
 * 设计原则：
 *   - 通过 React Context 暴露 toast 函数
 *   - 支持 4 种类型：info / success / warning / error
 *   - 自动消失（默认 4 秒，error 类型 8 秒）
 *   - 不依赖第三方 toast 库
 */

"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  /** 类型 */
  type?: ToastType;
  /** 标题 */
  title?: string;
  /** 内容 */
  message: string;
  /** 持续时间（ms），0 = 不自动消失 */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "title" | "duration">> {
  id: string;
  title?: string;
  duration: number;
  createdAt: number;
}

type ToastFn = (options: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  info: { bg: "var(--semantic-info-surface)", border: "var(--semantic-info)", icon: "ℹ" },
  success: { bg: "var(--semantic-success-surface)", border: "var(--semantic-success)", icon: "✓" },
  warning: { bg: "var(--semantic-warning-surface)", border: "var(--semantic-warning)", icon: "⚠" },
  error: { bg: "var(--semantic-critical-surface)", border: "var(--semantic-critical)", icon: "✗" },
};

export function ToastContainer({ children }: { children?: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (options) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const type = options.type || "info";
      const duration = options.duration ?? DEFAULT_DURATION[type];
      const item: ToastItem = {
        id,
        type,
        title: options.title,
        message: options.message,
        duration,
        createdAt: Date.now(),
      };
      setToasts((prev) => [...prev, item]);

      // 自动消失
      if (duration > 0) {
        window.setTimeout(() => remove(id), duration);
      }
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2 max-w-sm"
        data-toast-container="true"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const style = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className="flex items-start gap-3 p-3 rounded-lg shadow-lg border-l-4 bg-[var(--cafe-surface-elevated)]"
              style={{
                borderLeftColor: style.border,
                background: style.bg,
              }}
              data-toast-item="true"
              data-toast-type={t.type}
              role={t.type === "error" ? "alert" : "status"}
            >
              <span className="text-lg leading-none mt-0.5" aria-hidden="true">
                {style.icon}
              </span>
              <div className="flex-1 min-w-0">
                {t.title && (
                  <div className="text-sm font-bold mb-0.5" data-toast-title="true">
                    {t.title}
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap break-words" data-toast-message="true">
                  {t.message}
                </div>
              </div>
              <button
                onClick={() => remove(t.id)}
                className="text-xs opacity-60 hover:opacity-100 flex-shrink-0"
                aria-label="关闭通知"
                data-toast-close="true"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastContainer");
  }
  return ctx;
}

export default ToastContainer;
