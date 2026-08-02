"use client";

import { useState, useMemo, useCallback } from "react";
import {
  CouncilMessage,
  FORGEKIN_COLORS,
  FORGEKIN_EMOJI,
} from "../../lib/council-types";
import { ForgekinRosterItem } from "../../lib/council-types";

interface ContextPanelProps {
  messages: CouncilMessage[];
  roster: ForgekinRosterItem[];
  participantIds: string[];
  maxRounds: number;
  activeVoteQuestion: string | null;
  compact?: boolean;
}

/**
 * ContextPanel — 群聊上下文面板
 *
 * 提供群聊会话的实时上下文信息，参考 RightStatusPanel 设计：
 *   - 讨论摘要：消息数、参与智能体、时间范围、关键字
 *   - 共识决议：智能体表达赞同/确认的要点
 *   - 待解决问题：会话中提出但未明确回答的问题
 *
 * 数据来源：基于本地消息流的启发式提取（无 LLM 调用，纯客户端计算）
 *
 * 主题：CSS 变量驱动
 */
export default function ContextPanel({
  messages,
  roster,
  participantIds,
  maxRounds,
  activeVoteQuestion,
  compact = false,
}: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "consensus" | "issues">("summary");

  /** 仅考虑非系统消息 */
  const conversationMessages = useMemo(
    () => messages.filter((m) => m.source !== "system"),
    [messages]
  );

  /** 讨论摘要数据 */
  const summary = useMemo(() => {
    if (conversationMessages.length === 0) {
      return null;
    }
    const forgekinMessages = conversationMessages.filter((m) => m.source === "forgekin");
    const userMessages = conversationMessages.filter((m) => m.source === "user");
    const participatingAgents = new Set(
      forgekinMessages.map((m) => m.forgekinId).filter(Boolean) as string[]
    );
    const firstTime = conversationMessages[0]?.timestamp ?? 0;
    const lastTime = conversationMessages[conversationMessages.length - 1]?.timestamp ?? 0;
    const durationMs = lastTime - firstTime;
    const durationMin = Math.round(durationMs / 60000);

    // 关键字提取：取所有智能体消息中出现频率前 5 的双字词（简易分词）
    const wordFreq: Record<string, number> = {};
    for (const msg of forgekinMessages) {
      const text = msg.content.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ");
      const tokens = text.split(/\s+/).filter((t) => t.length >= 2);
      for (const tok of tokens) {
        wordFreq[tok] = (wordFreq[tok] || 0) + 1;
      }
    }
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    return {
      totalMessages: conversationMessages.length,
      forgekinMessageCount: forgekinMessages.length,
      userMessageCount: userMessages.length,
      participatingAgents: Array.from(participatingAgents),
      durationMin,
      topKeywords,
      firstTime,
      lastTime,
    };
  }, [conversationMessages]);

  /** 共识决议 — 智能体表达赞同/确认的发言 */
  const consensus = useMemo(() => {
    const CONSENT_PATTERNS = [
      /同[意识]/,
      /赞[同美]/,
      /^确认$/,
      /认[为可]/,
      /确[实定]/,
      /没[错有问]/,
      /正[确是]/,
      /好[的的啊吧]|^好$/,
      /可[以行]|^可$/,
      /理[解智]/,
      /accept/i,
      /agree/i,
    ];
    return conversationMessages
      .filter((m) => m.source === "forgekin" && m.forgekinId)
      .filter((m) => {
        const text = m.content.trim();
        // 检测包含赞同关键词的句子（按句号/换行分割）
        const sentences = text.split(/[。\n!！?？]/).map((s) => s.trim()).filter(Boolean);
        return sentences.some((s) => CONSENT_PATTERNS.some((p) => p.test(s)));
      })
      .slice(-5) // 最近 5 条
      .map((m) => {
        const text = m.content.trim();
        const sentences = text.split(/[。\n!！?？]/).map((s) => s.trim()).filter(Boolean);
        const consentSentence = sentences.find((s) =>
          CONSENT_PATTERNS.some((p) => p.test(s))
        );
        return {
          id: m.id,
          forgekinId: m.forgekinId!,
          forgekinName: m.forgekinName || "",
          snippet: consentSentence || text.slice(0, 80),
          timestamp: m.timestamp,
        };
      });
  }, [conversationMessages]);

  /** 待解决问题 — 包含问号的智能体发言 */
  const issues = useMemo(() => {
    const QUESTION_PATTERNS = [
      /[?？]/,
      /如何/,
      /怎么/,
      /为什么/,
      /为何/,
      /怎么办/,
      /是否/,
      /能否/,
      /可否/,
      /什么/,
      /哪些/,
      /谁来/,
      /谁负责/,
    ];
    return conversationMessages
      .filter((m) => m.source === "forgekin" && m.forgekinId)
      .filter((m) => QUESTION_PATTERNS.some((p) => p.test(m.content)))
      .slice(-5) // 最近 5 条
      .map((m) => {
        const text = m.content.trim();
        // 提取包含问号的句子
        const sentences = text.split(/[。\n!！]/).map((s) => s.trim()).filter(Boolean);
        const questionSentence = sentences.find((s) => QUESTION_PATTERNS.some((p) => p.test(s)));
        return {
          id: m.id,
          forgekinId: m.forgekinId!,
          forgekinName: m.forgekinName || "",
          snippet: questionSentence || text.slice(0, 80),
          timestamp: m.timestamp,
        };
      });
  }, [conversationMessages]);

  const formatTime = useCallback((ts: number) => {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }, []);

  const tabBtnStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "6px 8px",
    fontSize: "11px",
    fontWeight: 600,
    color: isActive ? "var(--accent)" : "var(--muted)",
    background: isActive
      ? "color-mix(in srgb, var(--accent) 8%, transparent)"
      : "transparent",
    border: "none",
    borderBottom: isActive
      ? "2px solid var(--accent)"
      : "2px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s",
  });

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "6px",
  };

  const emptyHintStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "var(--muted)",
    opacity: 0.7,
    textAlign: "center",
    padding: "16px 8px",
  };

  return (
    <div className="context-panel flex flex-col h-full" data-council="context-panel">
      {/* 标签切换 */}
      <div
        className="flex border-b"
        style={{ borderColor: "var(--border)" }}
        role="tablist"
        aria-label="上下文面板标签"
      >
        <button
          style={tabBtnStyle(activeTab === "summary")}
          onClick={() => setActiveTab("summary")}
          role="tab"
          aria-selected={activeTab === "summary"}
          aria-controls="context-summary"
        >
          📊 摘要
        </button>
        <button
          style={tabBtnStyle(activeTab === "consensus")}
          onClick={() => setActiveTab("consensus")}
          role="tab"
          aria-selected={activeTab === "consensus"}
          aria-controls="context-consensus"
        >
          ✓ 共识 ({consensus.length})
        </button>
        <button
          style={tabBtnStyle(activeTab === "issues")}
          onClick={() => setActiveTab("issues")}
          role="tab"
          aria-selected={activeTab === "issues"}
          aria-controls="context-issues"
        >
          ? 待解 ({issues.length})
        </button>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 overflow-y-auto p-3"
        style={{ background: "var(--bg)" }}
      >
        {/* 摘要 Tab */}
        {activeTab === "summary" && (
          <div id="context-summary" role="tabpanel">
            {!summary ? (
              <div style={emptyHintStyle}>
                暂无讨论内容
                <div style={{ fontSize: "11px", marginTop: "4px" }}>
                  发送消息开始群聊
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 基本信息 */}
                <div>
                  <div style={sectionTitleStyle}>基本信息</div>
                  <div
                    className="rounded-lg p-2 space-y-1.5"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>总消息数</span>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>
                        {summary.totalMessages}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>用户消息</span>
                      <span style={{ color: "var(--text)" }}>
                        {summary.userMessageCount}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>智能体消息</span>
                      <span style={{ color: "var(--text)" }}>
                        {summary.forgekinMessageCount}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>讨论时长</span>
                      <span style={{ color: "var(--text)" }}>
                        {summary.durationMin > 0
                          ? `${summary.durationMin} 分钟`
                          : "< 1 分钟"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>时间范围</span>
                      <span style={{ color: "var(--text)", fontSize: "10px" }}>
                        {formatTime(summary.firstTime)} - {formatTime(summary.lastTime)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 参与智能体 */}
                <div>
                  <div style={sectionTitleStyle}>
                    参与智能体 ({summary.participatingAgents.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.participatingAgents.length === 0 ? (
                      <span style={emptyHintStyle}>暂无智能体发言</span>
                    ) : (
                      summary.participatingAgents.map((id) => {
                        const colors = FORGEKIN_COLORS[id] || { primary: "#888", secondary: "#333" };
                        const emoji = FORGEKIN_EMOJI[id] || "🤖";
                        const item = roster.find((r) => r.id === id);
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                            style={{
                              background: `${colors.primary}22`,
                              border: `1px solid ${colors.primary}44`,
                              color: "var(--text)",
                            }}
                            title={item?.role?.description || id}
                          >
                            <span>{emoji}</span>
                            <span style={{ fontWeight: 600 }}>
                              {item?.name || id}
                            </span>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 关键字 */}
                {summary.topKeywords.length > 0 && (
                  <div>
                    <div style={sectionTitleStyle}>高频关键字</div>
                    <div className="flex flex-wrap gap-1">
                      {summary.topKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            color: "var(--text)",
                            background: "var(--bg-hover, color-mix(in srgb, var(--accent) 6%, transparent))",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 当前配置 */}
                <div>
                  <div style={sectionTitleStyle}>会话配置</div>
                  <div
                    className="rounded-lg p-2 space-y-1"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>配置轮数</span>
                      <span style={{ color: "var(--text)" }}>{maxRounds} 轮</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: "var(--muted)" }}>参与者数</span>
                      <span style={{ color: "var(--text)" }}>{participantIds.length}</span>
                    </div>
                    {activeVoteQuestion && (
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: "var(--muted)" }}>活跃投票</span>
                        <span
                          style={{
                            color: "var(--semantic-warning, #f59e0b)",
                            fontWeight: 600,
                          }}
                        >
                          ◎ 进行中
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 共识 Tab */}
        {activeTab === "consensus" && (
          <div id="context-consensus" role="tabpanel">
            {consensus.length === 0 ? (
              <div style={emptyHintStyle}>
                暂无共识决议
                <div style={{ fontSize: "11px", marginTop: "4px" }}>
                  智能体表达赞同/确认时将自动提取
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {consensus.map((item, idx) => {
                  const colors = FORGEKIN_COLORS[item.forgekinId] || { primary: "#888", secondary: "#333" };
                  const emoji = FORGEKIN_EMOJI[item.forgekinId] || "🤖";
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg p-2"
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderLeft: `3px solid ${colors.primary}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
                          style={{
                            background: `${colors.primary}22`,
                            border: `1px solid ${colors.primary}44`,
                          }}
                        >
                          {emoji}
                        </span>
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: "var(--text)" }}
                        >
                          {item.forgekinName}
                        </span>
                        <span
                          className="text-[10px] ml-auto"
                          style={{ color: "var(--muted)" }}
                        >
                          #{idx + 1} · {formatTime(item.timestamp)}
                        </span>
                      </div>
                      <div
                        className="text-[11px] leading-relaxed"
                        style={{ color: "var(--text)" }}
                      >
                        {item.snippet}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 待解决问题 Tab */}
        {activeTab === "issues" && (
          <div id="context-issues" role="tabpanel">
            {issues.length === 0 ? (
              <div style={emptyHintStyle}>
                暂无待解决问题
                <div style={{ fontSize: "11px", marginTop: "4px" }}>
                  智能体提出问题时将自动提取
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {issues.map((item, idx) => {
                  const colors = FORGEKIN_COLORS[item.forgekinId] || { primary: "#888", secondary: "#333" };
                  const emoji = FORGEKIN_EMOJI[item.forgekinId] || "🤖";
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg p-2"
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderLeft: `3px solid var(--semantic-warning, #f59e0b)`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
                          style={{
                            background: `${colors.primary}22`,
                            border: `1px solid ${colors.primary}44`,
                          }}
                        >
                          {emoji}
                        </span>
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: "var(--text)" }}
                        >
                          {item.forgekinName}
                        </span>
                        <span
                          className="text-[10px] ml-auto"
                          style={{ color: "var(--muted)" }}
                        >
                          #{idx + 1} · {formatTime(item.timestamp)}
                        </span>
                      </div>
                      <div
                        className="text-[11px] leading-relaxed"
                        style={{ color: "var(--text)" }}
                      >
                        {item.snippet}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
