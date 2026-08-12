"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  HelmWSEvent,
  StreamEntry,
  HelmTaskPhase,
  StreamEntryType,
  HelmWSOptions,
} from "../lib/helm-types";
import { useShellConfig } from "../lib/shell-config";

const MAX_RECONNECT = 10;
const EDITOR_THROTTLE_MS = 80;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

let lastRAF = 0;

function getLSKey(brand: string): string {
  return `${brand}_helm_state`;
}

function saveState(brand: string, state: Record<string, any>) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadState(brand);
    const merged = { ...existing, ...state };
    localStorage.setItem(getLSKey(brand), JSON.stringify(merged));
  } catch {}
}

function loadState(brand: string): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(getLSKey(brand));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clearState(brand: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getLSKey(brand));
  } catch {}
}

function eventToEntry(event: HelmWSEvent): StreamEntry {
  const typeMap: Record<string, StreamEntryType> = {
    "helm.stage.enter": "stage",
    "helm.stage.exit": "stage",
    "helm.tool.start": "tool-call",
    "helm.tool.end": "tool-call",
    "helm.llm.start": "llm-call",
    "helm.llm.reasoning": "thinking",
    "helm.llm.stream": "llm-stream",
    "helm.llm.end": "llm-call",
    "helm.step.intermediate": "intermediate",
    "helm.draft.update": "draft-update",
    "helm.draft.file": "draft-file",
    "helm.review.ready": "review",
    "helm.review.submitted": "review",
    "helm.gate.verdict": "gate",
    "helm.task.completed": "system",
    "helm.task.error": "system",
  };

  const entryType = typeMap[event.type] || "system";
  const payload = { ...event.payload };

  if (event.type === "helm.stage.enter") {
    payload._is_start = true;
    payload._is_end = false;
  } else if (event.type === "helm.stage.exit") {
    payload._is_start = false;
    payload._is_end = true;
  }

  if (event.type === "helm.llm.start") {
    payload._is_start = true;
    payload._is_end = false;
  } else if (event.type === "helm.llm.end") {
    payload._is_start = false;
    payload._is_end = true;
  }

  return {
    id: `e-${event.seq}`,
    type: entryType,
    timestamp: Date.now(),
    _serverTs: event.timestamp,
    data: payload,
  } as StreamEntry;
}

