/**
 * ConfirmProvider — 确认对话框 Provider
 *
 * 来源：clowder-ai/packages/web/src/components/useConfirm.tsx（简化版）
 * 职责：提供全局确认对话框 API（const confirm = useConfirm(); await confirm({ ... })）
 *
 * 设计原则：
 *   - 通过 React Context 暴露 confirm 函数
 *   - 返回 Promise<boolean>，用户确认 resolve(true)、取消 resolve(false)
 *   - 支持多个确认对话框排队（实际上只显示最新的一个）
 *   - 不依赖任何第三方 modal 库，纯 React 实现
 */

"use client";

import { createContext, useCallback, useContext, useState } from "react";

export interface ConfirmOptions {
  /** 标题 */
  title?: string;
  /** 内容 */
  message: string;
  /** 确认按钮文字 */
  confirmText?: string;
  /** 取消按钮文字 */
  cancelText?: string;
  /** 风险等级（影响按钮颜色） */
  variant?: "default" | "danger" | "warning";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface InternalState extends ConfirmOptions {
  resolver: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InternalState | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolver: resolve });
    });
  }, []);

  const handleResolve = useCallback(
    (ok: boolean) => {
      if (state?.resolver) {
        state.resolver(ok);
      }
      setState(null);
    },
    [state]
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "var(--scrim-dim)" }}
          data-confirm-overlay="true"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-[var(--cafe-surface)] text-[var(--cafe-text)] rounded-lg shadow-2xl max-w-md w-full mx-4 p-6"
            data-confirm-dialog="true"
          >
            {state.title && (
              <h2 className="text-lg font-bold mb-2" data-confirm-title="true">
                {state.title}
              </h2>
            )}
            <p className="text-sm mb-6 whitespace-pre-wrap" data-confirm-message="true">
              {state.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => handleResolve(false)}
                className="px-4 py-2 text-sm rounded-md border border-[var(--cafe-border)] hover:bg-[var(--cafe-surface-sunken)]"
                data-confirm-cancel="true"
              >
                {state.cancelText || "取消"}
              </button>
              <button
                onClick={() => handleResolve(true)}
                className={`px-4 py-2 text-sm rounded-md text-white ${
                  state.variant === "danger"
                    ? "bg-[var(--semantic-critical)] hover:opacity-90"
                    : state.variant === "warning"
                    ? "bg-[var(--semantic-warning)] hover:opacity-90"
                    : "bg-[var(--cafe-accent)] hover:bg-[var(--cafe-accent-hover)]"
                }`}
                data-confirm-ok="true"
                autoFocus
              >
                {state.confirmText || "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}

export default ConfirmProvider;
