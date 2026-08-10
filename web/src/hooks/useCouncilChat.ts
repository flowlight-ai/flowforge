"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  CouncilMessage,
  CouncilConfig,
  CouncilRequest,
  CouncilResponse,
  ForgekinRosterItem,
  DEFAULT_COUNCIL_CONFIG,
  isAllMention,
} from "../lib/council-types";

/**
 * useCouncilChat — 5 灵智体协作群聊 Hook（多会话版）
 *
 * 调用后端端点：
 *   - GET  /api/v1/forgemind/roster           → 加载花名册
 *   - POST /api/v1/forgemind/council           → 发起灵议（多轮讨论）
 *   - GET  /api/v1/threads/{id}/messages       → 加载会话消息历史
 *   - POST /api/v1/threads/{id}/messages       → 追加单条消息
 *   - POST /api/v1/threads/{id}/messages/batch → 批量追加消息
 *
 * 多会话支持：
 *   - 接收 threadId 参数，切换会话时自动加载对应消息历史
 *   - 发送消息和灵议响应自动持久化到后端
 *   - 不再依赖 localStorage（改为后端持久化，支持跨设备）
 *
 * 超时处理：
 *   - council 请求使用 AbortController，超时 180s
 *   - 超时后自动取消并提示用户
 */

// config 仍用 localStorage（会话级配置不影响跨设备）
const STORAGE_KEY_CONFIG = "flowforge:council:config";
// council 请求超时（毫秒）
const COUNCIL_TIMEOUT_MS = 180_000;

/** 从 localStorage 安全读取 JSON */
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 安全写入 localStorage */
function saveToStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded 或隐私模式 — 静默失败
  }
}

/** 后端消息 → CouncilMessage 转换 */
function backendMsgToCouncil(msg: Record<string, unknown>): CouncilMessage {
  return {
    id: msg.id as string,
    source: msg.source as CouncilMessage["source"],
    content: msg.content as string,
    timestamp: msg.timestamp as number,
    forgekinId: (msg.forgekin_id as string) || undefined,
    forgekinName: (msg.forgekin_name as string) || undefined,
    forgekinRole: (msg.forgekin_role as CouncilMessage["forgekinRole"]) || undefined,
    meta: (msg.meta as Record<string, unknown>) || {},
  };
}