export function useHelmWebSocket(opts?: HelmWSOptions) {
  const config = useShellConfig();
  const brand = config.brandName.toLowerCase();

  const WS_BASE =
    typeof window !== "undefined"
      ? config.wsBaseUrl || `ws://${window.location.hostname}:${window.location.port || "8002"}`
      : "ws://localhost:8002";

  const restored = typeof window !== "undefined" ? loadState(brand) : {};

  const [phase, setPhase] = useState<HelmTaskPhase>(restored.phase || "idle");
  const [taskId, setTaskId] = useState<string | null>(restored.taskId || null);
  const [entries, setEntries] = useState<StreamEntry[]>(restored.entries || []);
  const [draftContent, setDraftContent] = useState(restored.draftContent || "");
  const [editorContent, setEditorContent] = useState(restored.editorContent || "");
  const [stageProgress, setStageProgress] = useState(restored.stageProgress || { current: 0, total: 6 });
  const [tokenStats, setTokenStats] = useState(restored.tokenStats || { total: 0, cost: 0 });
  const [startTime, setStartTime] = useState<number | null>(restored.startTime || null);
  const [persona, setPersona] = useState(restored.persona || "");
  const [intent, setIntent] = useState(restored.intent || "");
  const [interactionMode, setInteractionMode] = useState<"normal" | "helm" | "auto">(restored.interactionMode || "helm");

  const wsRef = useRef<WebSocket | null>(null);
  const taskIdRef = useRef<string | null>(restored.taskId || null);
  const reconnectCount = useRef(0);
  const lastSeq = useRef(restored.entries?.length ? (restored.entries as StreamEntry[]).length - 1 : -1);
  const entriesRef = useRef<StreamEntry[]>(restored.entries || []);
  const editorContentRef = useRef(restored.editorContent || "");
  const draftBuffer = useRef(restored.draftContent || "");
  const draftRAF = useRef(0);
  const optionsRef = useRef(opts);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const currentWsIdRef = useRef(0);
  optionsRef.current = opts;

  const clearTaskTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startTaskTimeout = useCallback(() => {
    clearTaskTimeout();
    timeoutRef.current = setTimeout(() => {
      setPhase((prev) => {
        if (prev === "running" || prev === "connecting" || prev === "creating" || prev === "waiting_review" || prev === "paused") {
          saveState(brand, { phase: "interrupted" });
          optionsRef.current?.onError?.("timeout", "任务执行超时，已自动中断");
          return "interrupted";
        }
        return prev;
      });
    }, TASK_TIMEOUT_MS);
  }, [brand, clearTaskTimeout]);

  const flushDraft = useCallback(() => {
    if (draftBuffer.current !== editorContentRef.current) {
      const content = draftBuffer.current;
      editorContentRef.current = content;
      setEditorContent(content);
      setDraftContent(content);
      saveState(brand, { draftContent: content, editorContent: content });
      optionsRef.current?.onDraftUpdate?.(content, false);
    }
    draftRAF.current = 0;
  }, [brand]);

  const appendDraft = useCallback((delta: string, isPartial: boolean) => {
    draftBuffer.current += delta;
    const now = performance.now();
    if (draftRAF.current) {
      cancelAnimationFrame(draftRAF.current);
    }
    if (now - lastRAF > EDITOR_THROTTLE_MS || !isPartial) {
      lastRAF = now;
      flushDraft();
    } else {
      draftRAF.current = requestAnimationFrame(flushDraft);
    }
  }, [flushDraft]);

  const handleEvent = useCallback((event: HelmWSEvent) => {
    switch (event.type) {
      case "helm.stage.enter":
        setStageProgress((prev: { current: number; total: number }) => {
          const order = event.payload.order;
          const total = event.payload.total;
          const next = {
            current: order !== undefined ? order : prev.current + 1,
            total: total !== undefined ? total : prev.total,
          };
          saveState(brand, { stageProgress: next });
          return next;
        });
        optionsRef.current?.onStageEnter?.(event.payload.stage, event.payload.label, event.payload.order);
        break;
      case "helm.tool.start":
        optionsRef.current?.onToolCall?.("start", event.payload);
        break;
      case "helm.tool.end":
        optionsRef.current?.onToolCall?.("end", event.payload);
        break;
      case "helm.llm.reasoning":
        optionsRef.current?.onLLMReasoning?.(event.payload.agent_name, event.payload.delta_text);
        break;
      case "helm.llm.stream":
        optionsRef.current?.onLLMStream?.(event.payload.agent_name, event.payload.delta_text);
        break;
      case "helm.draft.update":
        if (event.payload.is_partial === false) {
          draftBuffer.current = event.payload.content || "";
          const content = draftBuffer.current;
          editorContentRef.current = content;
          setEditorContent(content);
          setDraftContent(content);
          saveState(brand, { draftContent: content, editorContent: content });
          optionsRef.current?.onDraftUpdate?.(content, false);
        } else {
          appendDraft(event.payload.content || "", true);
        }
        break;
      case "helm.review.ready":
        setPhase("waiting_review");
        saveState(brand, { phase: "waiting_review" });
        optionsRef.current?.onReviewReady?.(event.payload.draft_summary);
        break;
      case "helm.gate.verdict":
        optionsRef.current?.onGateVerdict?.(event.payload);
        break;
      case "helm.token.stats":
        setTokenStats({ total: event.payload.total_tokens, cost: event.payload.estimated_cost });
        saveState(brand, { tokenStats: { total: event.payload.total_tokens, cost: event.payload.estimated_cost } });
        optionsRef.current?.onTokenStats?.(event.payload.total_tokens, event.payload.estimated_cost);
        break;
      case "helm.task.completed":
        setPhase("completed");
        clearTaskTimeout();
        saveState(brand, { phase: "completed" });
        optionsRef.current?.onCompleted?.(event.payload);
        break;
      case "helm.task.error":
        setPhase("error");
        clearTaskTimeout();
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.(event.payload.step_name, event.payload.error_message);
        break;
      case "helm.task.paused":
        setPhase("paused");
        saveState(brand, { phase: "paused" });
        break;
      case "helm.task.resumed":
        setPhase("running");
        saveState(brand, { phase: "running" });
        break;
    }
  }, [appendDraft, brand, clearTaskTimeout]);

  const persistEntries = useCallback((newEntries: StreamEntry[]) => {
    saveState(brand, { entries: newEntries.slice(-500) });
  }, [brand]);

  const connectWS = useCallback((tid: string) => {
    intentionalDisconnectRef.current = false;
    const wsId = ++currentWsIdRef.current;
    setPhase("connecting");
    const ws = new WebSocket(`${WS_BASE}/ws/helm/${tid}`);

    ws.onopen = () => {
      if (currentWsIdRef.current !== wsId) {
        ws.close();
        return;
      }
      reconnectCount.current = 0;
      setPhase("running");
      saveState(brand, { phase: "running", taskId: tid });
      setStartTime(Date.now());
      saveState(brand, { startTime: Date.now() });
      startTaskTimeout();
      if (lastSeq.current > -1) {
        ws.send(JSON.stringify({ type: "replay", from_seq: lastSeq.current + 1 }));
      }
    };

    ws.onmessage = (event) => {
      if (currentWsIdRef.current !== wsId) return;
      const data: HelmWSEvent = JSON.parse(event.data);
      if ((data.type as string) === "pong" || (data.type as string) === "server_ping") return;
      lastSeq.current = data.seq;
      const entry = eventToEntry(data);
      entriesRef.current = [...entriesRef.current, entry];
      setEntries([...entriesRef.current]);
      persistEntries(entriesRef.current);
      handleEvent(data);
    };

    ws.onclose = () => {
      if (currentWsIdRef.current !== wsId) return;
      if (intentionalDisconnectRef.current) return;
      if (reconnectCount.current < MAX_RECONNECT) {
        const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), 30000);
        reconnectCount.current++;
        setTimeout(() => {
          if (!intentionalDisconnectRef.current && currentWsIdRef.current === wsId) {
            connectWS(tid);
          }
        }, delay);
      } else {
        const tid = taskIdRef.current;
        if (tid) {
          let pollCount = 0;
          const pollInterval = setInterval(async () => {
            pollCount++;
            if (pollCount > 6) { clearInterval(pollInterval); return; }
            try {
              const r = await fetch(`/api/v1/tasks/${tid}`);
              if (r.ok) {
                const data = await r.json();
                const status = data?.data?.status;
                if (status === "completed" || status === "success") {
                  setPhase("completed");
                  clearTaskTimeout();
                  clearInterval(pollInterval);
                } else if (status === "failed" || status === "error") {
                  setPhase("error");
                  clearTaskTimeout();
                  clearInterval(pollInterval);
                }
              }
            } catch { }
          }, 5000);
        }
        setPhase("error");
        clearTaskTimeout();
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.("websocket", "连接丢失，请刷新页面");
      }
    };

    wsRef.current = ws;
  }, [WS_BASE, handleEvent, persistEntries, brand, startTaskTimeout, clearTaskTimeout]);

  const disconnectWS = useCallback(() => {
    intentionalDisconnectRef.current = true;
    currentWsIdRef.current++;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectCount.current = 0;
    clearTaskTimeout();
  }, [clearTaskTimeout]);

  useEffect(() => {
    return () => disconnectWS();
  }, [disconnectWS]);

  useEffect(() => {
    const saved = loadState(brand);
    if (saved.phase && saved.startTime) {
      const savedPhase = saved.phase as HelmTaskPhase;
      if (savedPhase === "running" || savedPhase === "connecting" || savedPhase === "creating" || savedPhase === "waiting_review" || savedPhase === "paused") {
        const elapsed = Date.now() - (saved.startTime as number);
        if (elapsed > TASK_TIMEOUT_MS) {
          setPhase("interrupted");
          saveState(brand, { phase: "interrupted" });
        }
      }
    }
  }, [brand]);

  const createTask = useCallback(async (taskIntent: string, extra?: Record<string, any>) => {
    setPhase("creating");
    setPersona(extra?.persona || "");
    setIntent(taskIntent);
    entriesRef.current = [];
    setEntries([]);
    draftBuffer.current = "";
    editorContentRef.current = "";
    setEditorContent("");
    setDraftContent("");
    setTokenStats({ total: 0, cost: 0 });
    lastSeq.current = -1;
    clearState(brand);
    saveState(brand, { intent: taskIntent, ...extra });

    try {
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: taskIntent, mode: "helm", interaction_mode: interactionMode, ...extra }),
      });
      const data = await r.json();
      if (!r.ok) {
        setPhase("error");
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.("create", data.detail || "创建失败");
        return;
      }
      const tid = data?.data?.task_id || data?.task_id || data?.id;
      if (!tid) {
        setPhase("error");
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.("create", "未获取到 task_id");
        return;
      }
      setTaskId(tid);
      taskIdRef.current = tid;
      saveState(brand, { taskId: tid });
      connectWS(tid);
    } catch (e: unknown) {
      setPhase("error");
      saveState(brand, { phase: "error" });
      optionsRef.current?.onError?.("create", e instanceof Error ? e.message : String(e));
    }
  }, [connectWS, brand, interactionMode]);

  const continueChat = useCallback(async (taskIntent: string, extra?: Record<string, any>) => {
    const existingTaskId = taskId;
    if (!existingTaskId) return;

    // Disconnect old WebSocket first to avoid duplicate events
    disconnectWS();

    setPhase("creating");
    setIntent(taskIntent);
    // Keep existing entries for conversation history continuity
    draftBuffer.current = "";
    setEditorContent("");
    editorContentRef.current = "";
    setDraftContent("");
    saveState(brand, { intent: taskIntent, phase: "creating", ...extra });

    // Save the new user message to the existing workspace
    try {
      await fetch(`/api/v1/workspace/${existingTaskId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: taskIntent, model: extra?.model }),
      });
    } catch {
      // Non-fatal: the task creation endpoint also saves the message
    }

    try {
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: taskIntent,
          mode: "helm",
          task_id: existingTaskId,
          interaction_mode: interactionMode,
          ...extra,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setPhase("error");
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.("continue", data.detail || "继续对话失败");
        return;
      }
      saveState(brand, { taskId: existingTaskId, phase: "creating", intent: taskIntent });
      connectWS(existingTaskId);
    } catch (e: unknown) {
      setPhase("error");
      saveState(brand, { phase: "error" });
      optionsRef.current?.onError?.("continue", e instanceof Error ? e.message : String(e));
    }
  }, [taskId, connectWS, brand, interactionMode]);

  const resetState = useCallback(() => {
    disconnectWS();
    clearState(brand);
    setPhase("idle");
    setTaskId(null);
    taskIdRef.current = null;
    setEntries([]);
    entriesRef.current = [];
    setDraftContent("");
    setEditorContent("");
    editorContentRef.current = "";
    draftBuffer.current = "";
    setStageProgress({ current: 0, total: 6 });
    setTokenStats({ total: 0, cost: 0 });
    setStartTime(null);
    setPersona("");
    setIntent("");
    setInteractionMode("helm");
    lastSeq.current = -1;
  }, [brand, disconnectWS]);

  const restoreTask = useCallback((tid: string, taskIntent: string, taskPersona: string, taskPhase: HelmTaskPhase) => {
    disconnectWS();
    setPhase(taskPhase);
    setTaskId(tid);
    taskIdRef.current = tid;
    setIntent(taskIntent);
    setPersona(taskPersona);
    entriesRef.current = [];
    setEntries([]);
    draftBuffer.current = "";
    editorContentRef.current = "";
    setEditorContent("");
    setDraftContent("");
    setTokenStats({ total: 0, cost: 0 });
    lastSeq.current = -1;
    saveState(brand, { taskId: tid, intent: taskIntent, persona: taskPersona, phase: taskPhase, entries: [], startTime: null });
    if (taskPhase === "running" || taskPhase === "creating" || taskPhase === "connecting" || taskPhase === "waiting_review" || taskPhase === "paused") {
      connectWS(tid);
    }
  }, [brand, connectWS, disconnectWS]);

  const pause = useCallback(() => {
    if (taskId) fetch(`/api/v1/tasks/${taskId}/pause`, { method: "POST" });
  }, [taskId]);

  const resume = useCallback(() => {
    if (taskId) fetch(`/api/v1/tasks/${taskId}/resume`, { method: "POST" });
  }, [taskId]);

  const skipCurrent = useCallback(() => {
    if (taskId) fetch(`/api/v1/tasks/${taskId}/skip`, { method: "POST" });
  }, [taskId]);

  const submitReview = useCallback(async (verdict: "pass" | "reject", feedback: string) => {
    if (!taskId) return;
    const r = await fetch(`/api/v1/tasks/${taskId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, feedback }),
    });
    return r.json();
  }, [taskId]);

  const updateEditor = useCallback((content: string) => {
    editorContentRef.current = content;
    setEditorContent(content);
  }, []);

  return {
    phase, taskId, entries, draftContent, editorContent,
    stageProgress, tokenStats, startTime, persona, intent,
    interactionMode, setInteractionMode,
    createTask, continueChat, resetState, restoreTask, updateEditor,
    pause, resume, skipCurrent, submitReview,
    connectWS, disconnectWS,
  };
}
