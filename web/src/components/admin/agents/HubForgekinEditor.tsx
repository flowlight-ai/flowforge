"use client";

/**
 * HubForgekinEditor — 可进化智能体配置编辑器（右侧抽屉）
 *
 * 当 open=true 且 forgekinId 存在时，渲染一个固定在右侧的抽屉（宽 480px），
 * 提供身份 / 系统提示词 / 高级运行时 / 语音的编辑能力。
 *
 * 行为：
 *   - 打开时从 /api/v1/forgemind/roster 拉取详情并初始化表单
 *   - 表单脏数据检测：未保存关闭时通过 useConfirm 弹窗确认
 *   - 保存时调用 saveForgekinConfig 提交，成功后回调 onSaved
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：不依赖上游
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/useConfirm";
import {
  initialState,
  buildPatchPayload,
  type ForgekinFormData,
} from "./hub-forgekin-editor/model";
import { fetchForgekinDetail, saveForgekinConfig } from "./hub-forgekin-editor/client";
import {
  IdentitySection,
  AccountSection,
  RoutingSection,
  TagSection,
} from "./hub-forgekin-editor/sections";
import { SystemPromptField, PersistenceBanner, type PersistenceState } from "./hub-forgekin-editor/fields";
import { AdvancedRuntimeSection } from "./hub-forgekin-editor/advanced";
import { VoiceSection } from "./hub-forgekin-editor/voice";
import { validatePayload } from "./hub-forgekin-editor/payload";

interface HubForgekinEditorProps {
  /** 待编辑的 Forgekin ID；为 null 时不渲染 */
  forgekinId: string | null;
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 保存成功后的回调 */
  onSaved?: () => void;
}

