"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useHelmWebSocket } from "../../hooks/useHelmWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import { ChatMessage, DynNode, DynEdge } from "./helm-types";
import {
  entryToChatMessages,
  mergeStreamingMessages,
  appendTaskHistory,
} from "./helm-utils";
import { BUILTIN_COMMANDS } from "./commands";
import { Plan, PlanStep } from "./PlanPanel";
import DynamicGraph from "./DynamicGraph";
import StaticGraphModal from "./StaticGraphModal";
import WorkspacePanel from "./WorkspacePanel";
import { ResizeHandle } from "./ChatPrimitives";
import TaskListPanel from "./TaskListPanel";
import ChatStream from "./ChatStream";
import ChatInput from "./ChatInput";
import MarkdownPanel, { OpenTab } from "./MarkdownPanel";
import DiffViewer, { DiffFile, computeFileDiff } from "./DiffViewer";
import { Attachment } from "./AttachmentPreview";

/* ── Dynamic imports for Phase 2-4 components (code splitting) ── */
const AgentOrchestrator = dynamic(() => import("./AgentOrchestrator"), { ssr: false });
const MCPConfigPanel = dynamic(() => import("./MCPConfigPanel"), { ssr: false });
const TerminalPanel = dynamic(() => import("./TerminalPanel"), { ssr: false });
const StepSummary = dynamic(() => import("./StepSummary"), { ssr: false });
const SettingsPanel = dynamic(() => import("./SettingsPanel"), { ssr: false });
const BrowserPreview = dynamic(() => import("./BrowserPreview"), { ssr: false });
const SpecPanel = dynamic(() => import("./SpecPanel"), { ssr: false });
const WorktreePanel = dynamic(() => import("./WorktreePanel"), { ssr: false });
const MarkdownRenderer = dynamic(() => import("./MarkdownRenderer"), { ssr: false });
const VoiceInput = dynamic(() => import("./VoiceInput"), { ssr: false });
const FigmaImporter = dynamic(() => import("./FigmaImporter"), { ssr: false });

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

