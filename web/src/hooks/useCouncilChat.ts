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
 * 详见 MERGE-SPEC.md §3.2 聊天模式融合设计
 */
export function useCouncilChat() {
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [roster, setRoster] = useState<ForgekinRosterItem[]>([]);
  const [config, setConfig] = useState<CouncilConfig>(DEFAULT_COUNCIL_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  /** 发送消息（触发灵议） */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setError(null);

      // 添加用户消息
      const userMsg: CouncilMessage = {
        id: `user-${Date.now()}`,
        source: "user",
        content: text,
        timestamp: Date.now(),
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
      const sysMsg: CouncilMessage = {
        id: `sys-${Date.now()}`,
        source: "system",
        content: `灵议进行中：${participantIds.length} 个灵智体参与，共 ${config.maxRounds} 轮...`,
        timestamp: Date.now() + 1,
      };
      setMessages((prev) => [...prev, sysMsg]);

      try {
        const reqBody: CouncilRequest = {
          topic: text,
          forgekin_ids: participantIds,
          max_rounds: config.maxRounds,
        };

        const res = await fetch("/api/v1/forgemind/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
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
            newMessages.push({
              id: `forgekin-${round.round}-${msg.forgekin_id}-${Date.now()}-${Math.random()}`,
              source: "forgekin",
              forgekinId: msg.forgekin_id,
              forgekinName: msg.name,
              forgekinRole: role,
              content: msg.content,
              timestamp: Date.now() + newMessages.length,
              meta: {
                model: "trae",
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
        // 移除"灵议进行中"系统消息
        setMessages((prev) => prev.filter((m) => m.id !== sysMsg.id));
        const errMsg = e instanceof Error ? e.message : String(e);
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
    [config, isLoading, parseMentions, roster]
  );

  /** 清空消息 */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
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
    updateConfig,
    toggleParticipant,
    setForgekinRole,
    reloadRoster: loadRoster,
  };
}
