"use client";

/**
 * useCouncilSocket — 群聊 WebSocket 实时推送 Hook
 *
 * 连接后端 /api/v1/forgemind/council/ws，实现：
 *   - 实时连接状态感知（连接中/已连接/断开/重连中）
 *   - 心跳保活（30s ping/pong）
 *   - 会话订阅（subscribe/unsubscribe thread）
 *   - 消息事件回调（onMessage/onThreadUpdate/onError）
 *
 * 后端当前仅支持心跳和订阅确认，后续可扩展为实时消息推送。
 * 参考 clowder-ai useSocket.ts 的设计简化版。
 */

import { useState, useEffect, useRef, useCallback } from "react";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface CouncilSocketOptions {
  /** 是否启用 WebSocket（默认 false，需显式开启） */
  enabled?: boolean;
  /** 会话 ID（订阅指定会话的事件） */
  threadId?: string | null;
  /** 收到消息时的回调 */
  onMessage?: (data: unknown) => void;
  /** 收到会话更新时的回调 */
  onThreadUpdate?: (data: unknown) => void;
  /** 错误回调 */
  onError?: (data: unknown) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;

export function useCouncilSocket(options: CouncilSocketOptions = {}) {
  const {
    enabled = false,
    threadId = null,
    onMessage,
    onThreadUpdate,
    onError,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedThreadRef = useRef<string | null>(null);

  // 回调存储到 ref 避免重连
  const onMessageRef = useRef(onMessage);
  const onThreadUpdateRef = useRef(onThreadUpdate);
  const onErrorRef = useRef(onError);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onThreadUpdateRef.current = onThreadUpdate; }, [onThreadUpdate]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  /** 发送 JSON 消息 */
  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  /** 订阅会话 */
  const subscribe = useCallback((tid: string) => {
    if (subscribedThreadRef.current !== tid) {
      send({ type: "subscribe", threadId: tid });
      subscribedThreadRef.current = tid;
    }
  }, [send]);

  /** 取消订阅 */
  const unsubscribe = useCallback((tid: string) => {
    send({ type: "unsubscribe", threadId: tid });
    if (subscribedThreadRef.current === tid) {
      subscribedThreadRef.current = null;
    }
  }, [send]);

  /** 连接 WebSocket */
  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/forgemind/council/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        // 启动心跳
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          send({ type: "ping" });
        }, HEARTBEAT_INTERVAL_MS);
        // 重新订阅当前会话
        if (threadId) {
          subscribe(threadId);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case "connected":
              // 服务端确认连接
              break;
            case "pong":
              // 心跳响应
              break;
            case "subscribed":
              // 订阅确认
              break;
            case "agent_message":
            case "message":
              onMessageRef.current?.(data.data ?? data);
              break;
            case "thread_updated":
            case "thread_created":
              onThreadUpdateRef.current?.(data.data ?? data);
              break;
            case "error":
              onErrorRef.current?.(data.data ?? data);
              break;
            default:
              // 未知事件类型，忽略
              break;
          }
        } catch {
          // 非 JSON 消息，忽略
        }
      };

      ws.onerror = () => {
        onErrorRef.current?.({ error: "WebSocket error" });
      };

      ws.onclose = () => {
        setStatus("disconnected");
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        // 自动重连
        if (enabled) {
          setStatus("reconnecting");
          reconnectRef.current = setTimeout(() => {
            connect();
          }, RECONNECT_DELAY_MS);
        }
      };
    } catch {
      setStatus("disconnected");
    }
  }, [enabled, threadId, send, subscribe]);

  /** 断开连接 */
  const disconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  // 启用/禁用 WebSocket
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  // 会话切换时重新订阅
  useEffect(() => {
    if (status === "connected" && threadId) {
      subscribe(threadId);
    }
  }, [threadId, status, subscribe]);

  return {
    status,
    send,
    subscribe,
    unsubscribe,
    connect,
    disconnect,
  };
}
