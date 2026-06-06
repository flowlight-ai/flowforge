"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSoloWebSocket } from "../../hooks/useSoloWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import { ChatMessage, DynNode, DynEdge } from "./solo-types";
import {
  entryToChatMessages,
  mergeStreamingMessages,
  appendTaskHistory,
  COMMANDS,
} from "./solo-utils";
import DynamicGraph from "./DynamicGraph";
import StaticGraphModal from "./StaticGraphModal";
import WorkspacePanel from "./WorkspacePanel";
import { ResizeHandle } from "./ChatPrimitives";
import TaskListPanel from "./TaskListPanel";
import ChatStream from "./ChatStream";
import ChatInput from "./ChatInput";
import MarkdownPanel, { OpenTab } from "./MarkdownPanel";

function getModeSteps(mode: string): { key: string; label: string }[] {
  const m = mode.toLowerCase().replace(/[_-]/g, "_");
  if (m === "react") return [{ key: "thought", label: "Thought" }, { key: "action", label: "Action" }, { key: "observation", label: "Observation" }];
  if (m === "plan_execute") return [{ key: "planner", label: "Planner" }, { key: "executor", label: "Executor" }];
  if (m === "plan_execute_critic") return [{ key: "planner", label: "Planner" }, { key: "executor", label: "Executor" }, { key: "critic", label: "Critic" }];
  if (m === "reflexion") return [{ key: "action", label: "Action" }, { key: "observation", label: "Observation" }, { key: "reflect", label: "Reflect" }];
  if (m === "self_refine") return [{ key: "draft", label: "Draft" }, { key: "critic", label: "Critic" }, { key: "refine", label: "Refine" }];
  if (m === "workflow" || m === "pipeline" || m === "chain") return [{ key: "execute", label: "Execute" }];
  return [{ key: "execute", label: "Execute" }];
}