export default function HelmLayout() {
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

  /* ── Plan state ── */
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planUpdateNotification, setPlanUpdateNotification] = useState<string | null>(null);
  const [newlyAddedSteps, setNewlyAddedSteps] = useState<Set<number>>(new Set());

  /* ── Diff files state ── */
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  /* ── Attachments state ── */
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /* ── Phase 2-4: New panel state variables ── */
  const [showSettings, setShowSettings] = useState(false);
  const [showMCPConfig, setShowMCPConfig] = useState(false);
  const [showAgentOrchestrator, setShowAgentOrchestrator] = useState(false);
  const [showBrowserPreview, setShowBrowserPreview] = useState(false);
  const [showSpecPanel, setShowSpecPanel] = useState(false);
  const [showWorktreePanel, setShowWorktreePanel] = useState(false);
  const [showFigmaImporter, setShowFigmaImporter] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [terminalCommands, setTerminalCommands] = useState<import("./TerminalPanel").TerminalCommand[]>([]);

  /* ── Panel visibility + responsive ── */
  const [panelVisibility, setPanelVisibility] = useState({ chat: true, editor: true, explorer: true });
  const prevPanelVisibility = useRef(panelVisibility);

  /* ── Ctrl+K / Cmd+K global shortcut to open command palette ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        const textarea = document.querySelector<HTMLTextAreaElement>(".chat-input-textarea");
        if (textarea) {
          textarea.focus();
          // Use React-compatible way to set value and trigger input event
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(textarea, "/");
          } else {
            textarea.value = "/";
          }
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const helm = useHelmWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) helm.updateEditor(content);
    },
  });

  /* ── Plan: detect plan events from entries ── */
  useEffect(() => {
    for (const entry of helm.entries) {
      if (entry.type === "system" && entry.data?._plan) {
        setCurrentPlan(entry.data._plan as Plan);
        setPlanLoading(false);
      }
    }
  }, [helm.entries]);

  /* ── Diff: detect file changes from tool results ── */
  useEffect(() => {
    for (const entry of helm.entries) {
      if (entry.type === "tool-call" && entry.data?.result) {
        const result = entry.data.result;
        // Handle file_changes from tool results
        if (result?.file_changes && Array.isArray(result.file_changes)) {
          const newDiffs: DiffFile[] = result.file_changes.map((change: any) => {
            const original = change.original ?? change.before ?? "";
            const current = change.current ?? change.after ?? change.content ?? "";
            return computeFileDiff(original, current, change.file_path || change.path || "unknown");
          });
          if (newDiffs.length > 0) {
            setDiffFiles((prev) => {
              // Merge with existing, avoiding duplicates by filePath
              const existingPaths = new Set(prev.map((f) => f.filePath));
              const merged = [...prev];
              for (const d of newDiffs) {
                if (existingPaths.has(d.filePath)) {
                  const idx = merged.findIndex((f) => f.filePath === d.filePath);
                  merged[idx] = d;
                } else {
                  merged.push(d);
                }
              }
              return merged;
            });
          }
        }
      }
    }
  }, [helm.entries]);

  const handlePlanConfirm = useCallback(async (planId: string, editedSteps?: PlanStep[]) => {
    if (!helm.taskId) return;
    try {
      const body: Record<string, any> = { plan_id: parseInt(planId) || 0 };
      if (editedSteps) {
        body.edited_steps = editedSteps;
      } else if (currentPlan && currentPlan.edited_steps.length > 0) {
        // Collect actual edited steps from plan's steps array where step name appears in edited_steps
        const steps = currentPlan.steps.filter(
          (step) => currentPlan.edited_steps.includes(step.name)
        );
        if (steps.length > 0) body.edited_steps = steps;
      }
      const r = await fetch(`/api/v1/tasks/${helm.taskId}/plan/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.data) setCurrentPlan(data.data);
      }
    } catch {}
  }, [helm.taskId, currentPlan]);

  const handlePlanReject = useCallback(async (planId: string) => {
    if (!helm.taskId) return;
    try {
      const r = await fetch(`/api/v1/tasks/${helm.taskId}/plan/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.data) setCurrentPlan(data.data);
      }
    } catch {}
  }, [helm.taskId]);

  const handlePlanRegenerate = useCallback(() => {
    if (!helm.taskId) return;
    setPlanLoading(true);
    fetch(`/api/v1/tasks/${helm.taskId}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: helm.intent || "" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.data) setCurrentPlan(data.data);
        setPlanLoading(false);
      })
      .catch(() => setPlanLoading(false));
  }, [helm.taskId, helm.intent]);

  const handlePlanStepEdit = useCallback((stepIndex: number, step: Partial<PlanStep>) => {
    if (!helm.taskId || !currentPlan) return;
    fetch(`/api/v1/tasks/${helm.taskId}/plan/steps/${stepIndex}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(step),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.data) setCurrentPlan(data.data);
      })
      .catch(() => {});
  }, [helm.taskId, currentPlan]);

  const handlePlanStepDelete = useCallback((stepIndex: number) => {
    if (!currentPlan) return;
    const steps = [...currentPlan.steps];
    steps.splice(stepIndex, 1);
    setCurrentPlan({ ...currentPlan, steps, total_steps: steps.length });
  }, [currentPlan]);

  const handlePlanStepAdd = useCallback((step: PlanStep) => {
    if (!currentPlan) return;
    const steps = [...currentPlan.steps, step];
    setCurrentPlan({ ...currentPlan, steps, total_steps: steps.length });
  }, [currentPlan]);

  const handlePlanUpdate = useCallback(async (newMessage: string) => {
    if (!helm.taskId || !currentPlan) return;

    try {
      setPlanLoading(true);
      const prevStepCount = currentPlan.steps.length;
      const res = await fetch(`/api/v1/tasks/${helm.taskId}/plan/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_message: newMessage,
          conversation_context: helm.entries.slice(-10).map((e: any) => ({
            role: e.type || "user",
            content: typeof e.data === "string" ? e.data : JSON.stringify(e.data || ""),
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const updatedPlan = data.data as Plan;
          setCurrentPlan(updatedPlan);
          // Detect newly added steps
          if (updatedPlan.steps.length > prevStepCount) {
            const newIndices = new Set<number>();
            for (let i = prevStepCount; i < updatedPlan.steps.length; i++) {
              newIndices.add(i);
            }
            setNewlyAddedSteps(newIndices);
            // Clear highlight after 3 seconds
            setTimeout(() => setNewlyAddedSteps(new Set()), 3000);
          }
          // Show update notification
          if (updatedPlan.update_reasoning) {
            setPlanUpdateNotification(updatedPlan.update_reasoning);
            setTimeout(() => setPlanUpdateNotification(null), 5000);
          }
        }
      }
    } catch (err) {
      console.error("[HelmLayout] Plan update failed:", err);
    } finally {
      setPlanLoading(false);
    }
  }, [helm.taskId, currentPlan, helm.entries]);

  useEffect(() => {
    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "interrupted") {
      fetchWorkspaceList();
    }
  }, [helm.phase, fetchWorkspaceList]);

  const elapsed = useMemo(() => {
    if (!helm.startTime) return 0;
    return Math.floor((Date.now() - helm.startTime) / 1000);
  }, [helm.startTime, helm.phase]);

  useEffect(() => {
    if (helm.taskId && helm.phase !== "idle" && helm.phase !== "creating" && helm.phase !== "connecting") {
      const brand = config.brandName.toLowerCase();
      appendTaskHistory(brand, { taskId: helm.taskId, persona: helm.persona, intent: helm.intent, phase: helm.phase, timestamp: Date.now() });
    }
    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "interrupted") {
      setRefreshCounter((c) => c + 1);
    }
  }, [helm.taskId, helm.phase, config.brandName]);

  useEffect(() => {
    if (helm.taskId && helm.phase === "completed") {
      fetch(`/api/v1/workspace/${helm.taskId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }).catch(() => {});
    }
  }, [helm.taskId, helm.phase]);

  const chatMessages = useMemo(() => {
    const msgs: ChatMessage[] = [];
    for (const entry of helm.entries) msgs.push(...entryToChatMessages(entry));
    for (const um of userMessages) msgs.push(um);
    msgs.sort((a, b) => {
      const ta = typeof a.timestamp === "number" ? a.timestamp : new Date(a.timestamp as string).getTime();
      const tb = typeof b.timestamp === "number" ? b.timestamp : new Date(b.timestamp as string).getTime();
      return ta - tb;
    });
    return mergeStreamingMessages(msgs);
  }, [helm.entries, userMessages]);

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

    if (helm.entries.length > 0) {
      const workflowId = "workflow-root";
      const intentLabel = helm.intent || "任务执行";
      nodes.push({
        id: workflowId,
        label: intentLabel.length > 24 ? intentLabel.slice(0, 24) + "…" : intentLabel,
        status: helm.phase === "completed" ? "completed" : helm.phase === "error" ? "error" : "running",
        type: "workflow",
      });
    }

    for (const entry of helm.entries) {
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
            status: helm.phase === "waiting_review" ? "running" : isExit ? "completed" : "running",
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
          status: helm.phase === "waiting_review" ? "running" : "completed",
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

    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "rejected" || helm.phase === "interrupted") {
      for (const n of nodes) {
        if (n.status === "running" || n.status === "pending") {
          n.status = helm.phase === "error" || helm.phase === "rejected" || helm.phase === "interrupted" ? "error" : "completed";
        }
      }
      currentStep = undefined;
    }

    return { dynNodes: nodes, dynEdges: edges, currentDynStep: currentStep };
  }, [helm.entries, helm.phase, helm.intent]);

  const handleChatSubmit = useCallback(
    (text: string, persona?: string, model?: string) => {
      const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text, timestamp: Date.now() };
      setUserMessages((prev) => [...prev, userMsg]);

      if (helm.taskId) {
        const brand = config.brandName.toLowerCase();
        appendTaskHistory(brand, { taskId: helm.taskId, persona: helm.persona || persona || "default", intent: helm.intent || text, phase: helm.phase, timestamp: Date.now() }, true);
      }

      const effectiveModel = model || (selectedModel === "auto" ? undefined : selectedModel);
      if (helm.phase === "idle") {
        helm.createTask(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (helm.phase === "completed" && helm.taskId) {
        helm.continueChat(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (helm.phase === "error" || helm.phase === "rejected" || helm.phase === "interrupted") {
        helm.createTask(text, { persona: persona || "default", ...(effectiveModel ? { model: effectiveModel } : {}) });
      } else if (helm.taskId) {
        fetch(`/api/v1/workspace/${helm.taskId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text, model: effectiveModel }),
        }).catch(() => {});
      }

      // After sending the message, trigger plan update if plan is active
      if (currentPlan && currentPlan.status !== "rejected") {
        handlePlanUpdate(text);
      }
    },
    [helm, config.brandName, selectedModel, currentPlan, handlePlanUpdate]
  );

  const handleReview = useCallback((verdict: "pass" | "reject", feedback: string) => { helm.submitReview(verdict, feedback); }, [helm]);
  const handleApprovalAction = useCallback((messageId: string, approved: boolean, feedback: string) => {
    if (messageId === "review-inline") helm.submitReview(approved ? "pass" : "reject", feedback);
  }, [helm]);

  const handleCommand = useCallback((cmd: string) => {
    const addSystemMsg = (content: string) => {
      const msg: ChatMessage = { id: `system-${Date.now()}`, role: "system", content, timestamp: Date.now() };
      setUserMessages((prev) => [...prev, msg]);
    };

    switch (cmd) {
      case "/pause": helm.pause(); break;
      case "/resume": helm.resume(); break;
      case "/skip": helm.skipCurrent(); break;
      case "/reset": helm.resetState(); setUserMessages([]); setDiffFiles([]); setAttachments([]); break;
      case "/review": if (helm.taskId) helm.submitReview("pass", "通过 /review 命令强制审核"); break;
      case "/plan": {
        helm.setInteractionMode("helm");
        setShowSpecPanel(true);
        if (helm.taskId && helm.intent) {
          setPlanLoading(true);
          fetch(`/api/v1/tasks/${helm.taskId}/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent: helm.intent }),
          })
            .then((r) => r.json())
            .then((data) => { if (data?.data) setCurrentPlan(data.data); setPlanLoading(false); })
            .catch(() => setPlanLoading(false));
        }
        addSystemMsg("已切换到规划模式");
        break;
      }
      case "/spec": {
        setShowSpecPanel(true);
        setPanelVisibility(prev => {
          const next = { ...prev, editor: true };
          prevPanelVisibility.current = next;
          return next;
        });
        addSystemMsg("已打开 Spec 面板");
        break;
      }
      case "/react": {
        helm.setInteractionMode("helm");
        addSystemMsg("已切换到 ReAct 模式");
        break;
      }
      case "/auto": {
        helm.setInteractionMode("auto");
        addSystemMsg("已切换到全自动模式");
        break;
      }
      case "/files": {
        handleTogglePanel("explorer");
        addSystemMsg(panelVisibility.explorer ? "已关闭文件面板" : "已打开文件面板");
        break;
      }
      case "/settings": {
        setShowSettings(true);
        addSystemMsg("已打开设置面板");
        break;
      }
      case "/search": {
        addSystemMsg("请在输入框中输入搜索关键词，例如：搜索 量子计算最新进展");
        break;
      }
      case "/terminal": {
        setShowAgentOrchestrator(false);
        setShowWorktreePanel(false);
        setPanelVisibility(prev => {
          const next = { ...prev, explorer: true };
          prevPanelVisibility.current = next;
          return next;
        });
        addSystemMsg("已打开终端面板");
        break;
      }
      case "/status": {
        const statusInfo = [
          `任务ID: ${helm.taskId || "无"}`,
          `阶段: ${helm.phase}`,
          `意图: ${helm.intent || "无"}`,
          `模式: ${helm.interactionMode}`,
          `附件: ${attachments.length} 个`,
          `变更文件: ${diffFiles.length} 个`,
        ].join("\n");
        addSystemMsg(statusInfo);
        break;
      }
      case "/scrape": {
        addSystemMsg("请在输入框中输入抓取 URL，例如：抓取 https://example.com");
        break;
      }
      case "/publish": {
        addSystemMsg("请在输入框中输入发布指令，例如：发布到微信公众号");
        break;
      }
      case "/help": {
        const helpMsg: ChatMessage = { id: `system-help-${Date.now()}`, role: "system", content: `可用命令: ${BUILTIN_COMMANDS.map((c) => c.id).join(", ")}`, timestamp: Date.now() };
        setUserMessages((prev) => [...prev, helpMsg]);
        break;
      }
      default: {
        const userMsg: ChatMessage = { id: `user-cmd-${Date.now()}`, role: "user", content: `${cmd} 切换模式`, timestamp: Date.now() };
        setUserMessages((prev) => [...prev, userMsg]);
      }
    }
  }, [helm, panelVisibility.explorer, attachments.length, diffFiles.length, handleTogglePanel, setShowSettings, setShowSpecPanel, setShowAgentOrchestrator, setShowWorktreePanel]);

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
    const apiPrefix = `/api/v1/workspace/${helm.taskId}/files/`;
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
      const draftContent = helm.editorContent;
      if (draftContent) {
        setOpenTabs((prev) =>
          prev.map((t) => t.id === tabId ? { ...t, content: draftContent, originalContent: draftContent } : t)
        );
      }
    }
  }, [openTabs, helm.editorContent]);

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
    const apiPrefix = `/api/v1/workspace/${helm.taskId}/files/`;
    const relativePath = filePath.startsWith(apiPrefix) ? filePath.slice(apiPrefix.length) : fileName;
    setHighlightFilePath(relativePath);
  }, [handleFileOpen, helm.taskId, panelVisibility.explorer]);

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
    <div className="helm-shell-v2">
      {/* Leftmost column: Task List */}
      <div className="helm-tasklist-column">
        <TaskListPanel
          phase={helm.phase} intent={helm.intent} taskId={helm.taskId} elapsed={elapsed}
          workspaceName={currentWorkspace}
          onNewTask={() => { helm.resetState(); setUserMessages([]); }}
          onRestoreChat={(msgs) => { setUserMessages(msgs); }}
          onSwitchTask={(tid, taskIntent, taskPersona, taskPhase) => {
            setUserMessages([]);
            helm.restoreTask(tid, taskIntent, taskPersona, taskPhase);
          }}
          refreshTrigger={refreshCounter}
          workspaceRefreshKey={workspaceRefreshKey}
        />
      </div>

      {panelVisibility.chat && (
        <>
          <div className="helm-chat-panel" style={{ width: chatPanelWidth, minWidth: 200, maxWidth: 400 }}>
            <div className="helm-workspace-selector" ref={wsDropdownRef}>
              <button
                className="helm-ws-trigger"
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
              >
                <span className="helm-ws-trigger-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span className="helm-ws-trigger-name">
                  {currentWorkspaceName || `${config.brandName} Helm`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`helm-ws-chevron${wsDropdownOpen ? " open" : ""}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {wsDropdownOpen && (
                <div className="helm-ws-dropdown">
                  <div className="helm-ws-dropdown-header">
                    <span>工作区</span>
                    <button
                      className="helm-ws-new-btn"
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
                    <div className="helm-ws-new-input-row">
                      <input
                        className="helm-ws-new-input"
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
                              helm.resetState();
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
                        className="helm-ws-browse-btn"
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
                  <div className="helm-ws-dropdown-list">
                    {workspaceList.length === 0 ? (
                      <div className="helm-ws-empty">暂无工作区</div>
                    ) : (
                      workspaceList.map((ws) => (
                        <div
                          key={ws.name}
                          className={`helm-ws-item${ws.name === currentWorkspace ? " active" : ""}`}
                          onClick={() => {
                            setCurrentWorkspace(ws.name);
                            setWsDropdownOpen(false);
                            // Reset all panels when switching workspace
                            helm.resetState();
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
                                  helm.restoreTask(latest.task_id, latest.intent || latest.task_id, latest.persona || 'default', 'completed');
                                }
                              })
                              .catch(() => {});
                            fetchWorkspaceList();
                            setRefreshCounter(c => c + 1);
                            setWorkspaceRefreshKey(k => k + 1);
                          }}
                        >
                          <span className="helm-ws-item-status">
                            <span className="ws-status-dot" />
                          </span>
                          <span className="helm-ws-item-name">
                            <span className="helm-ws-item-wsname">{ws.display_name || ws.name}</span>
                            <span className="helm-ws-item-path">{ws.path}</span>
                          </span>
                          <span className="helm-ws-item-task-count">{ws.task_count || 0}</span>
                          <button
                            className="helm-ws-item-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (ws.name === "default") return;
                              fetch(`/api/v1/workspace/named/${ws.name}`, { method: "DELETE" }).then(() => {
                                fetchWorkspaceList();
                                if (ws.name === currentWorkspace) {
                                  setCurrentWorkspace("default");
                                  helm.resetState();
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
              {planUpdateNotification && (
                <div style={{
                  padding: "6px 12px",
                  background: "rgba(249,226,175,0.15)",
                  borderBottom: "1px solid rgba(249,226,175,0.25)",
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 12, color: "#f9e2af",
                }}>
                  <span>🔄</span>
                  <span>计划已更新: {planUpdateNotification}</span>
                  <button
                    onClick={() => setPlanUpdateNotification(null)}
                    style={{
                      marginLeft: "auto", background: "none", border: "none",
                      color: "#f9e2af", cursor: "pointer", fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
              <ChatStream messages={chatMessages} phase={helm.phase} onApprovalAction={handleApprovalAction} stageProgress={helm.stageProgress} interactionMode={helm.interactionMode} dynNodes={dynNodes} dynEdges={dynEdges} currentStep={currentDynStep} onFileOpen={handleFileOpen} onRetry={() => { if (helm.intent) helm.createTask(helm.intent, { persona: helm.persona || "default" }); }} onRefresh={() => { if (helm.taskId) { fetch(`/api/v1/tasks/${helm.taskId}`).then(r => r.json()).then(d => { if (d?.data?.status === "completed") helm.restoreTask(helm.taskId!, helm.intent || "", helm.persona || "default", "completed"); }).catch(() => {}); } }} onClear={() => { setUserMessages([]); helm.resetState(); }} taskId={helm.taskId ?? undefined} currentPlan={currentPlan} planLoading={planLoading} onPlanConfirm={handlePlanConfirm} onPlanReject={handlePlanReject} onPlanRegenerate={handlePlanRegenerate} onPlanStepEdit={handlePlanStepEdit} onPlanStepDelete={handlePlanStepDelete} onPlanStepAdd={handlePlanStepAdd} newlyAddedSteps={newlyAddedSteps} />
              {resumePrompt && helm.phase === "idle" && (
                <div className="px-4 py-3 bg-amber-900/30 border-t border-amber-700/50 flex items-center gap-3">
                  <span className="text-amber-300 text-xs">⏸ 发现未完成的任务: {resumePrompt.intent.slice(0, 40)}</span>
                  <button
                    onClick={() => {
                      helm.restoreTask(resumePrompt.task_id, resumePrompt.intent, "default", "running");
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
              <ChatInput phase={helm.phase} onSubmit={handleChatSubmit} onReview={handleReview} onCommand={handleCommand} onStop={helm.resetState} interactionMode={helm.interactionMode} onInteractionModeChange={helm.setInteractionMode} selectedModel={selectedModel} onModelChange={setSelectedModel} selectedWorkflow={null} onWorkflowChange={() => {}} attachments={attachments} onRemoveAttachment={(id) => setAttachments(prev => prev.filter(a => a.id !== id))} taskId={helm.taskId ?? undefined} />
            </>
          </div>
          <ResizeHandle onResize={(dx) => setChatPanelWidth((w) => Math.max(200, Math.min(400, w + dx)))} />
        </>
      )}
      <div className={`helm-editor-panel${!panelVisibility.editor ? " collapsed" : ""}`}>
        {showBrowserPreview ? (
          <BrowserPreview
            url={browserUrl}
            onNavigate={(url) => setBrowserUrl(url)}
          />
        ) : showSpecPanel ? (
          <SpecPanel
            spec=""
            tasks={[]}
            checklist={[]}
            onUpdate={() => {}}
          />
        ) : (
          <MarkdownPanel
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            onContentChange={handleContentChange}
            phase={helm.phase}
            showSettings={showSettingsInEditor}
            onCloseSettings={() => setShowSettingsInEditor(false)}
            panelVisibility={panelVisibility}
            onTogglePanel={handleTogglePanel}
            onOpenSettings={handleSettingsClick}
            collapsed={!panelVisibility.editor}
            diffFiles={diffFiles}
            onAcceptDiffFile={(filePath) => {
              setDiffFiles((prev) => prev.filter((f) => f.filePath !== filePath));
            }}
            onRejectDiffFile={(filePath) => {
              setDiffFiles((prev) => prev.filter((f) => f.filePath !== filePath));
            }}
            onRevertAllDiffs={() => {
              setDiffFiles([]);
            }}
          />
        )}
      </div>
      {panelVisibility.explorer && (
        <>
          <ResizeHandle onResize={(dx) => setRightPanelWidth((w) => Math.max(180, Math.min(400, w - dx)))} />
          <div className="helm-explorer-panel" style={{ width: rightPanelWidth, minWidth: 180, maxWidth: 400 }}>
            {showAgentOrchestrator ? (
              <AgentOrchestrator
                agents={[]}
                onToggle={() => {}}
                onConfigure={() => {}}
                onReorder={() => {}}
              />
            ) : showWorktreePanel ? (
              <WorktreePanel
                worktrees={[]}
                onCreate={() => {}}
                onSwitch={() => {}}
                onDelete={() => {}}
              />
            ) : (
              <WorkspacePanel
                taskId={helm.taskId}
                workspaceName={currentWorkspace}
                onFileOpen={handleWorkspaceFileOpen}
                highlightFilePath={highlightFilePath}
              />
            )}
          </div>
        </>
      )}
      {graphModal && (
        <StaticGraphModal type={graphModal.type} name={graphModal.name} onClose={() => setGraphModal(null)} />
      )}

      {/* ── Phase 2-4: Settings Full-screen Overlay Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] bg-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <SettingsPanel
              config={{
                general: { language: "zh-CN", theme: "dark", autoSave: true },
                models: { primary: selectedModel, fallback: "auto", temperature: 0.7, maxTokens: 4096 },
                apiKeys: {},
                advanced: { maxRetries: 3, timeoutMs: 60000, verbose: false },
              }}
              onSave={(cfg) => { setShowSettings(false); }}
              onReset={() => {}}
            />
            <div className="flex justify-end px-4 py-3 border-t border-gray-700">
              <button className="px-4 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 2-4: MCP Config Slide-in Panel from Right ── */}
      {showMCPConfig && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setShowMCPConfig(false)}>
          <div className="w-full max-w-md h-full bg-[#1e1e2e] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-semibold text-gray-200">MCP 服务器配置</span>
              <button className="text-gray-400 hover:text-gray-200" onClick={() => setShowMCPConfig(false)}>✕</button>
            </div>
            <MCPConfigPanel
              servers={[]}
              onAdd={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
              onTest={() => {}}
            />
          </div>
        </div>
      )}

      {/* ── Phase 2-4: Figma Importer Modal ── */}
      {showFigmaImporter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowFigmaImporter(false)}>
          <div className="w-full max-w-lg max-h-[80vh] bg-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-semibold text-gray-200">Figma 导入</span>
              <button className="text-gray-400 hover:text-gray-200" onClick={() => setShowFigmaImporter(false)}>✕</button>
            </div>
            <FigmaImporter
              onImport={() => {}}
              onGenerateCode={() => {}}
            />
          </div>
        </div>
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
