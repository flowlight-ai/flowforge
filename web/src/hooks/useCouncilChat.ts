"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  CouncilMessage,
  CouncilConfig,
  CouncilRequest,
  CouncilResponse,
  ForgekinRosterItem,
  DEFAULT_COUNCIL_CONFIG,
} from "../lib/council-types";

/**
 * useCouncilChat — 5 灵智体协作群聊 Hook
 *
 * 调用 FlowForge 8000 后端 /api/v1/forgemind/* 端点：
 *   - GET  /api/v1/forgemind/roster    → 加载花名册
 *   - POST /api/v1/forgemind/council    → 发起灵议（多轮讨论）
 *
 * 群聊状态管理：
 *   - messages: 消息流（用户消息 + 灵智体响应 + 系统消息）
 *   - roster: 灵智体花名册
 *   - config: 群聊配置（参与灵智体/角色分配/轮数）
 *   - isLoading: 灵议进行中标志
 *
 * 持久化与中断恢复（v2 修复）:
 *   - messages: 持久化到 localStorage（最近 200 条）
 *   - config: 持久化到 localStorage（智能体选择/角色/轮数）
 *   - pendingRequest: 持久化到 localStorage（正在进行的灵议请求）
 *   - 页面刷新时检测中断的请求，替换"灵议进行中"为"⚠ 会话中断"，
 *     并提供 retryInterrupted() 重试功能
 *
 */

const STORAGE_KEY = "flowforge-council-messages";
const CONFIG_KEY = "flowforge-council-config";
const PENDING_KEY = "flowforge-council-pending";

/** 中断请求的最大有效期（5 分钟），超过则视为中断 */
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

/** 待处理请求信息（持久化到 localStorage，用于中断恢复） */
interface PendingRequest {
  topic: string;
  participantIds: string[];
  maxRounds: number;
  /** 请求发起时间戳 */
  startedAt: number;
  /** "灵议进行中"系统消息的 ID（用于中断时替换） */
  sysMsgId: string;
  /** 用户消息的 ID（用于中断时定位） */
  userMsgId: string;
}

