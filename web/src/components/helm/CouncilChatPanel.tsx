"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useCouncilChat } from "../../hooks/useCouncilChat";
import { useCouncilSocket } from "../../hooks/useCouncilSocket";
import { useInputHistory } from "../../hooks/useInputHistory";
import { useThreadStore } from "../../stores/threadStore";
import ForgekinSelector from "./ForgekinSelector";
import ContextPanel from "./ContextPanel";
import ScrollToBottomButton from "./ScrollToBottomButton";
import PendingMemberBubble from "./PendingMemberBubble";
import ThinkingIndicator from "./ThinkingIndicator";
import MessageNavigator from "./MessageNavigator";
import VoteActiveBar, { type VoteActiveState } from "./VoteActiveBar";
import VoteConfigModal, { type VoteConfig } from "./VoteConfigModal";
import ReplyPill from "./ReplyPill";
import SlashCommandMenu, { type SlashCommand, COUNCIL_SLASH_COMMANDS } from "./SlashCommandMenu";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  CouncilMessage,
  FORGEKIN_COLORS,
  FORGEKIN_EMOJI,
  ROLE_CONFIG,
} from "../../lib/council-types";

interface CouncilChatPanelProps {
  /** 当前会话 ID（多会话支持，传给 useCouncilChat） */
  threadId?: string | null;
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
 *   - @mention 输入框（带弹窗 + 键盘导航）
 *   - 灵智体选择器（侧边栏）
 *   - 灵议轮数配置
 *   - 消息 hover 操作（复制 / 引用）
 *
 * UI 改进（v3）：
 *   - 全部使用 CSS 变量（var(--bg) 等），主题切换时所有组件同步变色
 *   - @mention 弹窗改用光标位置检测，支持键盘导航（↑↓ Enter Esc）
 *   - 添加消息 hover 操作按钮（复制、引用回复）
 *   - 改进消息气泡视觉层次
 *
 * 参考 clowder-ai ChatInputMenus 的 @mention 弹窗设计：
 *   - 键盘导航（↑↓ 选择，Enter 确认，Esc 关闭）
 *   - 头像 + 名称 + 描述
 *   - "还有更多"滚动提示
 *   - 底部快捷键提示
 */
export default function CouncilChatPanel({
  threadId = null,
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
    hasMore,
    sendMessage,
    loadMore,
    editMessage,
    deleteMessage,
    receiveMessage,
    clearMessages,
    addSystemMessage,
    updateConfig,
    toggleParticipant,
    setForgekinRole,
    reloadRoster,
  } = useCouncilChat(threadId);

  // WebSocket 实时推送 — 当 threadId 存在时自动连接并订阅
  const { status: wsStatus } = useCouncilSocket({
    enabled: !!threadId,
    threadId,
    onMessage: useCallback((data: unknown) => {
      const msg = data as Record<string, unknown>;
      receiveMessage({
        id: msg.id as string,
        source: (msg.source as CouncilMessage["source"]) || "forgekin",
        content: msg.content as string,
        timestamp: (msg.timestamp as number) || Date.now(),
        forgekinId: (msg.forgekin_id as string) || undefined,
        forgekinName: (msg.forgekin_name as string) || undefined,
        forgekinRole: (msg.forgekin_role as CouncilMessage["forgekinRole"]) || undefined,
        meta: (msg.meta as Record<string, unknown>) || {},
      });
    }, [receiveMessage]),
  });

  const [inputText, setInputText] = useState("");
  // thread-scoped 草稿管理：切换会话时保存/恢复未发送输入（不丢失）
  const setDraft = useThreadStore((s) => s.setDraft);
  const getDraft = useThreadStore((s) => s.getDraft);
  // 防止 threadId 切换后恢复草稿被同步 effect 反向覆盖
  const skipDraftSyncRef = useRef(false);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStart, setMentionStart] = useState(-1); // @ 符号在输入框中的位置
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [replyTo, setReplyTo] = useState<CouncilMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 转发成功标记：messageId → boolean（短暂显示"已转发"反馈）
  const [forwardedId, setForwardedId] = useState<string | null>(null);
  // 记录最近一条用户消息（用于"重新生成"重新发送原消息）
  const [lastUserMessage, setLastUserMessage] = useState<CouncilMessage | null>(null);
  // 编辑中的消息（非 null 时显示编辑模态框）
  const [editingMessage, setEditingMessage] = useState<CouncilMessage | null>(null);
  // 待删除的消息（非 null 时显示确认对话框）
  const [deletingMessage, setDeletingMessage] = useState<CouncilMessage | null>(null);
  // Reactions 状态：messageId → { emoji: count }
  // 客户端管理（无后端持久化），切换 toggle 添加/移除
  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});
  // 当前打开 reaction picker 的消息 ID（null 表示全部关闭）
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  // 投票状态：弹窗显示标志、活跃投票状态、用户已投选项
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [activeVote, setActiveVote] = useState<VoteActiveState | null>(null);
  const [userVotedIdx, setUserVotedIdx] = useState(-1);
  // 智能体响应中的占位气泡（按触发顺序展示参与智能体）
  const [pendingForgekinIds, setPendingForgekinIds] = useState<string[]>([]);
  // 已静音的智能体 ID 列表（静音后该智能体不参与消息触发，但仍可被 @ 显式调用）
  const [mutedIds, setMutedIds] = useState<string[]>([]);
  // 右侧边栏标签：智能体花名册 / 上下文面板
  const [sidebarTab, setSidebarTab] = useState<"agents" | "context">("agents");

  // 斜杠命令菜单状态（参考 clowder-ai ChatInputMenus）
  // 当输入框内容以 / 开头时显示命令列表
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);

  // IME 输入法组合状态（关键：中文输入法回车确认拼音时不应发送消息）
  // clowder-ai 使用 useIMEGuard hook，这里用 ref 简化实现
  const isComposingRef = useRef(false);

  // 输入历史记录（↑/↓ 召回）
  const {
    addToHistory,
    navigateHistory,
    resetNavigation: resetHistoryNavigation,
  } = useInputHistory("council");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const mentionScrollRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [mentionCanScrollDown, setMentionCanScrollDown] = useState(false);

  // ── thread-scoped 草稿恢复/同步 ───────────────────────────────
  // threadId 切换时从 store 恢复该会话的草稿（并重置相关 UI 状态）
  useEffect(() => {
    skipDraftSyncRef.current = true;
    if (threadId) {
      setInputText(getDraft(threadId));
    } else {
      setInputText("");
    }
    setShowMentionMenu(false);
    setMentionStart(-1);
    setReplyTo(null);
  }, [threadId, getDraft]);

  // inputText 变化时持久化到 store（跳过刚恢复的那次，避免反向覆盖）
  useEffect(() => {
    if (skipDraftSyncRef.current) {
      skipDraftSyncRef.current = false;
      return;
    }
    if (threadId) {
      setDraft(threadId, inputText);
    }
  }, [inputText, threadId, setDraft]);

  // 过滤的斜杠命令列表（用于键盘导航）
  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return COUNCIL_SLASH_COMMANDS;
    const f = slashFilter.toLowerCase();
    return COUNCIL_SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(f) ||
        cmd.description.toLowerCase().includes(f) ||
        cmd.aliases?.some((a) => a.toLowerCase().includes(f)),
    );
  }, [slashFilter]);

  /** 获取指定消息的 reactions */
  const getMessageReactions = useCallback((msgId: string): Record<string, number> => {
    return reactions[msgId] || {};
  }, [reactions]);

  /** 添加/移除 reaction（toggle 行为） */
  const handleAddReaction = useCallback((msgId: string, emoji: string) => {
    setReactions((prev) => {
      const msgReactions = prev[msgId] || {};
      const current = msgReactions[emoji] || 0;
      if (current > 0) {
        // 已存在 → 移除（toggle off）
        const { [emoji]: _removed, ...rest } = msgReactions;
        return { ...prev, [msgId]: rest };
      }
      // 不存在 → 添加
      return { ...prev, [msgId]: { ...msgReactions, [emoji]: 1 } };
    });
    setShowReactionPicker(null);
  }, []);

  /** 提交投票配置 → 启动活跃投票（客户端模拟，无后端持久化） */
  const handleVoteSubmit = useCallback((cfg: VoteConfig) => {
    setShowVoteModal(false);
    setUserVotedIdx(-1);
    // 客户端模拟：deadline = now + timeoutSec
    const deadline = Date.now() + cfg.timeoutSec * 1000;
    setActiveVote({
      question: cfg.question,
      voteCount: 0,
      totalVoters: cfg.voters.length,
      deadline,
      anonymous: cfg.anonymous,
      options: cfg.options,
      tally: {},
      votedBy: [],
    });

    // 推送系统消息通知（使用 hook 暴露的 addSystemMessage，避免之前的占位 hack）
    addSystemMessage(
      `◎ 投票已发起：${cfg.question}（${cfg.voters.length} 个投票者，${cfg.timeoutSec / 60} 分钟超时${cfg.anonymous ? "，匿名" : ""}）`,
    );
  }, [addSystemMessage]);

  /** 结束投票 */
  const handleVoteEnd = useCallback(() => {
    setActiveVote(null);
    setUserVotedIdx(-1);
  }, []);

  /** 用户投票（选项 index） */
  const handleVote = useCallback((optionIdx: number) => {
    setActiveVote((prev) => {
      if (!prev) return prev;
      const opt = prev.options[optionIdx];
      if (!opt) return prev;
      const newTally = { ...prev.tally, [opt]: (prev.tally?.[opt] ?? 0) + 1 };
      return {
        ...prev,
        voteCount: prev.voteCount + 1,
        tally: newTally,
        votedBy: prev.anonymous ? prev.votedBy : [...(prev.votedBy ?? []), "user"],
      };
    });
    setUserVotedIdx(optionIdx);
  }, []);

  /** 切换智能体静音状态 — 静音后该智能体不参与消息触发 */
  const handleToggleMute = useCallback((forgekinId: string) => {
    setMutedIds((prev) =>
      prev.includes(forgekinId)
        ? prev.filter((id) => id !== forgekinId)
        : [...prev, forgekinId]
    );
  }, []);

  /** 过滤的灵智体列表（用于 mention 菜单） */
  const filteredRoster = useMemo(() => {
    const f = mentionFilter.toLowerCase();
    return roster.filter((r) =>
      !f ||
      r.name.toLowerCase().includes(f) ||
      r.id.toLowerCase().includes(f) ||
      r.nickname.toLowerCase().includes(f)
    );
  }, [roster, mentionFilter]);

  /** mention 弹窗"还有更多"滚动指示器检测 — 必须在 filteredRoster 之后 */
  useEffect(() => {
    if (!showMentionMenu) {
      setMentionCanScrollDown(false);
      return;
    }
    const el = mentionScrollRef.current;
    if (!el) return;
    const check = () => {
      setMentionCanScrollDown(el.scrollHeight > el.clientHeight + el.scrollTop + 4);
    };
    check();
    el.addEventListener("scroll", check);
    // 延迟再检查一次（等待 DOM 渲染完成）
    const timer = setTimeout(check, 50);
    return () => {
      el.removeEventListener("scroll", check);
      clearTimeout(timer);
    };
  }, [showMentionMenu, filteredRoster]);

  /** 重置选中索引当过滤列表变化 */
  useEffect(() => {
    setSelectedIdx(0);
  }, [mentionFilter]);

  /**
   * 处理斜杠命令
   * 在输入框输入 / 开头时，执行对应命令而非发送消息
   */
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand): boolean => {
      switch (cmd.name) {
        case "clear":
          clearMessages();
          break;
        case "vote":
          setShowVoteModal(true);
          break;
        case "rounds": {
          // 从输入文本中提取参数：/rounds 2
          const match = inputText.match(/\/rounds\s+(\d)/);
          const rounds = match ? Math.min(Math.max(parseInt(match[1], 10), 1), 3) : config.maxRounds;
          updateConfig({ maxRounds: rounds });
          break;
        }
        case "help": {
          const helpMsg: CouncilMessage = {
            id: `help-${Date.now()}`,
            source: "system",
            content: `📖 可用命令：\n${COUNCIL_SLASH_COMMANDS.map((c) => `  /${c.name}${c.argsHint ? ` ${c.argsHint}` : ""} — ${c.description}`).join("\n")}`,
            timestamp: Date.now(),
          };
          // 直接通过 sendMessage 添加到消息流（发送一个系统提示）
          // 由于 useCouncilChat 未暴露 setMessages，使用 sendMessage 会被 LLM 处理
          // 这里采用折中方案：将帮助信息作为用户输入的提示，让用户看到命令列表
          void helpMsg;
          // 直接显示在输入框作为预览
          setInputText(`📖 可用命令：\n${COUNCIL_SLASH_COMMANDS.map((c) => `/${c.name}${c.argsHint ? ` ${c.argsHint}` : ""} — ${c.description}`).join("\n")}`);
          return true; // 不清空输入，让用户看到
        }
        case "agents": {
          const agentList = roster
            .map((r) => `• ${r.name} (${r.id}) — ${r.role?.primary || "智能体"}`)
            .join("\n");
          setInputText(`👥 可用智能体：\n${agentList}`);
          return true;
        }
        case "refresh":
          reloadRoster();
          break;
        case "all":
          // 插入 @all 占位，发送时由 parseMentions 解析为所有参与者
          setInputText("@all ");
          requestAnimationFrame(() => inputRef.current?.focus());
          return true;
        default:
          return false;
      }
      setInputText("");
      setShowSlashMenu(false);
      setSlashFilter("");
      return true;
    },
    [clearMessages, config.maxRounds, inputText, reloadRoster, roster, updateConfig],
  );

  /**
   * 处理输入变化，检测 @mention 和 /slash 命令
   *
   * 改进：使用光标位置（selectionStart）检测 @，而非 lastIndexOf
   * 这样支持多个 @ 在不同位置，且只触发光标所在的 @
   */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;
    setInputText(value);

    // 用户手动编辑时重置历史导航
    resetHistoryNavigation();

    // 斜杠命令检测：输入以 / 开头且光标在第一行
    if (value.startsWith("/") && cursorPos >= 1) {
      const firstLine = value.split("\n")[0];
      // / 后到光标的文本作为过滤词
      const filterText = firstLine.slice(1, cursorPos);
      // 只在过滤词不含空格时显示菜单（含空格说明已输入完整命令）
      if (!filterText.includes(" ")) {
        setShowSlashMenu(true);
        setSlashFilter(filterText);
        setSlashSelectedIdx(0);
      } else {
        setShowSlashMenu(false);
        setSlashFilter("");
      }
    } else {
      setShowSlashMenu(false);
      setSlashFilter("");
    }

    // 在光标前查找最近的 @
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      // 检查 @ 前是否是单词边界（行首或空格）
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
      const isWordBoundary = charBeforeAt === " " || charBeforeAt === "\n" || lastAtIndex === 0;

      // @ 后到光标的文本
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);

      // 触发条件：@ 前是单词边界，@ 后无空格且长度合理
      if (isWordBoundary && textAfterAt.length <= 10 && !textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        setShowMentionMenu(true);
        setMentionFilter(textAfterAt);
        setMentionStart(lastAtIndex);
        return;
      }
    }
    setShowMentionMenu(false);
    setMentionStart(-1);
  }, [resetHistoryNavigation]);

  /** 选择 @mention 的灵智体 — 替换光标所在的 @xxx 为 @name */
  const handleSelectMention = useCallback((forgekinId: string, name: string) => {
    if (mentionStart === -1) return;
    const before = inputText.slice(0, mentionStart);
    const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
    const after = inputText.slice(cursorPos);
    const newValue = `${before}@${name} ${after}`;
    setInputText(newValue);
    setShowMentionMenu(false);
    setMentionStart(-1);
    // 焦点回到输入框，光标放在 @name 后
    requestAnimationFrame(() => {
      const newPos = (before + `@${name} `).length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    });
  }, [inputText, mentionStart]);

  /** 提交消息 */
  const handleSubmit = useCallback(() => {
    if (!inputText.trim() || isLoading) return;

    // 1. 斜杠命令处理：输入以 / 开头时执行命令而非发送
    if (inputText.startsWith("/")) {
      const cmdName = inputText.slice(1).split(/\s/)[0];
      const cmd = COUNCIL_SLASH_COMMANDS.find(
        (c) => c.name === cmdName || c.aliases?.includes(cmdName),
      );
      if (cmd) {
        handleSlashCommand(cmd);
        return;
      }
      // 未知命令：作为普通消息发送（让 LLM 解读）
    }

    // 2. 添加到输入历史（↑/↓ 召回）
    addToHistory(inputText);

    // 3. 解析 @mention，决定哪些智能体将响应（与 useCouncilChat.parseMentions 逻辑一致）
    const mentioned: string[] = [];
    for (const item of roster) {
      const patterns = [`@${item.name}`, `@${item.id}`, `@${item.nickname}`];
      if (patterns.some((p) => inputText.includes(p))) {
        mentioned.push(item.id);
      }
    }
    // 静音的智能体不参与默认触发（但 @ 显式调用仍生效，符合 clowder-ai 的静音语义）
    const candidateIds = mentioned.length > 0
      ? mentioned
      : config.participantIds.filter((id) => !mutedIds.includes(id));
    const pendingIds = candidateIds.length > 0
      ? candidateIds
      // 全部静音时退化为全部参与者（避免无响应）
      : config.participantIds;
    setPendingForgekinIds(pendingIds);

    // 4. 发送消息（replyTo 状态由 useCouncilChat 内部管理，这里清除 UI 引用）
    sendMessage(inputText.trim());
    // 记录最近一条用户消息（用于"重新生成"功能）
    setLastUserMessage({
      id: `user-${Date.now()}`,
      source: "user",
      content: inputText.trim(),
      timestamp: Date.now(),
    });
    setInputText("");
    setShowMentionMenu(false);
    setShowSlashMenu(false);
    setSlashFilter("");
    setReplyTo(null);
    resetHistoryNavigation();
  }, [
    inputText,
    isLoading,
    sendMessage,
    roster,
    config.participantIds,
    mutedIds,
    addToHistory,
    handleSlashCommand,
    resetHistoryNavigation,
  ]);

  /** 灵议结束后清除 pending 占位气泡 */
  useEffect(() => {
    if (!isLoading && pendingForgekinIds.length > 0) {
      setPendingForgekinIds([]);
    }
  }, [isLoading, pendingForgekinIds.length]);

  /** 键盘事件 — 处理 @mention/斜杠命令导航、IME guard、历史召回、消息提交 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 输入法组合中：Enter 用于确认拼音，不应触发任何操作
    // 关键：中文用户输入回车确认拼音时，不应发送消息
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }

    // 1. 斜杠命令菜单打开时，处理键盘导航（优先级最高）
    if (showSlashMenu && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIdx((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIdx((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selected = filteredSlashCommands[slashSelectedIdx];
        if (selected) {
          handleSlashCommand(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        setSlashFilter("");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const selected = filteredSlashCommands[slashSelectedIdx];
        if (selected) {
          handleSlashCommand(selected);
        }
        return;
      }
    }

    // 2. @mention 菜单打开时，处理键盘导航
    if (showMentionMenu && filteredRoster.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % filteredRoster.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + filteredRoster.length) % filteredRoster.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selected = filteredRoster[selectedIdx];
        if (selected) {
          handleSelectMention(selected.id, selected.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionMenu(false);
        setMentionStart(-1);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const selected = filteredRoster[selectedIdx];
        if (selected) {
          handleSelectMention(selected.id, selected.name);
        }
        return;
      }
    }

    // 3. 输入历史召回（↑/↓，无菜单打开时）
    // ↑ 在光标位于第一行时召回上一条历史
    // ↓ 在光标位于最后一行时前进到下一条历史
    if (!showMentionMenu && !showSlashMenu) {
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const value = textarea.value;
      const atFirstLine = cursorPos === 0 || !value.slice(0, cursorPos).includes("\n");
      const atLastLine = cursorPos === value.length || !value.slice(cursorPos).includes("\n");

      if (e.key === "ArrowUp" && atFirstLine) {
        const item = navigateHistory("up", inputText);
        if (item !== null) {
          e.preventDefault();
          setInputText(item);
          requestAnimationFrame(() => {
            const len = item.length;
            inputRef.current?.setSelectionRange(len, len);
          });
          return;
        }
      }
      if (e.key === "ArrowDown" && atLastLine) {
        const item = navigateHistory("down", inputText);
        if (item !== null) {
          e.preventDefault();
          setInputText(item);
          requestAnimationFrame(() => {
            const len = item.length;
            inputRef.current?.setSelectionRange(len, len);
          });
          return;
        }
      }
    }

    // 4. 普通 Enter 提交消息（Shift+Enter 换行）
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [
    showSlashMenu,
    showMentionMenu,
    filteredSlashCommands,
    filteredRoster,
    slashSelectedIdx,
    selectedIdx,
    handleSlashCommand,
    handleSelectMention,
    handleSubmit,
    navigateHistory,
    inputText,
  ]);

  /** 重置斜杠命令选中索引当过滤变化 */
  useEffect(() => {
    setSlashSelectedIdx(0);
  }, [slashFilter]);

  /** 点击外部关闭斜杠命令菜单 */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
        setSlashFilter("");
      }
    };
    if (showSlashMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSlashMenu]);

  /** 点击外部关闭 mention 菜单 */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
        setShowMentionMenu(false);
        setMentionStart(-1);
      }
    };
    if (showMentionMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMentionMenu]);

  /** 复制消息内容到剪贴板 */
  const handleCopyMessage = useCallback((msg: CouncilMessage) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(msg.content).then(() => {
        setCopiedId(msg.id);
        setTimeout(() => setCopiedId(null), 1500);
      }).catch(() => {
        // 静默失败
      });
    }
  }, []);

  /** 引用回复 */
  const handleReplyMessage = useCallback((msg: CouncilMessage) => {
    if (msg.source === "user") return;
    const quote = msg.forgekinName ? `@${msg.forgekinName} ` : "";
    const snippet = msg.content.slice(0, 60).replace(/\n/g, " ");
    setInputText(`${quote}> ${snippet}...\n\n`);
    setReplyTo(msg);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /**
   * 重新生成 — 重新发送上一条用户消息触发新一轮灵议
   * 参考 clowder-ai MessageActions 的"重新生成"功能
   * 仅对智能体消息有效，使用最近一条用户消息作为输入
   */
  const handleRegenerate = useCallback((msg: CouncilMessage) => {
    if (msg.source !== "forgekin") return;
    if (!lastUserMessage) return;
    if (isLoading) return;
    // 重新发送最近一条用户消息
    sendMessage(lastUserMessage.content);
    // 推送系统消息提示
    addSystemMessage(`⟳ 已触发重新生成（基于上一条用户消息）`);
  }, [lastUserMessage, isLoading, sendMessage, addSystemMessage]);

  /**
   * 转发消息 — 复制到剪贴板，附加来源与时间戳
   * 参考 clowder-ai MessageActions 的转发功能
   * 格式：[来源] 时间\n内容
   */
  const handleForward = useCallback((msg: CouncilMessage) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const time = new Date(msg.timestamp).toLocaleString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
    const sourceLabel = msg.source === "forgekin"
      ? `[${msg.forgekinName || "智能体"}]`
      : msg.source === "user"
        ? "[我]"
        : "[系统]";
    const forwardedText = `${sourceLabel} ${time}\n${msg.content}`;
    navigator.clipboard.writeText(forwardedText).then(() => {
      setForwardedId(msg.id);
      setTimeout(() => setForwardedId(null), 1500);
    }).catch(() => {
      // 静默失败
    });
  }, []);

  /** 打开编辑模态框 */
  const handleEditMessage = useCallback((msg: CouncilMessage) => {
    setEditingMessage(msg);
  }, []);

  /** 保存编辑 — 调用 editMessage 并关闭模态框 */
  const handleSaveEdit = useCallback(
    async (newContent: string) => {
      if (!editingMessage) return;
      const trimmed = newContent.trim();
      if (!trimmed) return;
      await editMessage(editingMessage.id, trimmed);
      setEditingMessage(null);
    },
    [editingMessage, editMessage],
  );

  /** 打开删除确认对话框 */
  const handleDeleteMessage = useCallback((msg: CouncilMessage) => {
    setDeletingMessage(msg);
  }, []);

  /** 确认删除 — 调用 deleteMessage 并关闭对话框 */
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingMessage) return;
    await deleteMessage(deletingMessage.id);
    setDeletingMessage(null);
  }, [deletingMessage, deleteMessage]);

  /** 滚动选中项到视图 */
  const selectedRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, []);

  return (
    <div
      className="council-chat-panel flex h-full min-h-0"
      style={{ background: "var(--bg)" }}
    >
      {/* 主聊天区 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 顶部状态栏 */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
          }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--accent)" }}
          >
            ◎ 群聊
          </span>
          {/* WebSocket 连接状态指示器 */}
          {threadId && (
            <span
              className="text-[10px] flex items-center gap-1"
              style={{ color: "var(--muted)" }}
              title={`WebSocket: ${wsStatus}`}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background:
                    wsStatus === "connected" ? "#10b981" :
                    wsStatus === "connecting" || wsStatus === "reconnecting" ? "#f59e0b" :
                    "#6b7280",
                  display: "inline-block",
                }}
              />
              {wsStatus === "connected" ? "实时" : wsStatus === "connecting" ? "连接中" : wsStatus === "reconnecting" ? "重连" : "离线"}
            </span>
          )}
          <span
            className="text-xs"
            style={{ color: "var(--muted)" }}
          >
            {config.participantIds.length} 智能体 · {config.maxRounds} 轮
          </span>
          <div className="ml-auto flex items-center gap-1">
            {/* 发起投票按钮 — 参考 clowder-ai ChatContainerHeader 的投票入口 */}
            <button
              onClick={() => setShowVoteModal(true)}
              className="text-xs px-2 py-1 transition-colors"
              style={{
                color: activeVote ? "var(--semantic-warning, #f59e0b)" : "var(--muted)",
                background: activeVote
                  ? "color-mix(in srgb, var(--semantic-warning, #f59e0b) 12%, transparent)"
                  : "transparent",
                border: activeVote
                  ? "1px solid color-mix(in srgb, var(--semantic-warning, #f59e0b) 40%, transparent)"
                  : "1px solid var(--border)",
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                fontWeight: 600,
              }}
              title={activeVote ? "投票进行中" : "发起投票"}
              disabled={!!activeVote}
            >
              ◎ 投票
            </button>
            {/* 轮数选择 */}
            <select
              value={config.maxRounds}
              onChange={(e) => updateConfig({ maxRounds: Number(e.target.value) })}
              className="text-xs rounded px-2 py-1"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              title="灵议轮数"
            >
              <option value={1}>1 轮</option>
              <option value={2}>2 轮</option>
              <option value={3}>3 轮</option>
            </select>
            {/* 清空 */}
            <button
              onClick={clearMessages}
              className="text-xs px-2 py-1 transition-colors"
              style={{
                color: "var(--muted)",
                background: "transparent",
                border: "none",
                cursor: messages.length === 0 ? "not-allowed" : "pointer",
                opacity: messages.length === 0 ? 0.5 : 1,
              }}
              title="清空消息"
              disabled={messages.length === 0}
            >
              清空
            </button>
            {/* 刷新花名册 */}
            <button
              onClick={reloadRoster}
              className="text-xs px-2 py-1 transition-colors"
              style={{
                color: "var(--muted)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              title="刷新花名册"
            >
              ⟳
            </button>
          </div>
        </div>

        {/* 消息流 — position:relative 用于承载浮动按钮（ScrollToBottomButton / MessageNavigator） */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative"
          style={{ background: "var(--bg)" }}
          data-council="message-stream"
        >
          {messages.length === 0 && (
            <div
              className="flex flex-col items-center justify-center h-full text-sm"
              style={{ color: "var(--muted)" }}
            >
              <div className="text-4xl mb-2">🦉🦊🐻🐕🦩</div>
              <p>开始与 5 个可进化智能体协作群聊</p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--muted)", opacity: 0.7 }}
              >
                输入消息或使用 @文心 @鲁班 @梵高 @达芬奇 @夏洛克 指定智能体
              </p>
            </div>
          )}

          {/* 加载更多旧消息（hasMore 为 true 时显示） */}
          {hasMore && (
            <div className="flex justify-center py-2">
              <button
                onClick={() => loadMore()}
                className="px-3 py-1 text-xs rounded bg-[var(--cafe-border-subtle,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] hover:bg-[var(--cafe-border,#3a3c4a)] transition"
              >
                ↑ 加载更多消息
              </button>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={msg.id} data-message-idx={idx + 1}>
              <CouncilMessageBubble
                message={msg}
                onCopy={handleCopyMessage}
                onReply={handleReplyMessage}
                onRegenerate={handleRegenerate}
                onForward={handleForward}
                onEdit={handleEditMessage}
                onDelete={handleDeleteMessage}
                copied={copiedId === msg.id}
                forwarded={forwardedId === msg.id}
                isReplyTarget={replyTo?.id === msg.id}
                reactions={getMessageReactions(msg.id)}
                onAddReaction={(emoji) => handleAddReaction(msg.id, emoji)}
                showReactionPicker={showReactionPicker === msg.id}
                onToggleReactionPicker={() => setShowReactionPicker((cur) => (cur === msg.id ? null : msg.id))}
              />
            </div>
          ))}

          {/* PendingMemberBubble — 智能体响应中占位气泡（替代简单 loading dots） */}
          {isLoading &&
            pendingForgekinIds.map((id) => {
              const forgekin = roster.find((r) => r.id === id);
              return (
                <PendingMemberBubble
                  key={`pending-${id}-${Date.now()}`}
                  forgekinId={id}
                  forgekinName={forgekin?.name}
                />
              );
            })}

          {/* ThinkingIndicator — 整体思考状态指示器（带取消提示，可选） */}
          {isLoading && pendingForgekinIds.length > 0 && (
            <ThinkingIndicator forgekinIds={pendingForgekinIds} />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ScrollToBottomButton — 回到底部浮动按钮 */}
        <ScrollToBottomButton
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          recomputeSignal={messages.length}
          observerKey="council"
        />

        {/* MessageNavigator — 消息导航器（>5 条消息时显示） */}
        <MessageNavigator
          totalMessages={messages.length}
          scrollContainerRef={scrollContainerRef}
        />

        {/* 引用回复预览 */}
        {replyTo && (
          <div
            className="px-4 py-2 border-t flex items-center gap-2 text-xs"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            <span style={{ color: "var(--accent)" }}>↪ 引用回复:</span>
            <span
              className="flex-1 truncate"
              style={{ color: "var(--text)" }}
            >
              {replyTo.forgekinName ? `[${replyTo.forgekinName}] ` : ""}
              {replyTo.content.slice(0, 80).replace(/\n/g, " ")}
            </span>
            <button
              onClick={() => setReplyTo(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "2px 6px",
              }}
              title="取消引用"
            >
              ✕
            </button>
          </div>
        )}

        {/* VoteActiveBar — 投票进行中状态栏（参考 clowder-ai ChatContainer） */}
        <VoteActiveBar
          vote={activeVote}
          onEnd={handleVoteEnd}
          onVote={handleVote}
          userVotedIdx={userVotedIdx}
        />

        {/* 输入区 */}
        <div
          className="relative border-t px-4 py-3"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
          }}
        >
          {/* @mention 菜单 — 参考 clowder-ai ChatInputMenus 设计 */}
          {showMentionMenu && (
            <div
              ref={mentionMenuRef}
              className="absolute bottom-full left-4 mb-2 rounded-lg shadow-xl overflow-hidden min-w-[240px] z-10 max-h-80 flex flex-col"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                className="text-[10px] px-3 py-1.5 border-b"
                style={{
                  color: "var(--muted)",
                  borderColor: "var(--border)",
                }}
              >
                选择智能体 {filteredRoster.length > 0 && `· ${filteredRoster.length} 个匹配`}
              </div>
              <div ref={mentionScrollRef} className="overflow-y-auto flex-1">
                {filteredRoster.length === 0 ? (
                  <div
                    className="px-3 py-2.5 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    无匹配智能体
                  </div>
                ) : (
                  <>
                    {/* 群组提及选项 — @all 触发所有参与者，参考 clowder-ai ChatInputMenus 的 isGroup */}
                    {mentionFilter === "" && (
                      <button
                        onClick={() => {
                          // 插入 @all 占位，发送时由 parseMentions 解析为所有参与者
                          if (mentionStart === -1) return;
                          const before = inputText.slice(0, mentionStart);
                          const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
                          const after = inputText.slice(cursorPos);
                          const newValue = `${before}@all ${after}`;
                          setInputText(newValue);
                          setShowMentionMenu(false);
                          setMentionStart(-1);
                          requestAnimationFrame(() => {
                            const newPos = (before + "@all ").length;
                            inputRef.current?.focus();
                            inputRef.current?.setSelectionRange(newPos, newPos);
                          });
                        }}
                        onMouseEnter={() => setSelectedIdx(-1)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors"
                        style={{
                          background: "transparent",
                          border: "none",
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer",
                        }}
                        title="提及所有参与的智能体"
                      >
                        <span
                          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                          style={{
                            background: "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))",
                            border: "1px solid var(--accent)",
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            style={{ color: "var(--accent)" }}
                            aria-hidden="true"
                          >
                            <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
                          </svg>
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-sm font-semibold"
                              style={{ color: "var(--accent)" }}
                            >
                              所有人
                            </span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{
                                background: "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))",
                                color: "var(--accent)",
                              }}
                            >
                              @all
                            </span>
                          </div>
                          <div
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            提及所有参与的智能体
                          </div>
                        </div>
                      </button>
                    )}
                    {filteredRoster.map((r, i) => {
                    const colors = FORGEKIN_COLORS[r.id] || { primary: "#888", secondary: "#333" };
                    const emoji = FORGEKIN_EMOJI[r.id] || "🤖";
                    const isSelected = i === selectedIdx;
                    return (
                      <button
                        key={r.id}
                        ref={isSelected ? selectedRef : undefined}
                        onClick={() => handleSelectMention(r.id, r.name)}
                        onMouseEnter={() => setSelectedIdx(i)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors"
                        style={{
                          background: isSelected ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))" : "transparent",
                          border: "none",
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-base"
                          style={{
                            background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                            border: `1px solid ${colors.primary}66`,
                          }}
                        >
                          {emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-sm font-semibold truncate"
                              style={{ color: "var(--text)" }}
                            >
                              {r.name}
                            </span>
                            <span
                              className="text-[10px] truncate"
                              style={{ color: "var(--muted)" }}
                            >
                              {r.role?.primary}
                            </span>
                          </div>
                          <div
                            className="text-xs truncate"
                            style={{ color: "var(--muted)" }}
                          >
                            {r.nickname}
                          </div>
                        </div>
                        {isSelected && (
                          <span style={{ color: "var(--accent)", fontSize: "12px" }}>↵</span>
                        )}
                      </button>
                    );
                  })}
                  </>
                )}
              </div>
              {/* "还有更多"滚动指示器 — 参考 clowder-ai ChatInputMenus */}
              {mentionCanScrollDown && (
                <div
                  className="px-3 py-1 text-[10px] text-center border-t"
                  style={{
                    color: "var(--muted)",
                    borderColor: "var(--border)",
                    background: "linear-gradient(to top, var(--bg-elevated), transparent)",
                  }}
                >
                  ↓ 还有更多智能体
                </div>
              )}
              <div
                className="px-3 py-1.5 text-[10px] border-t"
                style={{
                  color: "var(--muted)",
                  borderColor: "var(--border)",
                  background: "var(--bg)",
                }}
              >
                ↑↓ 选择 · Enter 确认 · Esc 关闭
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                // IME 组合结束（用户确认了拼音）
                // 使用 setTimeout 确保 compositionend 事件在 keydown 之前被处理
                // 否则 Chrome 的事件顺序会导致 Enter 被误判为发送
                setTimeout(() => {
                  isComposingRef.current = false;
                }, 0);
              }}
              placeholder="输入消息... 使用 @智能体名 指定发言对象，/ 调出命令菜单"
              disabled={isLoading}
              rows={1}
              className="flex-1 rounded-lg px-3 py-2 text-sm resize-none max-h-32 focus:outline-none"
              style={{
                minHeight: "38px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!inputText.trim() || isLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #fff)",
                border: "none",
                cursor: !inputText.trim() || isLoading ? "not-allowed" : "pointer",
                opacity: !inputText.trim() || isLoading ? 0.4 : 1,
              }}
            >
              发送
            </button>
          </div>
          {error && (
            <div
              className="mt-2 text-xs"
              style={{ color: "var(--semantic-critical, #ef4444)" }}
            >
              {error}
            </div>
          )}
        </div>
      </div>

      {/* 右侧灵智体面板 + 上下文面板（带标签切换） */}
      {showSidebar && (
        <div
          className="w-64 border-l flex-shrink-0 flex flex-col"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
          }}
        >
          {/* 标签切换栏 */}
          <div
            className="flex border-b flex-shrink-0"
            style={{ borderColor: "var(--border)" }}
            role="tablist"
            aria-label="右侧面板标签"
          >
            <button
              onClick={() => setSidebarTab("agents")}
              className="flex-1 text-[11px] font-semibold py-2 transition-colors"
              style={{
                color: sidebarTab === "agents" ? "var(--accent)" : "var(--muted)",
                background: sidebarTab === "agents"
                  ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                  : "transparent",
                border: "none",
                borderBottom: sidebarTab === "agents"
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                cursor: "pointer",
              }}
              role="tab"
              aria-selected={sidebarTab === "agents"}
              aria-controls="sidebar-agents"
            >
              🤝 智能体
            </button>
            <button
              onClick={() => setSidebarTab("context")}
              className="flex-1 text-[11px] font-semibold py-2 transition-colors"
              style={{
                color: sidebarTab === "context" ? "var(--accent)" : "var(--muted)",
                background: sidebarTab === "context"
                  ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                  : "transparent",
                border: "none",
                borderBottom: sidebarTab === "context"
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                cursor: "pointer",
              }}
              role="tab"
              aria-selected={sidebarTab === "context"}
              aria-controls="sidebar-context"
            >
              📊 上下文
            </button>
          </div>

          {/* 标签内容 */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === "agents" && (
              <div id="sidebar-agents" role="tabpanel" className="h-full overflow-y-auto">
                <ForgekinSelector
                  roster={roster}
                  participantIds={config.participantIds}
                  roleAssignment={config.roleAssignment}
                  mutedIds={mutedIds}
                  onToggleParticipant={toggleParticipant}
                  onSetRole={setForgekinRole}
                  onToggleMute={handleToggleMute}
                  compact={compact}
                />
              </div>
            )}
            {sidebarTab === "context" && (
              <div id="sidebar-context" role="tabpanel" className="h-full">
                <ContextPanel
                  messages={messages}
                  roster={roster}
                  participantIds={config.participantIds}
                  maxRounds={config.maxRounds}
                  activeVoteQuestion={activeVote?.question ?? null}
                  compact={compact}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* VoteConfigModal — 发起投票弹窗（参考 clowder-ai VoteConfigModal） */}
      {showVoteModal && (
        <VoteConfigModal
          roster={roster}
          onSubmit={handleVoteSubmit}
          onCancel={() => setShowVoteModal(false)}
        />
      )}

      {/* EditMessageModal — 消息编辑模态框 */}
      {editingMessage && (
        <EditMessageModal
          message={editingMessage}
          onSave={handleSaveEdit}
          onCancel={() => setEditingMessage(null)}
        />
      )}

      {/* DeleteConfirmDialog — 删除确认对话框 */}
      {deletingMessage && (
        <DeleteConfirmDialog
          message={deletingMessage}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingMessage(null)}
        />
      )}
    </div>
  );
}

/** 单条消息气泡 */
interface CouncilMessageBubbleProps {
  message: CouncilMessage;
  onCopy: (msg: CouncilMessage) => void;
  onReply: (msg: CouncilMessage) => void;
  onRegenerate: (msg: CouncilMessage) => void;
  onForward: (msg: CouncilMessage) => void;
  onEdit: (msg: CouncilMessage) => void;
  onDelete: (msg: CouncilMessage) => void;
  copied: boolean;
  forwarded: boolean;
  isReplyTarget: boolean;
  reactions: Record<string, number>;
  onAddReaction: (emoji: string) => void;
  showReactionPicker: boolean;
  onToggleReactionPicker: () => void;
}

function CouncilMessageBubble({
  message,
  onCopy,
  onReply,
  onRegenerate,
  onForward,
  onEdit,
  onDelete,
  copied,
  forwarded,
  isReplyTarget,
  reactions,
  onAddReaction,
  showReactionPicker,
  onToggleReactionPicker,
}: CouncilMessageBubbleProps) {
  const isUser = message.source === "user";
  const isSystem = message.source === "system";
  const isForgekin = message.source === "forgekin";
  const [showActions, setShowActions] = useState(false);
  const reactionEntries = Object.entries(reactions);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div
          className="text-xs px-3 py-1 rounded-full"
          style={{
            color: "var(--muted)",
            background: "color-mix(in srgb, var(--bg-elevated) 60%, transparent)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div
        className="flex justify-end group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className="flex flex-col items-end gap-1 max-w-[75%]">
          <div
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground, #fff)",
            }}
          >
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
          {/* reactions 显示 */}
          {reactionEntries.length > 0 && (
            <div className="flex items-center gap-1">
              {reactionEntries.map(([emoji, count]) => (
                <ReactionBadge
                  key={emoji}
                  emoji={emoji}
                  count={count}
                  onClick={() => onAddReaction(emoji)}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {showActions && (
              <MessageActions
                message={message}
                onCopy={onCopy}
                onReply={onReply}
                onRegenerate={onRegenerate}
                onForward={onForward}
                onEdit={onEdit}
                onDelete={onDelete}
                copied={copied}
                forwarded={forwarded}
                onToggleReactionPicker={onToggleReactionPicker}
              />
            )}
            <span
              className="text-[10px]"
              style={{ color: "var(--muted)", opacity: 0.7 }}
            >
              {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {showReactionPicker && (
            <ReactionPicker onPick={onAddReaction} />
          )}
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
      <div
        className="flex gap-2 group"
        style={{
          padding: "4px",
          margin: "-4px",
          borderRadius: "var(--radius-md, 8px)",
          background: isReplyTarget ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
          transition: "background 0.15s",
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
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
            <span
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              {message.forgekinName}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded text-white"
              style={{ background: colors.primary }}
            >
              {roleCfg.icon} {roleCfg.label}
            </span>
            {message.meta?.model && (
              <span
                className="text-[10px]"
                style={{ color: "var(--muted)", opacity: 0.7 }}
              >
                · {message.meta.model}
              </span>
            )}
          </div>
          <div
            className="rounded-lg px-3 py-2 text-sm border"
            style={{
              background: `${colors.primary}11`,
              borderColor: `${colors.primary}33`,
              color: "var(--text)",
            }}
          >
            {/* 引用回复 pill — 显示被引用的原消息 */}
            {message.replyTo && <ReplyPill replyTo={message.replyTo} />}
            {/* 使用 MarkdownRenderer 渲染智能体回复（支持代码块、列表、链接等） */}
            <MarkdownRenderer content={message.content} />
          </div>
          {/* reactions 显示 */}
          {reactionEntries.length > 0 && (
            <div className="flex items-center gap-1 mt-1">
              {reactionEntries.map(([emoji, count]) => (
                <ReactionBadge
                  key={emoji}
                  emoji={emoji}
                  count={count}
                  onClick={() => onAddReaction(emoji)}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-0.5 relative">
            {showActions && (
              <MessageActions
                message={message}
                onCopy={onCopy}
                onReply={onReply}
                onRegenerate={onRegenerate}
                onForward={onForward}
                onEdit={onEdit}
                onDelete={onDelete}
                copied={copied}
                forwarded={forwarded}
                onToggleReactionPicker={onToggleReactionPicker}
              />
            )}
            <span
              className="text-[10px]"
              style={{ color: "var(--muted)", opacity: 0.7 }}
            >
              {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
            {showReactionPicker && (
              <ReactionPicker onPick={onAddReaction} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/** Reaction 徽章 — 显示 emoji + 计数 */
function ReactionBadge({
  emoji,
  count,
  onClick,
}: {
  emoji: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2 py-0.5 rounded-full transition-colors"
      style={{
        background: "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))",
        border: "1px solid var(--border)",
        color: "var(--text)",
        cursor: "pointer",
      }}
      title={`点击移除 ${emoji}`}
    >
      {emoji} {count}
    </button>
  );
}

/** Reaction 选择器 — 快速选择 emoji */
const REACTION_EMOJIS = ["👍", "❤️", "🤔", "✨", "🎉", "👀"];

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg shadow-lg z-20"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="text-base transition-transform hover:scale-125"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            lineHeight: 1,
          }}
          title={`添加 ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** 消息 hover 操作按钮组（复制 / 引用 / 重新生成 / 转发 / 表情） */
function MessageActions({
  message,
  onCopy,
  onReply,
  onRegenerate,
  onForward,
  onEdit,
  onDelete,
  copied,
  forwarded,
  onToggleReactionPicker,
}: {
  message: CouncilMessage;
  onCopy: (msg: CouncilMessage) => void;
  onReply: (msg: CouncilMessage) => void;
  onRegenerate: (msg: CouncilMessage) => void;
  onForward: (msg: CouncilMessage) => void;
  onEdit: (msg: CouncilMessage) => void;
  onDelete: (msg: CouncilMessage) => void;
  copied: boolean;
  forwarded: boolean;
  onToggleReactionPicker: () => void;
}) {
  const btnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "var(--muted)",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: "11px",
    borderRadius: "4px",
    transition: "color 0.15s, background 0.15s",
  };
  const attachHover = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = "var(--accent)";
    e.currentTarget.style.background = "var(--bg-hover, color-mix(in srgb, var(--accent) 8%, transparent))";
  };
  const attachLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = "var(--muted)";
    e.currentTarget.style.background = "transparent";
  };
  // 仅智能体消息可重新生成（用户消息无意义）
  const canRegenerate = message.source === "forgekin";
  // 仅用户消息可编辑
  const canEdit = message.source === "user";
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onCopy(message)}
        style={btnStyle}
        title="复制消息"
        onMouseEnter={attachHover}
        onMouseLeave={attachLeave}
      >
        {copied ? "✓ 已复制" : "⎘ 复制"}
      </button>
      {canEdit && (
        <button
          onClick={() => onEdit(message)}
          style={btnStyle}
          title="编辑消息"
          onMouseEnter={attachHover}
          onMouseLeave={attachLeave}
        >
          ✏️ 编辑
        </button>
      )}
      {message.source !== "user" && (
        <button
          onClick={() => onReply(message)}
          style={btnStyle}
          title="引用回复"
          onMouseEnter={attachHover}
          onMouseLeave={attachLeave}
        >
          ↪ 引用
        </button>
      )}
      {canRegenerate && (
        <button
          onClick={() => onRegenerate(message)}
          style={btnStyle}
          title="重新生成"
          onMouseEnter={attachHover}
          onMouseLeave={attachLeave}
        >
          ⟳ 重生
        </button>
      )}
      <button
        onClick={() => onForward(message)}
        style={btnStyle}
        title="转发消息"
        onMouseEnter={attachHover}
        onMouseLeave={attachLeave}
      >
        {forwarded ? "✓ 已转发" : "↗ 转发"}
      </button>
      <button
        onClick={onToggleReactionPicker}
        style={btnStyle}
        title="添加表情"
        onMouseEnter={attachHover}
        onMouseLeave={attachLeave}
      >
        ☺ 表情
      </button>
      <button
        onClick={() => onDelete(message)}
        style={btnStyle}
        title="删除消息"
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--semantic-critical, #ef4444)";
          e.currentTarget.style.background = "var(--bg-hover, color-mix(in srgb, var(--semantic-critical, #ef4444) 10%, transparent))";
        }}
        onMouseLeave={attachLeave}
      >
        🗑 删除
      </button>
    </div>
  );
}

/** 编辑消息模态框 — textarea + 保存/取消，Ctrl+Enter 快捷保存 */
function EditMessageModal({
  message,
  onSave,
  onCancel,
}: {
  message: CouncilMessage;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 打开时聚焦并选中末尾
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter / Cmd+Enter 保存
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (text.trim()) onSave(text);
      return;
    }
    // Esc 取消
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-lg mx-4 p-4 flex flex-col gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            ✏️ 编辑消息
          </span>
          <button
            onClick={onCancel}
            style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px 6px" }}
            title="取消"
          >
            ✕
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          className="rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            minHeight: "80px",
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
            Ctrl+Enter 保存 · Esc 取消
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              onClick={() => text.trim() && onSave(text)}
              disabled={!text.trim()}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #fff)",
                border: "none",
                cursor: text.trim() ? "pointer" : "not-allowed",
                opacity: text.trim() ? 1 : 0.4,
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 删除确认对话框 — 二次确认避免误删 */
function DeleteConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: CouncilMessage;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-sm mx-4 p-4 flex flex-col gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          🗑 确认删除消息？
        </div>
        <div
          className="text-xs rounded px-2 py-1.5 max-h-24 overflow-y-auto"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--muted)",
          }}
        >
          {message.content.slice(0, 200).replace(/\n/g, " ")}
          {message.content.length > 200 ? "..." : ""}
        </div>
        <p className="text-xs" style={{ color: "var(--semantic-critical, #ef4444)" }}>
          删除后不可恢复。
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: "var(--semantic-critical, #ef4444)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