export function useCouncilChat(threadId: string | null) {
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [roster, setRoster] = useState<ForgekinRosterItem[]>([]);
  const [config, setConfig] = useState<CouncilConfig>(() =>
    loadFromStorage<CouncilConfig>(STORAGE_KEY_CONFIG, DEFAULT_COUNCIL_CONFIG)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  // 持久化 config 到 localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEY_CONFIG, config);
  }, [config]);

  // 切换会话时从后端加载消息历史（分页：初始加载 50 条）
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    let cancelled = false;
    offsetRef.current = 0;
    (async () => {
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/messages?limit=50&offset=0`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const msgs: CouncilMessage[] = (data.items || []).map(backendMsgToCouncil);
        setMessages(msgs);
        offsetRef.current = msgs.length;
        setHasMore(typeof data.total === "number" ? msgs.length < data.total : msgs.length === 50);
      } catch {
        // 静默失败，空消息列表
        if (!cancelled) {
          setMessages([]);
          setHasMore(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // 页面卸载时取消进行中的请求
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  /** 加载灵智体花名册 */
  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/forgemind/roster");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: ForgekinRosterItem[] = data.builtin || [];
      setRoster(items.filter((r) => r.available && !r.error));
    } catch (e) {
      setError(`加载花名册失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  /** 滚动到消息底部 */
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /** 解析 @mention，提取被提及的灵智体 ID */
  const parseMentions = useCallback(
    (text: string): string[] => {
      const mentioned: string[] = [];
      for (const item of roster) {
        const patterns = [
          `@${item.name}`,
          `@${item.id}`,
          `@${item.nickname}`,
        ];
        if (patterns.some((p) => text.includes(p))) {
          mentioned.push(item.id);
        }
      }
      return mentioned;
    },
    [roster]
  );

  /** 持久化单条消息到后端 */
  const persistMessage = useCallback(
    async (msg: CouncilMessage) => {
      if (!threadId) return;
      try {
        await fetch(`/api/v1/threads/${threadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: msg.source,
            content: msg.content,
            timestamp: msg.timestamp,
            forgekin_id: msg.forgekinId || null,
            forgekin_name: msg.forgekinName || null,
            forgekin_role: msg.forgekinRole || null,
            meta: msg.meta || {},
          }),
        });
      } catch {
        // 持久化失败不阻断 UI
      }
    },
    [threadId]
  );

  /** 批量持久化消息到后端 */
  const persistMessages = useCallback(
    async (msgs: CouncilMessage[]) => {
      if (!threadId || msgs.length === 0) return;
      try {
        await fetch(`/api/v1/threads/${threadId}/messages/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs.map((m) => ({
              source: m.source,
              content: m.content,
              timestamp: m.timestamp,
              forgekin_id: m.forgekinId || null,
              forgekin_name: m.forgekinName || null,
              forgekin_role: m.forgekinRole || null,
              meta: m.meta || {},
            })),
          }),
        });
      } catch {
        // 持久化失败不阻断 UI
      }
    },
    [threadId]
  );

  /** 发送消息（触发灵议） */
  const sendMessage = useCallback(
    async (text: string, replyTo?: CouncilMessage) => {
      if (!text.trim() || isLoading) return;
      if (!threadId) {
        setError("请先选择或新建一个会话");
        return;
      }

      setError(null);

      // 添加用户消息（乐观更新）
      const userMsg: CouncilMessage = {
        id: `user-${Date.now()}`,
        source: "user",
        content: text,
        timestamp: Date.now(),
        replyTo,
      };
      setMessages((prev) => [...prev, userMsg]);
      // 持久化用户消息到后端
      void persistMessage(userMsg);

      // autoTitle：首条消息后自动更新会话标题（参考 clowder-ai F164）
      if (messages.length === 0 && threadId) {
        const title = text.slice(0, 30).trim() || "未命名讨论";
        fetch(`/api/v1/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).catch(() => { /* 静默失败 */ });
      }

      // ── 路由策略（参考 clowder-ai AgentRouter）──────────────
      // 默认不传 forgekin_ids → 后端 fallback 链决定单智能体（上次回复者 > luban）
      // @all → 后端展开为全部并行
      // @特定 → 后端仅调用被提及的智能体
      // 用户在 UI 显式选了多个参与者且未 @ → 传选中的 ID 列表
      const mentioned = parseMentions(text);
      const isAll = isAllMention(text);
      let reqForgekinIds: string[] = [];
      let reqMode: "auto" | "single" | "parallel" = "auto";

      if (isAll) {
        // @all → 传空数组 + parallel，让后端展开为全部
        reqForgekinIds = [];
        reqMode = "parallel";
      } else if (mentioned.length > 0) {
        // @特定 → 传被提及的 ID
        reqForgekinIds = mentioned;
        reqMode = mentioned.length > 1 ? "parallel" : "single";
      } else if (config.participantIds.length > 0) {
        // 无 @，但用户在 UI 选了偏好参与者 → 传偏好列表
        // 注意：如果只选了 1 个，后端会用这个；如果选了多个，后端会并行
        reqForgekinIds = config.participantIds;
        reqMode = config.participantIds.length > 1 ? "parallel" : "single";
      }
      // 否则 reqForgekinIds 保持空数组，后端走 fallback 链（上次回复者 > luban）

      setIsLoading(true);

      // 创建 AbortController 用于超时取消
      const controller = new AbortController();
      abortRef.current = controller;
      // single 模式超时缩短到 60s（单智能体应该快）；parallel 保持 180s
      const timeoutMs = reqMode === "single" ? 60_000 : COUNCIL_TIMEOUT_MS;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // 添加"灵议进行中"系统消息
      const modeLabel = reqMode === "parallel" ? "多智能体并行" : "单智能体";
      const sysMsg: CouncilMessage = {
        id: `sys-${Date.now()}`,
        source: "system",
        content: `灵议进行中（${modeLabel}模式）...（超时 ${timeoutMs / 1000}s）`,
        timestamp: Date.now() + 1,
      };
      setMessages((prev) => [...prev, sysMsg]);

      try {
        const reqBody: CouncilRequest = {
          topic: text,
          forgekin_ids: reqForgekinIds,
          max_rounds: config.maxRounds,
          thread_id: threadId,
          mode: reqMode,
        };

        const res = await fetch("/api/v1/forgemind/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data: CouncilResponse = await res.json();

        // 移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== sysMsg.id));

        // 将灵议响应转换为消息流
        const newMessages: CouncilMessage[] = [];
        for (const round of data.rounds) {
          for (const msg of round.messages) {
            const forgekin = roster.find(
              (r) => r.id === msg.forgekin_id || r.name === msg.name
            );
            const role = forgekin ? config.roleAssignment[forgekin.id] || "observer" : "observer";
            const model = msg.model || "unknown";
            const usage = msg.usage || {};
            newMessages.push({
              id: `forgekin-${round.round}-${msg.forgekin_id}-${Date.now()}-${Math.random()}`,
              source: "forgekin",
              forgekinId: msg.forgekin_id,
              forgekinName: msg.name,
              forgekinRole: role,
              content: msg.content,
              timestamp: Date.now() + newMessages.length,
              meta: {
                model,
                usage,
                routingMode: data.routing_mode,
              },
            });
          }
        }

        // 添加摘要消息（如果有 — 仅 parallel 模式且多轮时生成）
        let summaryMsg: CouncilMessage | null = null;
        if (data.summary) {
          summaryMsg = {
            id: `summary-${Date.now()}`,
            source: "system",
            content: `📋 灵议摘要：${data.summary}`,
            timestamp: Date.now() + newMessages.length + 1,
          };
        }

        const allNew = summaryMsg ? [...newMessages, summaryMsg] : newMessages;
        setMessages((prev) => [...prev, ...allNew]);
        // 批量持久化灵议响应到后端
        void persistMessages(allNew);
      } catch (e) {
        // 移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== sysMsg.id));
        let errMsg: string;
        if (e instanceof DOMException && e.name === "AbortError") {
          errMsg = `灵议超时（${timeoutMs / 1000}s），请减少轮数或灵智体数量后重试`;
        } else if (e instanceof Error) {
          errMsg = e.message;
        } else {
          errMsg = String(e);
        }
        setError(`灵议失败: ${errMsg}`);

        const errorMsg: CouncilMessage = {
          id: `error-${Date.now()}`,
          source: "system",
          content: `⚠ 灵议失败：${errMsg}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        clearTimeout(timeoutId);
        abortRef.current = null;
        setIsLoading(false);
      }
    },
    [config, isLoading, messages.length, parseMentions, roster, threadId, persistMessage, persistMessages]
  );

  /** 取消进行中的灵议请求 */
  const cancelRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  /** 清空当前会话消息（同步后端，保留会话本身） */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    if (threadId) {
      fetch(`/api/v1/threads/${threadId}/messages`, { method: "DELETE" })
        .catch(() => { /* 静默失败 */ });
    }
  }, [threadId]);

  /**
   * 添加系统消息 — 供 UI 层主动推送通知（投票发起、命令帮助等）
   * 不触发 LLM 调用，仅插入消息流并持久化
   */
  const addSystemMessage = useCallback(
    (content: string) => {
      const sysMsg: CouncilMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: "system",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, sysMsg]);
      void persistMessage(sysMsg);
    },
    [persistMessage]
  );

  /** 加载更多历史消息（分页，在前面插入旧消息） */
  const loadMore = useCallback(async () => {
    if (!threadId || !hasMore) return;
    try {
      const offset = offsetRef.current;
      const res = await fetch(`/api/v1/threads/${threadId}/messages?limit=50&offset=${offset}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: CouncilMessage[] = (data.items || []).map(backendMsgToCouncil);
      if (msgs.length === 0) {
        setHasMore(false);
        return;
      }
      // offset=0 是最新消息，越大越旧 → 旧消息插入到前面
      setMessages((prev) => [...msgs, ...prev]);
      offsetRef.current = offset + msgs.length;
      setHasMore(typeof data.total === "number" ? offsetRef.current < data.total : msgs.length === 50);
    } catch {
      // 静默失败
    }
  }, [threadId, hasMore]);

  /** 编辑消息内容 */
  const editMessage = useCallback(
    async (msgId: string, newContent: string) => {
      if (!threadId) return;
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/messages/${msgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        });
        if (!res.ok) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, content: newContent } : m))
        );
      } catch {
        // 静默失败
      }
    },
    [threadId]
  );

  /** 删除消息（软删除） */
  const deleteMessage = useCallback(
    async (msgId: string) => {
      if (!threadId) return;
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/messages/${msgId}`, {
          method: "DELETE",
        });
        if (!res.ok) return;
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      } catch {
        // 静默失败
      }
    },
    [threadId]
  );

  /** 接收 WebSocket 推送的消息（不持久化，因为后端已持久化） */
  const receiveMessage = useCallback((msg: CouncilMessage) => {
    setMessages((prev) => {
      // 去重：避免 WebSocket 推送与 REST 响应重复
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  /** 更新配置 */
  const updateConfig = useCallback((updates: Partial<CouncilConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  /** 切换灵智体参与状态 */
  const toggleParticipant = useCallback((forgekinId: string) => {
    setConfig((prev) => {
      const isIn = prev.participantIds.includes(forgekinId);
      const participantIds = isIn
        ? prev.participantIds.filter((id) => id !== forgekinId)
        : [...prev.participantIds, forgekinId];
      return { ...prev, participantIds };
    });
  }, []);

  /** 设置灵智体角色 */
  const setForgekinRole = useCallback((forgekinId: string, role: CouncilConfig["roleAssignment"][string]) => {
    setConfig((prev) => ({
      ...prev,
      roleAssignment: { ...prev.roleAssignment, [forgekinId]: role },
    }));
  }, []);

  return {
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
    cancelRequest,
    clearMessages,
    addSystemMessage,
    updateConfig,
    toggleParticipant,
    setForgekinRole,
    reloadRoster: loadRoster,
  };
}