export function useCouncilChat() {
  // ── 消息持久化 ──────────────────────────────────────────────
  const [messages, setMessages] = useState<CouncilMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // ── 配置持久化 ──────────────────────────────────────────────
  const [config, setConfig] = useState<CouncilConfig>(() => {
    if (typeof window === "undefined") return DEFAULT_COUNCIL_CONFIG;
    try {
      const stored = window.localStorage.getItem(CONFIG_KEY);
      return stored ? { ...DEFAULT_COUNCIL_CONFIG, ...JSON.parse(stored) } : DEFAULT_COUNCIL_CONFIG;
    } catch {
      return DEFAULT_COUNCIL_CONFIG;
    }
  });

  const [roster, setRoster] = useState<ForgekinRosterItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** 中断的请求信息（供 UI 显示"重试"按钮） */
  const [interruptedRequest, setInterruptedRequest] = useState<PendingRequest | null>(null);

  // ── 持久化 messages 到 localStorage ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-200)));
    } catch {
      // localStorage 满或不可用时忽略
    }
  }, [messages]);

  // ── 持久化 config 到 localStorage ───────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // 忽略
    }
  }, [config]);

  // ── 中断恢复：页面加载时检测未完成的请求 ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const pendingRaw = window.localStorage.getItem(PENDING_KEY);
      if (!pendingRaw) return;

      const pending: PendingRequest = JSON.parse(pendingRaw);
      const elapsed = Date.now() - pending.startedAt;

      // 清除 pending 标记（无论是否过期，都不再认为请求在进行中）
      window.localStorage.removeItem(PENDING_KEY);

      if (elapsed < PENDING_TIMEOUT_MS && elapsed > 0) {
        // 请求可能在进行中（页面刷新中断），标记为可重试
        setInterruptedRequest(pending);

        // 替换"灵议进行中"系统消息为中断提示
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pending.sysMsgId
              ? {
                  ...m,
                  content: `⚠ 灵议因页面刷新中断（已等待 ${Math.round(elapsed / 1000)}s）。点击"重试"重新发起。`,
                }
              : m
          )
        );
      } else {
        // 请求已过期，直接移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== pending.sysMsgId));
        setInterruptedRequest(pending);
      }
    } catch {
      // 忽略解析错误
    }
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

  /** 保存 pending 请求到 localStorage（用于中断恢复） */
  const savePending = useCallback((pending: PendingRequest) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
      // 忽略
    }
  }, []);

  /** 清除 pending 请求（请求完成或失败时调用） */
  const clearPending = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(PENDING_KEY);
    } catch {
      // 忽略
    }
  }, []);

  /** 发送消息（触发灵议） */
  const sendMessage = useCallback(
    async (text: string, replyTo?: CouncilMessage) => {
      if (!text.trim() || isLoading) return;

      setError(null);
      setInterruptedRequest(null);

      // 添加用户消息（可选包含引用回复的原消息）
      const userMsgId = `user-${Date.now()}`;
      const userMsg: CouncilMessage = {
        id: userMsgId,
        source: "user",
        content: text,
        timestamp: Date.now(),
        replyTo,
      };
      setMessages((prev) => [...prev, userMsg]);

      // 解析 @mention，决定哪些灵智体参与
      const mentioned = parseMentions(text);
      const participantIds =
        mentioned.length > 0
          ? mentioned
          : config.participantIds;

      if (participantIds.length === 0) {
        setError("请至少选择一个灵智体参与（或@mention）");
        return;
      }

      setIsLoading(true);

      // 添加"灵议进行中"系统消息
      const sysMsgId = `sys-${Date.now()}`;
      const sysMsg: CouncilMessage = {
        id: sysMsgId,
        source: "system",
        content: `灵议进行中：${participantIds.length} 个灵智体参与，共 ${config.maxRounds} 轮...`,
        timestamp: Date.now() + 1,
      };
      setMessages((prev) => [...prev, sysMsg]);

      // 保存 pending 请求信息（用于中断恢复）
      const pending: PendingRequest = {
        topic: text,
        participantIds,
        maxRounds: config.maxRounds,
        startedAt: Date.now(),
        sysMsgId,
        userMsgId,
      };
      savePending(pending);

      try {
        const reqBody: CouncilRequest = {
          topic: text,
          forgekin_ids: participantIds,
          max_rounds: config.maxRounds,
        };

        // 超时控制：5 个 Forgekin × 2 轮 × 15s/个 ≈ 150s，设 180s 超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        const res = await fetch("/api/v1/forgemind/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data: CouncilResponse = await res.json();

        // 请求成功，清除 pending 标记
        clearPending();

        // 移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== sysMsgId));

        // 将灵议响应转换为消息流
        const newMessages: CouncilMessage[] = [];
        for (const round of data.rounds) {
          for (const msg of round.messages) {
            const forgekin = roster.find(
              (r) => r.id === msg.forgekin_id || r.name === msg.name
            );
            const role = forgekin ? config.roleAssignment[forgekin.id] || "observer" : "observer";
            newMessages.push({
              id: `forgekin-${round.round}-${msg.forgekin_id}-${Date.now()}-${Math.random()}`,
              source: "forgekin",
              forgekinId: msg.forgekin_id,
              forgekinName: msg.name,
              forgekinRole: role,
              content: msg.content,
              timestamp: Date.now() + newMessages.length,
              meta: {
                model: msg.model || "unknown",
                usage: msg.usage,
              },
            });
          }
        }

        // 添加摘要消息（如果有）
        if (data.summary) {
          newMessages.push({
            id: `summary-${Date.now()}`,
            source: "system",
            content: `📋 灵议摘要：${data.summary}`,
            timestamp: Date.now() + newMessages.length + 1,
          });
        }

        setMessages((prev) => [...prev, ...newMessages]);
      } catch (e) {
        // 请求失败，清除 pending 标记
        clearPending();

        // 移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== sysMsgId));
        const errMsg = e instanceof Error
          ? (e.name === "AbortError" ? "灵议超时（180s），请减少轮数或参与灵智体数量" : e.message)
          : String(e);
        setError(`灵议失败: ${errMsg}`);

        // 添加错误系统消息
        const errorMsg: CouncilMessage = {
          id: `error-${Date.now()}`,
          source: "system",
          content: `⚠ 灵议失败：${errMsg}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [config, isLoading, parseMentions, roster, savePending, clearPending]
  );

  /** 重试中断的请求（页面刷新后恢复） */
  const retryInterrupted = useCallback(() => {
    if (!interruptedRequest) return;

    // 移除中断提示消息和原用户消息（重新发送会生成新的）
    setMessages((prev) =>
      prev.filter(
        (m) =>
          m.id !== interruptedRequest.sysMsgId &&
          m.id !== interruptedRequest.userMsgId
      )
    );

    setInterruptedRequest(null);

    // 重新发送原始消息
    sendMessage(interruptedRequest.topic);
  }, [interruptedRequest, sendMessage]);

  /** 清空消息（同时清除 localStorage） */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setInterruptedRequest(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PENDING_KEY);
    }
  }, []);

  /**
   * 添加系统消息 — 供 UI 层主动推送通知（投票发起、命令帮助等）
   * 不触发 LLM 调用，仅插入消息流
   */
  const addSystemMessage = useCallback((content: string) => {
    const sysMsg: CouncilMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "system",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, sysMsg]);
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
    sendMessage,
    clearMessages,
    addSystemMessage,
    updateConfig,
    toggleParticipant,
    setForgekinRole,
    reloadRoster: loadRoster,
    // 中断恢复
    interruptedRequest,
    retryInterrupted,
  };
}