export default function SoloLayout() {
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [graphModal, setGraphModal] = useState<{type: "workflow" | "agent" | "mode"; name: string} | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [chatPanelWidth, setChatPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [resumePrompt, setResumePrompt] = useState<{ task_id: string; intent: string } | null>(null);

  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [highlightFilePath, setHighlightFilePath] = useState<string | null>(null);

  const [workspaceList, setWorkspaceList] = useState<{name: string; display_name: string; path: string; task_count: number; created_at: string}[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState("default");
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const panelMenuRef = useRef<HTMLDivElement>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showNewWorkspaceInput, setShowNewWorkspaceInput] = useState(false);
  const [showSettingsInEditor, setShowSettingsInEditor] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [dirBrowserItems, setDirBrowserItems] = useState<{name: string; path: string; is_dir: boolean}[]>([]);
  const [dirBrowserPath, setDirBrowserPath] = useState("");

  /* ── Panel visibility + responsive ── */
  const [panelVisibility, setPanelVisibility] = useState({ chat: true, editor: true, explorer: true });
  const prevPanelVisibility = useRef(panelVisibility);

  // Responsive: auto-hide panels on narrow screens
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 900px)");
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setPanelVisibility((prev) => {
          const next = { ...prev, editor: false, explorer: false };
          prevPanelVisibility.current = prev;
          return next;
        });
      } else {
        setPanelVisibility((prev) => {
          const saved = prevPanelVisibility.current;
          return { ...prev, editor: saved.editor, explorer: saved.explorer };
        });
      }
    };
    handleResize(mql);
    mql.addEventListener("change", handleResize);
    return () => mql.removeEventListener("change", handleResize);
  }, []);

  const handleTogglePanel = useCallback((panel: "chat" | "editor" | "explorer") => {
    setPanelVisibility((prev) => {
      const next = { ...prev, [panel]: !prev[panel] };
      prevPanelVisibility.current = next;
      // Ensure at least one panel is visible
      if (!next.chat && !next.editor && !next.explorer) {
        next.chat = true;
      }
      return next;
    });
  }, []);

  const config = useShellConfig();

  const fetchWorkspaceList = useCallback(() => {
    fetch("/api/v1/workspace/named")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const workspaces = (data?.workspaces || []) as {name: string; display_name: string; path: string; task_count: number; created_at: string}[];
        workspaces.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        setWorkspaceList(workspaces);
        // If current workspace doesn't exist in the list, switch to default
        if (workspaces.length > 0 && !workspaces.find((w) => w.name === currentWorkspace)) {
          setCurrentWorkspace("default");
        }
      })
      .catch(() => {
        setWorkspaceList([]);
      });
  }, [currentWorkspace]);

  useEffect(() => {
    fetchWorkspaceList();
    const interval = setInterval(fetchWorkspaceList, 60_000);
    return () => clearInterval(interval);
  }, [fetchWorkspaceList]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setWsDropdownOpen(false);
      }
      if (panelMenuRef.current && !panelMenuRef.current.contains(e.target as Node)) {
        setPanelMenuOpen(false);
      }
    };
    if (wsDropdownOpen || panelMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wsDropdownOpen, panelMenuOpen]);

  useEffect(() => {
    fetch("/api/v1/workspace/incomplete")
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((data) => {
        const tasks = data.tasks || [];
        if (tasks.length > 0) {
          const t = tasks[0];
          setResumePrompt({ task_id: t.task_id, intent: t.intent || t.task_id });
        }
      })
      .catch(() => {});
  }, []);

  const solo = useSoloWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) solo.updateEditor(content);
    },
  });

  useEffect(() => {
    if (solo.phase === "completed" || solo.phase === "error" || solo.phase === "interrupted") {
      fetchWorkspaceList();
    }
  }, [solo.phase, fetchWorkspaceList]);

  const elapsed = useMemo(() => {
    if (!solo.startTime) return 0;
    return Math.floor((Date.now() - solo.startTime) / 1000);
  }, [solo.startTime, solo.phase]);

  useEffect(() => {
    if (solo.taskId && solo.phase !== "idle" && solo.phase !== "creating" && solo.phase !== "connecting") {
      const brand = config.brandName.toLowerCase();
      appendTaskHistory(brand, { taskId: solo.taskId, persona: solo.persona, intent: solo.intent, phase: solo.phase, timestamp: Date.now() });
    }
    if (solo.phase === "completed" || solo.phase === "error" || solo.phase === "interrupted") {
      setRefreshCounter((c) => c + 1);
    }
  }, [solo.taskId, solo.phase, config.brandName]);

  useEffect(() => {
    if (solo.taskId && solo.phase === "completed") {
      fetch(`/api/v1/workspace/${solo.taskId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }).catch(() => {});
    }
  }, [solo.taskId, solo.phase]);

  const chatMessages = useMemo(() => {
    const msgs: ChatMessage[] = [];
    for (const entry of solo.entries) msgs.push(...entryToChatMessages(entry));
    for (const um of userMessages) msgs.push(um);
    msgs.sort((a, b) => {
      const ta = typeof a.timestamp === "number" ? a.timestamp : new Date(a.timestamp as string).getTime();
      const tb = typeof b.timestamp === "number" ? b.timestamp : new Date(b.timestamp as string).getTime();
      return ta - tb;
    });
    return mergeStreamingMessages(msgs);
  }, [solo.entries, userMessages]);

  const { dynNodes, dynEdges, currentDynStep } = useMemo(() => {
    const nodes: DynNode[] = [];
    const edges: DynEdge[] = [];
    let currentStep: string | undefined;

    let currentAgentNodeId: string | undefined;
    const agentNodeIds: string[] = [];
    const modeStepCounters: Record<string, number> = {};
    const toolStartTimes: Record<string, number> = {};
    const agentStartTimes: Record<string, number> = {};
    const modeStepStartTimes: Record<string, number> = {};

    if (solo.entries.length > 0) {
      const workflowId = "workflow-root";
      const intentLabel = solo.intent || "任务执行";
      nodes.push({
        id: workflowId,
        label: intentLabel.length > 24 ? intentLabel.slice(0, 24) + "…" : intentLabel,
        status: solo.phase === "completed" ? "completed" : solo.phase === "error" ? "error" : "running",
        type: "workflow",
      });
    }

    for (const entry of solo.entries) {
      if (entry.type === "stage") {
        const stepName = entry.data?.step || entry.data?.stage || entry.data?.label;
        const agentName = entry.data?.agent_name || entry.data?.agent;
        const mode = entry.data?.mode;
        const isExit = entry.data?.order === undefined || entry.data?.order === null;
        const isHuman = entry.data?.human === true;

        if (isHuman) {
          const reviewId = `review-${nodes.length}`;
          nodes.push({
            id: reviewId,
            label: stepName || "审核节点",
            status: solo.phase === "waiting_review" ? "running" : isExit ? "completed" : "running",
            type: "review",
            agent: agentName,
            parentId: "workflow-root",
          });
          if (currentAgentNodeId) edges.push({ from: currentAgentNodeId, to: reviewId });
          currentAgentNodeId = reviewId;
          agentNodeIds.push(reviewId);
          continue;
        }

        if (isExit && currentAgentNodeId) {
          const existing = nodes.find((n) => n.id === currentAgentNodeId);
          if (existing && existing.status === "running") {
            existing.status = "completed";
            if (agentStartTimes[currentAgentNodeId]) {
              existing.durationMs = Date.now() - agentStartTimes[currentAgentNodeId];
            }
            if (entry.data?.summary) existing.summary = entry.data.summary;
            else if (entry.data?.result) {
              const r = typeof entry.data.result === "string" ? entry.data.result : JSON.stringify(entry.data.result);
              existing.summary = r.length > 60 ? r.slice(0, 60) + "…" : r;
            }
          }
          currentAgentNodeId = undefined;
          continue;
        }

        if (!isExit && stepName) {
          const agentId = `agent-${agentName || stepName}-${nodes.length}`;
          const label = agentName
            ? agentName.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : stepName;
          const status: "pending" | "running" | "completed" | "error" = "running";
          if (!currentStep) currentStep = agentId;

          nodes.push({
            id: agentId,
            label,
            status,
            type: "agent",
            agent: agentName,
            mode,
            parentId: "workflow-root",
          });
          agentStartTimes[agentId] = Date.now();

          if (agentNodeIds.length > 0) {
            edges.push({ from: agentNodeIds[agentNodeIds.length - 1], to: agentId });
          } else {
            edges.push({ from: "workflow-root", to: agentId });
          }

          currentAgentNodeId = agentId;
          agentNodeIds.push(agentId);

          if (mode) {
            const modeSteps = getModeSteps(mode);
            for (const ms of modeSteps) {
              const stepId = `${agentId}-${ms.key}-${nodes.length}`;
              modeStepCounters[ms.key] = (modeStepCounters[ms.key] || 0) + 1;
              nodes.push({
                id: stepId,
                label: ms.label,
                status: "pending",
                type: "mode_step",
                agent: agentName,
                mode,
                iteration: modeStepCounters[ms.key],
                parentId: agentId,
              });
              modeStepStartTimes[stepId] = Date.now();
            }
          }
        }
      }

      if (entry.type === "tool-call") {
        const toolName = entry.data?.tool_name || entry.data?.tool || "tool";
        const isEnd = entry.data?.result !== undefined || entry.data?.error !== undefined;
        const toolId = entry.data?.call_id || `tool-${nodes.length}`;

        if (!isEnd) {
          const existingTool = nodes.find((n) => n.id === toolId);
          if (!existingTool) {
            nodes.push({
              id: toolId,
              label: toolName,
              status: "running",
              type: "tool",
              agent: entry.data?.agent_name,
              parentId: currentAgentNodeId || "workflow-root",
            });
            toolStartTimes[toolId] = Date.now();
            if (!currentStep) currentStep = toolId;
          }
        } else {
          const existingTool = nodes.find((n) => n.id === toolId);
          if (existingTool) {
            existingTool.status = entry.data?.error ? "error" : "completed";
            if (toolStartTimes[toolId]) {
              existingTool.durationMs = Date.now() - toolStartTimes[toolId];
            }
            const resultData = entry.data?.result;
            if (resultData) {
              const r = typeof resultData === "string" ? resultData : JSON.stringify(resultData);
              existingTool.summary = r.length > 50 ? r.slice(0, 50) + "…" : r;
            }
            if (entry.data?.error) {
              existingTool.summary = entry.data.error;
            }
          }

          if (currentAgentNodeId) {
            const modeStepNodes = nodes.filter(
              (n) => n.parentId === currentAgentNodeId && n.type === "mode_step" && n.status === "pending"
            );
            if (modeStepNodes.length > 0) {
              const nextStep = modeStepNodes[0];
              nextStep.status = "running";
              if (!currentStep) currentStep = nextStep.id;
            }
          }
        }
      }

      if (entry.type === "review") {
        const reviewId = `review-${nodes.length}`;
        nodes.push({
          id: reviewId,
          label: entry.data?.draft_summary ? "审核: " + (entry.data.draft_summary as string).slice(0, 30) : "审核节点",
          status: solo.phase === "waiting_review" ? "running" : "completed",
          type: "review",
          summary: entry.data?.draft_summary,
          parentId: "workflow-root",
        });
        if (currentAgentNodeId) edges.push({ from: currentAgentNodeId, to: reviewId });
      }

      if (entry.type === "thinking" || entry.type === "llm-stream") {
        if (currentAgentNodeId) {
          const modeStepNodes = nodes.filter(
            (n) => n.parentId === currentAgentNodeId && n.type === "mode_step" && n.status === "pending"
          );
          if (modeStepNodes.length > 0) {
            const stepLabel = entry.type === "thinking" ? "thought" : "";
            let targetStep = stepLabel
              ? modeStepNodes.find((n) => n.label.toLowerCase().includes(stepLabel))
              : null;
            if (!targetStep) targetStep = modeStepNodes[0];
            targetStep.status = "running";
            if (!currentStep) currentStep = targetStep.id;
            const deltaText = entry.data?.delta_text || "";
            if (deltaText && targetStep.summary) {
              targetStep.summary = (targetStep.summary + deltaText).slice(-120);
            } else if (deltaText) {
              targetStep.summary = deltaText.slice(0, 120);
            }
          }
        }
      }

      if (entry.type === "intermediate") {
        const stepName = entry.data?.step_name;
        if (stepName && currentAgentNodeId) {
          const stepId = `intermediate-${nodes.length}`;
          nodes.push({
            id: stepId,
            label: stepName,
            status: "completed",
            type: "mode_step",
            agent: entry.data?.agent_name,
            parentId: currentAgentNodeId,
            summary: entry.data?.summary,
          });
        }
      }

      if (entry.type === "draft-update" && currentAgentNodeId) {
        const existing = nodes.find((n) => n.id === currentAgentNodeId);
        if (existing && entry.data?.content) {
          const content = entry.data.content;
          existing.summary = content.length > 120 ? content.slice(0, 120) + "…" : content;
        }
      }
    }

    if (solo.phase === "completed" || solo.phase === "error" || solo.phase === "rejected" || solo.phase === "interrupted") {
      for (const n of nodes) {
        if (n.status === "running" || n.status === "pending") {
          n.status = solo.phase === "error" || solo.phase === "rejected" || solo.phase === "interrupted" ? "error" : "completed";
        }
      }
      currentStep = undefined;
    }

    return { dynNodes: nodes, dynEdges: edges, currentDynStep: currentStep };
  }, [solo.entries, solo.phase, solo.intent]);

  const handleChatSubmit = useCallback(
    (text: string, persona?: string, model?: string) => {
      const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text, timestamp: Date.now() };
      setUserMessages((prev) => [...prev, userMsg]);

      if (solo.taskId) {
        const brand = config.brandName.toLowerCase();
        appendTaskHistory(brand, { taskId: solo.taskId, persona: solo.persona || persona || "default", intent: solo.intent || text, phase: solo.phase, timestamp: Date.now() }, true);
      }

      const effectiveModel = model || (selectedModel === "auto" ? undefined : selectedModel);
      if (solo.phase === "idle") {
        solo.createTask(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (solo.phase === "completed" && solo.taskId) {
        solo.continueChat(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (solo.phase === "error" || solo.phase === "rejected" || solo.phase === "interrupted") {
        solo.createTask(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (solo.taskId) {
        fetch(`/api/v1/workspace/${solo.taskId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text, model: effectiveModel }),
        }).catch(() => {});
      }
    },
    [solo, config.brandName, selectedModel]
  );

  const handleReview = useCallback((verdict: "pass" | "reject", feedback: string) => { solo.submitReview(verdict, feedback); }, [solo]);
  const handleApprovalAction = useCallback((messageId: string, approved: boolean, feedback: string) => {
    if (messageId === "review-inline") solo.submitReview(approved ? "pass" : "reject", feedback);
  }, [solo]);

  const handleCommand = useCallback((cmd: string) => {
    switch (cmd) {
      case "/pause": solo.pause(); break;
      case "/resume": solo.resume(); break;
      case "/skip": solo.skipCurrent(); break;
      case "/reset": solo.resetState(); setUserMessages([]); break;
      case "/review": if (solo.taskId) solo.submitReview("pass", "通过 /review 命令强制审核"); break;
      case "/help": {
        const helpMsg: ChatMessage = { id: `system-help-${Date.now()}`, role: "system", content: `可用命令: ${COMMANDS.map((c) => c.cmd).join(", ")}`, timestamp: Date.now() };
        setUserMessages((prev) => [...prev, helpMsg]);
        break;
      }
      default: {
        const userMsg: ChatMessage = { id: `user-cmd-${Date.now()}`, role: "user", content: `${cmd} 切换模式`, timestamp: Date.now() };
        setUserMessages((prev) => [...prev, userMsg]);
      }
    }
  }, [solo]);

  const handleFileOpen = useCallback((filePath: string, fileName: string) => {
    // Auto-show editor panel when opening a file
    if (!panelVisibility.editor) {
      setPanelVisibility((prev) => {
        const next = { ...prev, editor: true };
        prevPanelVisibility.current = next;
        return next;
      });
    }

    const tabId = `tab-${filePath}`;
    const existingTab = openTabs.find((t) => t.id === tabId);

    // Derive relative path within workspace for explorer highlighting
    const apiPrefix = `/api/v1/workspace/${solo.taskId}/files/`;
    const relativePath = filePath.startsWith(apiPrefix) ? filePath.slice(apiPrefix.length) : fileName;

    if (existingTab) {
      setActiveTabId(tabId);
      setHighlightFilePath(relativePath);
      return;
    }

    const newTab: OpenTab = {
      id: tabId,
      filePath,
      fileName: fileName || filePath.split(/[/\\]/).pop() || "未命名",
      content: "",
      originalContent: "",
      isDirty: false,
    };

    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setHighlightFilePath(relativePath);

    if (filePath.startsWith("/api/")) {
      fetch(filePath)
        .then((r) => (r.ok ? r.text() : ""))
        .then((content) => {
          if (content) {
            try {
              const data = JSON.parse(content);
              if (data.content !== undefined) {
                const fileContent = typeof data.content === "string" ? data.content : JSON.stringify(data.content, null, 2);
                setOpenTabs((prev) =>
                  prev.map((t) => t.id === tabId ? { ...t, content: fileContent, originalContent: fileContent } : t)
                );
                return;
              }
            } catch {}
            setOpenTabs((prev) =>
              prev.map((t) => t.id === tabId ? { ...t, content, originalContent: content } : t)
            );
          }
        })
        .catch(() => {});
    } else {
      const draftContent = solo.editorContent;
      if (draftContent) {
        setOpenTabs((prev) =>
          prev.map((t) => t.id === tabId ? { ...t, content: draftContent, originalContent: draftContent } : t)
        );
      }
    }
  }, [openTabs, solo.editorContent]);

  const handleTabClose = useCallback((tabId: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId((prev) => {
        const remaining = openTabs.filter((t) => t.id !== tabId);
        if (remaining.length > 0) {
          const closedIdx = openTabs.findIndex((t) => t.id === tabId);
          const nextIdx = Math.min(closedIdx, remaining.length - 1);
          return remaining[nextIdx].id;
        }
        return null;
      });
    }
  }, [activeTabId, openTabs]);

  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    const tab = openTabs.find((t) => t.id === tabId);
    if (tab) {
      setHighlightFilePath(tab.fileName);
    }
  }, [openTabs]);

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return { ...t, content, isDirty: content !== t.originalContent };
      })
    );
  }, []);

  const handleWorkspaceFileOpen = useCallback((filePath: string, fileName: string) => {
    handleFileOpen(filePath, fileName);
    // Auto-show explorer panel when opening from explorer
    if (!panelVisibility.explorer) {
      setPanelVisibility((prev) => {
        const next = { ...prev, explorer: true };
        prevPanelVisibility.current = next;
        return next;
      });
    }
    const apiPrefix = `/api/v1/workspace/${solo.taskId}/files/`;
    const relativePath = filePath.startsWith(apiPrefix) ? filePath.slice(apiPrefix.length) : fileName;
    setHighlightFilePath(relativePath);
  }, [handleFileOpen, solo.taskId, panelVisibility.explorer]);

  const handleSettingsClick = useCallback(() => {
    setPanelMenuOpen(false);
    setShowSettingsInEditor(true);
    setPanelVisibility(prev => {
      const next = { ...prev, editor: true };
      prevPanelVisibility.current = next;
      return next;
    });
  }, []);

  const currentWorkspaceName = currentWorkspace;

  return (
    <div className="solo-shell-v2">
      {/* Leftmost column: Task List */}
      <div className="solo-tasklist-column">
        <TaskListPanel
          phase={solo.phase} intent={solo.intent} taskId={solo.taskId} elapsed={elapsed}
          workspaceName={currentWorkspace}
          onNewTask={() => { solo.resetState(); setUserMessages([]); }}
          onRestoreChat={(msgs) => { setUserMessages(msgs); }}
          onSwitchTask={(tid, taskIntent, taskPersona, taskPhase) => {
            setUserMessages([]);
            solo.restoreTask(tid, taskIntent, taskPersona, taskPhase);
          }}
          refreshTrigger={refreshCounter}
          workspaceRefreshKey={workspaceRefreshKey}
        />
      </div>

      {panelVisibility.chat && (
        <>
          <div className="solo-chat-panel" style={{ width: chatPanelWidth, minWidth: 200, maxWidth: 400 }}>
            <div className="solo-workspace-selector" ref={wsDropdownRef}>
              <button
                className="solo-ws-trigger"
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
              >
                <span className="solo-ws-trigger-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span className="solo-ws-trigger-name">
                  {currentWorkspaceName || `${config.brandName} Solo`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`solo-ws-chevron${wsDropdownOpen ? " open" : ""}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {wsDropdownOpen && (
                <div className="solo-ws-dropdown">
                  <div className="solo-ws-dropdown-header">
                    <span>工作区</span>
                    <button
                      className="solo-ws-new-btn"
                      onClick={() => setShowNewWorkspaceInput(!showNewWorkspaceInput)}
                      title="新建工作区"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </div>
                  {showNewWorkspaceInput && (
                    <div className="solo-ws-new-input-row">
                      <input
                        className="solo-ws-new-input"
                        value={newWorkspaceName}
                        onChange={(e) => setNewWorkspaceName(e.target.value)}
                        placeholder="名称或完整路径（如 D:\myproject）"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newWorkspaceName.trim()) {
                            const input = newWorkspaceName.trim();
                            const isFullPath = /^[A-Za-z]:\\/.test(input) || input.startsWith("/") || input.includes("\\");
                            const body = isFullPath
                              ? { name: input.split(/[/\\]/).filter(Boolean).pop() || input, path: input }
                              : { name: input };
                            fetch("/api/v1/workspace/named", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(body),
                            }).then(() => {
                              setCurrentWorkspace(body.name);
                              setNewWorkspaceName("");
                              setShowNewWorkspaceInput(false);
                              fetchWorkspaceList();
                              solo.resetState();
                              setUserMessages([]);
                              setOpenTabs([]);
                              setActiveTabId(null);
                            });
                          }
                          if (e.key === "Escape") {
                            setShowNewWorkspaceInput(false);
                            setNewWorkspaceName("");
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="solo-ws-browse-btn"
                        onClick={() => {
                          // Open directory browser with root listing
                          fetch("/api/v1/system/browse-directory", { method: "POST" })
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                              const roots = data?.roots || [];
                              setDirBrowserItems(roots);
                              setDirBrowserPath("");
                              setShowDirBrowser(true);
                            })
                            .catch(() => {});
                        }}
                        title="浏览本地目录"
                      >
                        📂
                      </button>
                    </div>
                  )}
                  <div className="solo-ws-dropdown-list">
                    {workspaceList.length === 0 ? (
                      <div className="solo-ws-empty">暂无工作区</div>
                    ) : (
                      workspaceList.map((ws) => (
                        <div
                          key={ws.name}
                          className={`solo-ws-item${ws.name === currentWorkspace ? " active" : ""}`}
                          onClick={() => {
                            setCurrentWorkspace(ws.name);
                            setWsDropdownOpen(false);
                            // Reset all panels when switching workspace
                            solo.resetState();
                            setUserMessages([]);
                            setOpenTabs([]);
                            setActiveTabId(null);
                            // 加载新工作区的最新任务上下文
                            fetch(`/api/v1/workspace/named/${ws.name}/tasks`)
                              .then(r => r.ok ? r.json() : null)
                              .then(data => {
                                const tasks = data?.tasks || [];
                                if (tasks.length > 0) {
                                  const latest = tasks.sort((a: any, b: any) =>
                                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                                  )[0];
                                  solo.restoreTask(latest.task_id, latest.intent || latest.task_id, latest.persona || 'default', 'completed');
                                }
                              })
                              .catch(() => {});
                            fetchWorkspaceList();
                            setRefreshCounter(c => c + 1);
                            setWorkspaceRefreshKey(k => k + 1);
                          }}
                        >
                          <span className="solo-ws-item-status">
                            <span className="ws-status-dot" />
                          </span>
                          <span className="solo-ws-item-name">
                            <span className="solo-ws-item-wsname">{ws.display_name || ws.name}</span>
                            <span className="solo-ws-item-path">{ws.path}</span>
                          </span>
                          <span className="solo-ws-item-task-count">{ws.task_count || 0}</span>
                          <button
                            className="solo-ws-item-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (ws.name === "default") return;
                              fetch(`/api/v1/workspace/named/${ws.name}`, { method: "DELETE" }).then(() => {
                                fetchWorkspaceList();
                                if (ws.name === currentWorkspace) {
                                  setCurrentWorkspace("default");
                                  solo.resetState();
                                  setUserMessages([]);
                                  setOpenTabs([]);
                                  setActiveTabId(null);
                                }
                              });
                            }}
                            title="删除工作区"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <>
              <ChatStream messages={chatMessages} phase={solo.phase} onApprovalAction={handleApprovalAction} stageProgress={solo.stageProgress} interactionMode={solo.interactionMode} dynNodes={dynNodes} dynEdges={dynEdges} currentStep={currentDynStep} onFileOpen={handleFileOpen} onRetry={() => { if (solo.intent) solo.createTask(solo.intent, { persona: solo.persona || "default" }); }} onRefresh={() => { if (solo.taskId) { fetch(`/api/v1/tasks/${solo.taskId}`).then(r => r.json()).then(d => { if (d?.data?.status === "completed") solo.restoreTask(solo.taskId!, solo.intent || "", solo.persona || "default", "completed"); }).catch(() => {}); } }} onClear={() => { setUserMessages([]); solo.resetState(); }} taskId={solo.taskId} />
              {resumePrompt && solo.phase === "idle" && (
                <div className="px-4 py-3 bg-amber-900/30 border-t border-amber-700/50 flex items-center gap-3">
                  <span className="text-amber-300 text-xs">⏸ 发现未完成的任务: {resumePrompt.intent.slice(0, 40)}</span>
                  <button
                    onClick={() => {
                      solo.restoreTask(resumePrompt.task_id, resumePrompt.intent, "default", "running");
                      setResumePrompt(null);
                    }}
                    className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-500"
                  >
                    继续执行
                  </button>
                  <button
                    onClick={() => setResumePrompt(null)}
                    className="text-xs px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
                  >
                    忽略
                  </button>
                </div>
              )}
              <ChatInput phase={solo.phase} onSubmit={handleChatSubmit} onReview={handleReview} onCommand={handleCommand} onStop={solo.resetState} interactionMode={solo.interactionMode} onInteractionModeChange={solo.setInteractionMode} selectedModel={selectedModel} onModelChange={setSelectedModel} selectedWorkflow={null} onWorkflowChange={() => {}} />
            </>
          </div>
          <ResizeHandle onResize={(dx) => setChatPanelWidth((w) => Math.max(200, Math.min(400, w + dx)))} />
        </>
      )}
      <div className={`solo-editor-panel${!panelVisibility.editor ? " collapsed" : ""}`}>
        <MarkdownPanel
          tabs={openTabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          phase={solo.phase}
          showSettings={showSettingsInEditor}
          onCloseSettings={() => setShowSettingsInEditor(false)}
          panelVisibility={panelVisibility}
          onTogglePanel={handleTogglePanel}
          onOpenSettings={handleSettingsClick}
          collapsed={!panelVisibility.editor}
        />
      </div>
      {panelVisibility.explorer && (
        <>
          <ResizeHandle onResize={(dx) => setRightPanelWidth((w) => Math.max(180, Math.min(400, w - dx)))} />
          <div className="solo-explorer-panel" style={{ width: rightPanelWidth, minWidth: 180, maxWidth: 400 }}>
            <WorkspacePanel
              taskId={solo.taskId}
              workspaceName={currentWorkspace}
              onFileOpen={handleWorkspaceFileOpen}
              highlightFilePath={highlightFilePath}
            />
          </div>
        </>
      )}
      {graphModal && (
        <StaticGraphModal type={graphModal.type} name={graphModal.name} onClose={() => setGraphModal(null)} />
      )}
      {/* Directory Browser Modal */}
      {showDirBrowser && (
        <div className="dir-browser-overlay" onClick={() => setShowDirBrowser(false)}>
          <div className="dir-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dir-browser-header">
              <span>选择工作区目录</span>
              <button className="dir-browser-close" onClick={() => setShowDirBrowser(false)}>✕</button>
            </div>
            <div className="dir-browser-path">
              <span className="dir-browser-path-label">当前路径：</span>
              <span className="dir-browser-path-value">{dirBrowserPath || "根目录"}</span>
            </div>
            <div className="dir-browser-list">
              {dirBrowserPath && (
                <div
                  className="dir-browser-item dir-browser-parent"
                  onClick={() => {
                    const parent = dirBrowserPath.replace(/[/\\][^/\\]+$/, "");
                    if (parent && parent !== dirBrowserPath) {
                      fetch("/api/v1/system/list-directory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: parent }),
                      })
                        .then(r => r.json())
                        .then(data => {
                          setDirBrowserItems(data.items || []);
                          setDirBrowserPath(parent);
                        })
                        .catch(() => {});
                    } else {
                      // Go back to roots
                      fetch("/api/v1/system/browse-directory", { method: "POST" })
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                          setDirBrowserItems(data?.roots || []);
                          setDirBrowserPath("");
                        })
                        .catch(() => {});
                    }
                  }}
                >
                  📁 ..
                </div>
              )}
              {dirBrowserItems.map((item) => (
                <div
                  key={item.path}
                  className={`dir-browser-item${item.is_dir ? " dir-browser-dir" : ""}`}
                  onClick={() => {
                    if (item.is_dir) {
                      fetch("/api/v1/system/list-directory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: item.path }),
                      })
                        .then(r => r.json())
                        .then(data => {
                          setDirBrowserItems(data.items || []);
                          setDirBrowserPath(item.path);
                        })
                        .catch(() => {});
                    }
                  }}
                  onDoubleClick={() => {
                    if (item.is_dir) {
                      setNewWorkspaceName(item.path);
                      setShowDirBrowser(false);
                    }
                  }}
                >
                  {item.is_dir ? "📁" : "📄"} {item.name}
                </div>
              ))}
            </div>
            <div className="dir-browser-footer">
              <button
                className="dir-browser-select-btn"
                onClick={() => {
                  if (dirBrowserPath) {
                    setNewWorkspaceName(dirBrowserPath);
                  }
                  setShowDirBrowser(false);
                }}
                disabled={!dirBrowserPath}
              >
                选择此目录
              </button>
              <button className="dir-browser-cancel-btn" onClick={() => setShowDirBrowser(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
