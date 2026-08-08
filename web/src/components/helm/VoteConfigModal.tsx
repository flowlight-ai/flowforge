"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ForgekinRosterItem } from "../../lib/council-types";
import { FORGEKIN_COLORS, FORGEKIN_EMOJI } from "../../lib/council-types";

export interface VoteConfig {
  question: string;
  options: string[];
  /** 投票者智能体 ID 列表 */
  voters: string[];
  anonymous: boolean;
  timeoutSec: number;
}

interface VoteConfigModalProps {
  /** 可选的智能体花名册 */
  roster: ForgekinRosterItem[];
  onSubmit: (config: VoteConfig) => void;
  onCancel: () => void;
}

/**
 * VoteConfigModal — 发起投票配置弹窗
 *
 * 来源：clowder-ai/packages/web/src/components/VoteConfigModal.tsx（适配 Forgekin 版）
 * 字段：
 *   - 问题（必填，最多 500 字符）
 *   - 选项（2-10 个，每个最多 100 字符）
 *   - 投票者（从智能体花名册选择）
 *   - 匿名投票（复选框）
 *   - 超时时间（1/2/5/10 分钟）
 *
 * 交互：
 *   - ESC 关闭
 *   - 点击遮罩关闭
 *   - Enter 在最后一个选项上新增选项
 *   - 提交按钮在问题/2+ 选项/至少 1 个投票者时启用
 *
 * 主题：CSS 变量驱动
 */
export function VoteConfigModal({ roster, onSubmit, onCancel }: VoteConfigModalProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [voters, setVoters] = useState<string[]>([]);
  const [anonymous, setAnonymous] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(120);
  const modalRef = useRef<HTMLDivElement>(null);

  const canSubmit =
    question.trim().length > 0 &&
    options.filter((o) => o.trim()).length >= 2 &&
    voters.length > 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      question: question.trim(),
      options: options.map((o) => o.trim()).filter(Boolean),
      voters,
      anonymous,
      timeoutSec,
    });
  }, [question, options, voters, anonymous, timeoutSec, canSubmit, onSubmit]);

  const addOption = useCallback(() => {
    if (options.length < 10) setOptions((prev) => [...prev, ""]);
  }, [options.length]);

  const removeOption = useCallback(
    (index: number) => {
      if (options.length <= 2) return;
      setOptions((prev) => prev.filter((_, i) => i !== index));
    },
    [options.length]
  );

  const updateOption = useCallback((index: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }, []);

  const toggleVoter = useCallback((forgekinId: string) => {
    setVoters((prev) =>
      prev.includes(forgekinId)
        ? prev.filter((id) => id !== forgekinId)
        : [...prev, forgekinId]
    );
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    fontSize: "13px",
    padding: "8px 12px",
    borderRadius: "var(--radius-md, 8px)",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    outline: "none",
  };

  return (
    <div
      role="presentation"
      data-council="vote-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--bg) 70%, transparent)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px",
      }}
      onClick={(e) => {
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) onCancel();
      }}
    >
      <div
        ref={modalRef}
        data-council="vote-modal"
        style={{
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "var(--shadow-xl, 0 20px 50px rgba(0,0,0,0.3))",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            ◎ 发起投票
          </h2>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "var(--radius-sm)",
            }}
            title="关闭"
            aria-label="关闭"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* 问题 */}
          <div>
            <label
              htmlFor="vote-question"
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: "6px",
              }}
            >
              问题
            </label>
            <input
              id="vote-question"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例：哪个方案更优？"
              maxLength={500}
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* 选项 */}
          <div>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: "6px",
              }}
            >
              选项
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {options.map((opt, i) => (
                <div key={i} style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    placeholder={`选项 ${i + 1}`}
                    maxLength={100}
                    style={{ ...inputStyle, flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (i === options.length - 1) addOption();
                      }
                    }}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        cursor: "pointer",
                        padding: "0 8px",
                      }}
                      title={`删除选项 ${i + 1}`}
                      aria-label={`删除选项 ${i + 1}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <button
                type="button"
                onClick={addOption}
                style={{
                  marginTop: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "12px",
                  padding: "4px 0",
                }}
              >
                + 添加选项
              </button>
            )}
          </div>

          {/* 投票者 */}
          <div>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: "6px",
              }}
            >
              投票智能体（{voters.length} 已选）
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                maxHeight: "160px",
                overflowY: "auto",
                padding: "4px",
                borderRadius: "var(--radius-md, 8px)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              {roster.length === 0 ? (
                <div
                  style={{
                    padding: "12px",
                    fontSize: "12px",
                    color: "var(--muted)",
                    textAlign: "center",
                  }}
                >
                  暂无可用智能体
                </div>
              ) : (
                roster.map((item) => {
                  const isSelected = voters.includes(item.id);
                  const colors = FORGEKIN_COLORS[item.id] || { primary: "#888", secondary: "#333" };
                  const emoji = FORGEKIN_EMOJI[item.id] || "🤖";
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleVoter(item.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: isSelected
                          ? `linear-gradient(135deg, ${colors.primary}11, transparent)`
                          : "transparent",
                        border: `1px solid ${isSelected ? colors.primary + "44" : "transparent"}`,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                        opacity: isSelected ? 1 : 0.7,
                      }}
                    >
                      <span
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                          border: `1px solid ${colors.primary}66`,
                          flexShrink: 0,
                        }}
                      >
                        {emoji}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          color: "var(--text)",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.name}
                      </span>
                      {isSelected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={colors.primary}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 设置行 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              匿名投票
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "var(--text)",
              }}
            >
              <label htmlFor="vote-timeout">超时</label>
              <select
                id="vote-timeout"
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
                style={{
                  fontSize: "12px",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                <option value={60}>1 分钟</option>
                <option value={120}>2 分钟</option>
                <option value={300}>5 分钟</option>
                <option value={600}>10 分钟</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              color: "var(--muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: "var(--radius-md, 8px)",
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "var(--radius-md, 8px)",
              background: "var(--accent)",
              color: "var(--accent-foreground, #fff)",
              border: "none",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            开始投票
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoteConfigModal;
