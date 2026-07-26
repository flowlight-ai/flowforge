"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useCouncilChat } from "../../hooks/useCouncilChat";
import ForgekinSelector from "./ForgekinSelector";
import {
  CouncilMessage,
  FORGEKIN_COLORS,
  FORGEKIN_EMOJI,
  ROLE_CONFIG,
} from "../../lib/council-types";

interface CouncilChatPanelProps {
  /** 是否显示右侧灵智体面板（嵌入 HelmLayout 时可关闭） */
  showSidebar?: boolean;
  /** 紧凑模式（嵌入时使用） */
  compact?: boolean;
}

/**
 * CouncilChatPanel — 5 灵智体协作群聊主面板
 *
 * 集成 useCouncilChat Hook，提供：
 *   - 消息流展示（用户消息 + 灵智体响应 + 系统消息）
 *   - @mention 输入框
 *   - 灵智体选择器（侧边栏）
 *   - 灵议轮数配置
 *
 * 参考 clowder-ai GroupChatPanel 设计：
 *   - 多Agent并排展示，每个有头像/名称/角色标签
 *   - Agent响应时间线展示
 *   - @mention 输入框增强
 *   - 灵智体状态指示器
 */
export default function CouncilChatPanel({
  showSidebar = true,
  compact = false,
}: CouncilChatPanelProps) {
  const {
    messages,
    roster,
    config,
    isLoading,
    error,
    messagesEndRef,
    sendMessage,
    clearMessages,
    updateConfig,
    toggleParticipant,
    setForgekinRole,
    reloadRoster,
  } = useCouncilChat();

  const [inputText, setInputText] = useState("");
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  /** 处理输入变化，检测 @mention */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputText(value);

    // 检测 @mention 触发
    const lastAtIndex = value.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      // 如果 @ 后没有空格且长度合理，显示菜单
      if (textAfterAt.length <= 10 && !textAfterAt.includes(" ")) {
        setShowMentionMenu(true);
        setMentionFilter(textAfterAt.toLowerCase());
        return;
      }
    }
    setShowMentionMenu(false);
  }, []);

  /** 选择 @mention 的灵智体 */
  const handleSelectMention = useCallback((forgekinId: string, name: string) => {
    const lastAtIndex = inputText.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      const before = inputText.slice(0, lastAtIndex);
      const after = inputText.slice(inputText.indexOf(" ", lastAtIndex + 1) === -1 ? inputText.length : inputText.indexOf(" ", lastAtIndex + 1));
      const newValue = `${before}@${name} ${after}`;
      setInputText(newValue);
      inputRef.current?.focus();
    }
    setShowMentionMenu(false);
  }, [inputText]);

  /** 提交消息 */
  const handleSubmit = useCallback(() => {
    if (!inputText.trim() || isLoading) return;
    sendMessage(inputText.trim());
    setInputText("");
    setShowMentionMenu(false);
  }, [inputText, isLoading, sendMessage]);

  /** 键盘事件 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  /** 点击外部关闭 mention 菜单 */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
        setShowMentionMenu(false);
      }
    };
    if (showMentionMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMentionMenu]);

  /** 过滤的灵智体列表（用于 mention 菜单） */
  const filteredRoster = roster.filter((r) =>
    !mentionFilter ||
    r.name.toLowerCase().includes(mentionFilter) ||
    r.id.toLowerCase().includes(mentionFilter) ||
    r.nickname.toLowerCase().includes(mentionFilter)
  );

  return (
    <div className="council-chat-panel flex h-full min-h-0 bg-[#0d0d12]">
      {/* 主聊天区 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 顶部状态栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-[#15151c]">
          <span className="text-sm font-semibold text-emerald-400">👥 灵议群聊</span>
          <span className="text-xs text-gray-500">
            {config.participantIds.length} 灵智体 · {config.maxRounds} 轮
          </span>
          <div className="ml-auto flex items-center gap-1">
            {/* 轮数选择 */}
            <select
              value={config.maxRounds}
              onChange={(e) => updateConfig({ maxRounds: Number(e.target.value) })}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
              title="灵议轮数"
            >
              <option value={1}>1 轮</option>
              <option value={2}>2 轮</option>
              <option value={3}>3 轮</option>
            </select>
            {/* 清空 */}
            <button
              onClick={clearMessages}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300"
              title="清空消息"
              disabled={messages.length === 0}
            >
              清空
            </button>
            {/* 刷新花名册 */}
            <button
              onClick={reloadRoster}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300"
              title="刷新花名册"
            >
              ⟳
            </button>
          </div>
        </div>

        {/* 消息流 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
              <div className="text-4xl mb-2">🦉🦊🐻🐕🦩</div>
              <p>开始与 5 个灵智体协作群聊</p>
              <p className="text-xs text-gray-600 mt-1">
                输入消息或使用 @文心 @鲁班 @梵高 @达芬奇 @夏洛克 指定灵智体
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <CouncilMessageBubble key={msg.id} message={msg} />
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-400 italic">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
              <span>灵智体讨论中...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="relative border-t border-gray-800 bg-[#15151c] px-4 py-3">
          {/* @mention 菜单 */}
          {showMentionMenu && filteredRoster.length > 0 && (
            <div
              ref={mentionMenuRef}
              className="absolute bottom-full left-4 mb-2 bg-[#1e1e2e] border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto min-w-[200px] z-10"
            >
              <div className="text-[10px] text-gray-500 px-3 py-1 border-b border-gray-800">
                选择灵智体
              </div>
              {filteredRoster.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleSelectMention(r.id, r.name)}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-800 text-left"
                >
                  <span className="text-base">{FORGEKIN_EMOJI[r.id] || "🤖"}</span>
                  <span className="text-sm text-gray-200">{r.name}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">
                    {r.role?.primary}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... 使用 @灵智体名 指定发言对象"
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500 resize-none max-h-32"
              style={{ minHeight: "38px" }}
            />
            <button
              onClick={handleSubmit}
              disabled={!inputText.trim() || isLoading}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              发送
            </button>
          </div>
          {error && (
            <div className="mt-2 text-xs text-red-400">{error}</div>
          )}
        </div>
      </div>

      {/* 右侧灵智体面板 */}
      {showSidebar && (
        <div className="w-64 border-l border-gray-800 bg-[#15151c] overflow-y-auto flex-shrink-0">
          <ForgekinSelector
            roster={roster}
            participantIds={config.participantIds}
            roleAssignment={config.roleAssignment}
            onToggleParticipant={toggleParticipant}
            onSetRole={setForgekinRole}
            compact={compact}
          />
        </div>
      )}
    </div>
  );
}

/** 单条消息气泡 */
function CouncilMessageBubble({ message }: { message: CouncilMessage }) {
  const isUser = message.source === "user";
  const isSystem = message.source === "system";
  const isForgekin = message.source === "forgekin";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="text-xs text-gray-500 bg-gray-900/60 px-3 py-1 rounded-full">
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-blue-600 text-white rounded-lg px-3 py-2 text-sm">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
          <div className="text-[10px] text-blue-200 mt-1 text-right">
            {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }

  if (isForgekin) {
    const forgekinId = message.forgekinId || "";
    const colors = FORGEKIN_COLORS[forgekinId] || { primary: "#888", secondary: "#333" };
    const emoji = FORGEKIN_EMOJI[forgekinId] || "🤖";
    const role = message.forgekinRole || "observer";
    const roleCfg = ROLE_CONFIG[role];

    return (
      <div className="flex gap-2">
        {/* 头像 */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base mt-0.5"
          style={{
            background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
            border: `1px solid ${colors.primary}66`,
          }}
        >
          {emoji}
        </div>
        {/* 消息体 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-medium text-gray-200">
              {message.forgekinName}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded text-white ${roleCfg.color}`}
            >
              {roleCfg.icon} {roleCfg.label}
            </span>
            {message.meta?.model && (
              <span className="text-[10px] text-gray-600">
                · {message.meta.model}
              </span>
            )}
          </div>
          <div
            className="rounded-lg px-3 py-2 text-sm text-gray-200 border"
            style={{
              background: `${colors.primary}11`,
              borderColor: `${colors.primary}33`,
            }}
          >
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
