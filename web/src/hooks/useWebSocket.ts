"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { HelmWSEvent, HelmTaskPhase, StreamEntry, StreamEntryType } from "../lib/helm-types";
import { useShellConfig } from "../lib/shell-config";

const MAX_RECONNECT = 10;

function eventToEntry(event: HelmWSEvent): StreamEntry {
  const typeMap: Record<string, StreamEntryType> = {
    "helm.stage.enter": "stage",
    "helm.tool.end": "tool-call",
    "helm.llm.reasoning": "thinking",
    "helm.llm.stream": "llm-stream",
    "helm.step.intermediate": "intermediate",
    "helm.draft.update": "draft-update",
    "helm.review.ready": "review",
    "helm.gate.verdict": "gate",
    "helm.task.completed": "system",
    "helm.task.error": "system",
  };

  return {
    id: `e-${event.seq}`,
    type: typeMap[event.type] || "system",
    timestamp: event.timestamp,
    data: event.payload,
  };
}

export interface UseWebSocketOptions {
  onStageEnter?: (stage: string, label: string, order: number) => void;
  onToolCall?: (type: "start" | "end", data: Record<string, any>) => void;
  onDraftUpdate?: (content: string, isPartial: boolean) => void;
  onReviewReady?: (summary: string) => void;
  onGateVerdict?: (verdict: Record<string, any>) => void;
  onError?: (step: string, msg: string) => void;
  onCompleted?: (data: Record<string, any>) => void;
}

export function useWebSocket(opts?: UseWebSocketOptions) {
  const config = useShellConfig();
  const [phase, setPhase] = useState<HelmTaskPhase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [stageProgress, setStageProgress] = useState({ current: 0, total: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const entriesRef = useRef<StreamEntry[]>([]);
  const seqRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const handleEvent = useCallback((event: HelmWSEvent) => {
    seqRef.current = event.seq;
    const entry = eventToEntry(event);
    entriesRef.current = [...entriesRef.current, entry];
    setEntries([...entriesRef.current]);

    switch (event.type) {
      case "helm.stage.enter":
        setStageProgress({ current: event.payload.order, total: event.payload.total });
        optsRef.current?.onStageEnter?.(event.payload.stage, event.payload.label, event.payload.order);
        break;
      case "helm.tool.start":
        optsRef.current?.onToolCall?.("start", event.payload);
        break;
      case "helm.tool.end":
        optsRef.current?.onToolCall?.("end", event.payload);
        break;
      case "helm.review.ready":
        setPhase("waiting_review");
        optsRef.current?.onReviewReady?.(event.payload.draft_summary);
        break;
      case "helm.gate.verdict":
        optsRef.current?.onGateVerdict?.(event.payload);
        break;
      case "helm.task.completed":
        setPhase("completed");
        optsRef.current?.onCompleted?.(event.payload);
        break;
      case "helm.task.error":
        setPhase("error");
        optsRef.current?.onError?.(event.payload.step_name || "unknown", event.payload.error_message || "Unknown error");
        break;
      case "helm.task.paused":
        setPhase("paused");
        break;
      case "helm.task.resumed":
        setPhase("running");
        break;
    }
  }, []);

  const connect = useCallback((tid: string) => {
    setPhase("connecting");
    const wsBase = config.wsBaseUrl ||
      (typeof window !== "undefined"
        ? `ws://${window.location.hostname}:${window.location.port || "5174"}`
        : "ws://localhost:5174");
    const ws = new WebSocket(`${wsBase}/ws/${tid}`);

    ws.onopen = () => {
      reconnectCount.current = 0;
      setPhase("running");
      setTaskId(tid);
      ws.send(JSON.stringify({ type: "subscribe", task_id: tid }));
    };

    ws.onmessage = (event) => {
      try {
        const data: HelmWSEvent = JSON.parse(event.data);
        if (data.type === "pong") return;
        handleEvent(data);
      } catch (e) {
        // 非 JSON 消息：记录日志便于排查，不影响连接
        console.warn("[useWebSocket] 忽略非 JSON 消息", e instanceof Error ? e.message : e);
      }
    };

    ws.onclose = () => {
      if (reconnectCount.current < MAX_RECONNECT) {
        const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), 30000);
        reconnectCount.current++;
        setTimeout(() => connect(tid), delay);
      } else {
        setPhase("error");
        optsRef.current?.onError?.("websocket", "Connection lost");
      }
    };

    wsRef.current = ws;
  }, [handleEvent, config.wsBaseUrl]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const send = useCallback((message: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const reset = useCallback(() => {
    disconnect();
    setPhase("idle");
    setTaskId(null);
    setEntries([]);
    entriesRef.current = [];
    seqRef.current = 0;
    setStageProgress({ current: 0, total: 0 });
  }, [disconnect]);

  return {
    phase, taskId, entries, stageProgress,
    connect, disconnect, send, reset,
  };
}