/** 判等：用 JSON 序列化做粗糙的脏数据检测，足够本场景使用 */
function isFormEqual(a: ForgekinFormData, b: ForgekinFormData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function HubForgekinEditor({
  forgekinId,
  open,
  onClose,
  onSaved,
}: HubForgekinEditorProps) {
  const confirm = useConfirm();

  const [form, setForm] = useState<ForgekinFormData | null>(null);
  const [initialForm, setInitialForm] = useState<ForgekinFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceState>("idle");
  const [persistenceMsg, setPersistenceMsg] = useState<string | undefined>(undefined);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const isOpen = open && forgekinId !== null;

  // 拉取详情并初始化表单
  useEffect(() => {
    if (!isOpen || !forgekinId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPersistence("idle");
    setPersistenceMsg(undefined);
    setValidationErrors([]);
    fetchForgekinDetail(forgekinId)
      .then((item) => {
        if (cancelled) return;
        const init = initialState(item);
        setForm(init);
        setInitialForm(init);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, forgekinId]);

  const dirty = useMemo(() => {
    if (!form || !initialForm) return false;
    return !isFormEqual(form, initialForm);
  }, [form, initialForm]);

  /** 通用更新函数：合并 patch 到当前 form */
  const patchForm = useCallback((patch: Partial<ForgekinFormData>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  /** 关闭前确认（如有未保存改动） */
  const handleClose = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({
        title: "放弃未保存的改动？",
        message: "当前编辑器存在未保存的改动，关闭后将丢失。是否确认关闭？",
        confirmText: "放弃改动",
        cancelText: "继续编辑",
        variant: "warning",
      });
      if (!ok) return;
    }
    onClose();
  }, [dirty, confirm, onClose]);

  /** 保存 */
  const handleSave = useCallback(async () => {
    if (!form || !forgekinId) return;
    const errors = validatePayload(form);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setPersistence("error");
      setPersistenceMsg(`存在 ${errors.length} 项校验错误`);
      return;
    }
    setPersistence("saving");
    setPersistenceMsg(undefined);
    try {
      const payload = buildPatchPayload(form);
      await saveForgekinConfig(forgekinId, payload);
      setInitialForm(form);
      setPersistence("saved");
      setPersistenceMsg(undefined);
      onSaved?.();
    } catch (e: unknown) {
      setPersistence("error");
      setPersistenceMsg(e instanceof Error ? e.message : String(e));
    }
  }, [form, forgekinId, onSaved]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-forgekin-editor="root"
      data-forgekin-editor-open="true"
      role="dialog"
      aria-modal="true"
      aria-label="编辑 Forgekin"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "480px",
        maxWidth: "100vw",
        background: "var(--cafe-surface,#1e1f26)",
        borderLeft: "1px solid var(--cafe-border,#2a2c3a)",
        boxShadow: "var(--shadow-elevation-2,0 4px 24px rgba(0,0,0,0.3))",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-[var(--cafe-border,#2a2c3a)]"
        data-forgekin-editor-header="true"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--cafe-text,#e5e7eb)]">
            编辑 Forgekin
          </h2>
          {forgekinId && (
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-muted,#6b7280)]">
              {forgekinId}
            </span>
          )}
          {dirty && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: "var(--semantic-warning-surface,rgba(245,158,11,0.15))",
                color: "var(--semantic-warning,#f59e0b)",
              }}
              data-forgekin-dirty="true"
            >
              未保存
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭编辑器"
          className="text-lg leading-none px-2 py-1 rounded text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] hover:bg-[var(--console-rail-item,#252633)] transition-colors"
          data-forgekin-editor-action="close"
        >
          ×
        </button>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
        data-forgekin-editor-body="true"
      >
        {loading && (
          <div className="flex items-center justify-center py-12 text-[var(--cafe-text-muted,#6b7280)] text-sm">
            <div className="w-4 h-4 border-2 border-[var(--cafe-accent,#ff5c5c)] border-t-transparent rounded-full animate-spin mr-2" />
            加载 Forgekin 详情...
          </div>
        )}

        {loadError && !loading && (
          <div
            className="p-3 rounded-md text-sm"
            style={{
              background: "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
              color: "var(--semantic-critical,#ef4444)",
            }}
            data-forgekin-editor-error="load"
          >
            加载失败：{loadError}
          </div>
        )}

        {form && !loading && (
          <>
            <IdentitySection
              value={{
                name: form.name,
                nickname: form.nickname,
                species: form.species,
                role: form.role,
                themeColor: form.themeColor,
              }}
              onChange={patchForm}
            />

            <TagSection
              forgekinId={forgekinId}
              onSaved={() => {
                /* 标签独立保存成功 — 不影响表单 dirty 状态 */
              }}
            />

            <AccountSection
              value={{ model: form.model }}
              onChange={patchForm}
            />

            <RoutingSection
              value={{ routing: form.routing }}
              onChange={patchForm}
            />

            <div className="rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-4">
              <h3 className="text-xs font-semibold text-[var(--cafe-text-secondary,#9ca3af)] uppercase tracking-wider mb-2">
                系统提示词
              </h3>
              <SystemPromptField
                value={form.system_prompt}
                onChange={(system_prompt) => patchForm({ system_prompt })}
              />
            </div>

            <AdvancedRuntimeSection
              value={{
                temperature: form.temperature,
                topP: form.topP,
                maxTokens: form.maxTokens,
              }}
              onChange={patchForm}
            />

            <VoiceSection
              value={form.voiceConfig}
              onChange={(patch) =>
                patchForm({ voiceConfig: { ...form.voiceConfig, ...patch } })
              }
            />

            {validationErrors.length > 0 && (
              <div
                className="p-3 rounded-md text-xs space-y-1"
                style={{
                  background: "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
                  color: "var(--semantic-critical,#ef4444)",
                }}
                data-forgekin-editor-error="validation"
              >
                <div className="font-semibold mb-1">校验错误：</div>
                {validationErrors.map((err, i) => (
                  <div key={i}>· {err}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部 */}
      <div
        className="px-5 py-3 border-t border-[var(--cafe-border,#2a2c3a)] space-y-2"
        data-forgekin-editor-footer="true"
      >
        <PersistenceBanner state={persistence} message={persistenceMsg} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm rounded-md border border-[var(--cafe-border,#2a2c3a)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] hover:bg-[var(--console-rail-item,#252633)] transition-colors"
            data-forgekin-editor-action="cancel"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!form || loading || persistence === "saving"}
            className="px-4 py-2 text-sm rounded-md bg-[var(--cafe-accent,#ff5c5c)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            data-forgekin-editor-action="save"
          >
            {persistence === "saving" ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default HubForgekinEditor;
