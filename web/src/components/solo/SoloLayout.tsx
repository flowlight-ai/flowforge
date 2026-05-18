"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useSoloWebSocket } from "../../hooks/useSoloWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import { ChatMessage, DynNode, DynEdge } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
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
import MarkdownPanel from "./MarkdownPanel";

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
  const [webproxyStatus, setWebproxyStatus] = useState<{ running: boolean; healthy: boolean; models: number } | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [graphModal, setGraphModal] = useState<{type: "workflow" | "agent" | "mode"; name: string} | null>(null);
  const [rightTab, setRightTab] = useState<"editor" | "files">("editor");
  const config = useShellConfig();

  const [leftWidth, setLeftWidth] = useState(220);
  const [centerWidth, setCenterWidth] = useState(420);

  useEffect(() => {
    const checkWebproxy = () => {
      fetch("http://127.0.0.1:8000/api/v1/webproxy/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setWebproxyStatus({ running: d.running, healthy: d.healthy, models: (d.models || []).length });
          else setWebproxyStatus(null);
        })
        .catch(() => setWebproxyStatus(null));
    };
    checkWebproxy();
    const interval = setInterval(checkWebproxy, 30000);
    return () => clearInterval(interval);
  }, []);

  const solo = useSoloWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) solo.updateEditor(content);
    },
  });

  const elapsed = useMemo(() => {
    if (!solo.startTime) return 0;
    return Math.floor((Date.now() - solo.startTime) / 1000);
  }, [solo.startTime, solo.phase]);

  useEffect(() => {
    if (solo.taskId && solo.phase !== "idle" && solo.phase !== "creating" && solo.phase !== "connecting") {
      const brand = config.brandName.toLowerCase();
      appendTaskHistory(brand, { taskId: solo.taskId, persona: solo.persona, intent: solo.intent, phase: solo.phase, timestamp: Date.now() });
    }
  }, [solo.taskId, solo.phase, config.brandName]);

  useEffect(() => {
    if (solo.taskId && solo.phase === "completed" && solo.entries.length > 0) {
      const lastEntry = solo.entries[solo.entries.length - 1];
      if (lastEntry?.data?.content) {
        fetch(`/api/v1/workspace/${solo.taskId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content: lastEntry.data.content.slice(0, 2000) }),
        }).catch(() => {});
      }
      fetch(`/api/v1/workspace/${solo.taskId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }).catch(() => {});
    }
  }, [solo.taskId, solo.phase, solo.entries]);

  const chatMessages = useMemo(() => {
    const msgs: ChatMessage[] = [];
    for (const entry of solo.entries) msgs.push(...entryToChatMessages(entry));
    for (const um of userMessages) msgs.push(um);
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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
    }

    if (solo.phase === "completed" || solo.phase === "error" || solo.phase === "rejected") {
      for (const n of nodes) {
        if (n.status === "running" || n.status === "pending") {
          n.status = solo.phase === "error" || solo.phase === "rejected" ? "error" : "completed";
        }
      }
      currentStep = undefined;
    }

    return { dynNodes: nodes, dynEdges: edges, currentDynStep: currentStep };
  }, [solo.entries, solo.phase, solo.intent]);

  const handleChatSubmit = useCallback(
    (text: string, persona?: string, model?: string) => {
      const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text, timestamp: new Date().toISOString() };
      setUserMessages((prev) => [...prev, userMsg]);

      if (solo.phase === "idle" || solo.phase === "completed" || solo.phase === "error" || solo.phase === "rejected") {
        solo.createTask(text, { persona: persona || "default", ...(model ? { model } : {}) });
      } else if (solo.taskId) {
        fetch(`/api/v1/workspace/${solo.taskId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text, model }),
        }).catch(() => {});
      }
    },
    [solo]
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
        const helpMsg: ChatMessage = { id: `system-help-${Date.now()}`, role: "system", content: `可用命令: ${COMMANDS.map((c) => c.cmd).join(", ")}`, timestamp: new Date().toISOString() };
        setUserMessages((prev) => [...prev, helpMsg]);
        break;
      }
      default: {
        const userMsg: ChatMessage = { id: `user-cmd-${Date.now()}`, role: "user", content: `${cmd} 切换模式`, timestamp: new Date().toISOString() };
        setUserMessages((prev) => [...prev, userMsg]);
      }
    }
  }, [solo]);

  return (
    <div className="solo-shell-v2">
      <div className="solo-left-panel" style={{ width: leftWidth, minWidth: 160, maxWidth: 400 }}>
        <TaskListPanel
          phase={solo.phase} intent={solo.intent} taskId={solo.taskId} elapsed={elapsed}
          onNewTask={() => { solo.resetState(); setUserMessages([]); }}
          onRestoreChat={(msgs) => { setUserMessages(msgs); }}
          onSwitchTask={(tid, taskIntent, taskPersona, taskPhase) => {
            setUserMessages([]);
            solo.restoreTask(tid, taskIntent, taskPersona, taskPhase);
          }}
          refreshTrigger={solo.phase === "idle" ? 0 : Date.now()}
        />
      </div>
      <ResizeHandle onResize={(dx) => setLeftWidth((w) => Math.max(160, Math.min(400, w + dx)))} />
      <div className="solo-center-panel" style={{ width: centerWidth, minWidth: 320, maxWidth: 800 }}>
        <div className="solo-center-topbar">
          <span className="solo-brand">{config.brandName}<span className="topbar-sep">/</span>{solo.interactionMode === "normal" ? "普通" : solo.interactionMode === "auto" ? "全自动" : "Solo"}</span>
          <div className="solo-topbar-spacer" />
          {webproxyStatus && (
            <span className={`solo-webproxy-status${webproxyStatus.healthy ? " healthy" : webproxyStatus.running ? " degraded" : " stopped"}`}
              title={webproxyStatus.healthy ? `网页代理运行中 (${webproxyStatus.models} 个模型)` : "网页代理未运行"}>
              {webproxyStatus.healthy ? "🌐" : "⚠"} {webproxyStatus.models}
            </span>
          )}
          <span className="solo-tokens">Token: {solo.tokenStats.total} · ¥{solo.tokenStats.cost.toFixed(2)}</span>
        </div>
        <ChatStream messages={chatMessages} phase={solo.phase} onApprovalAction={handleApprovalAction} stageProgress={solo.stageProgress} interactionMode={solo.interactionMode} dynNodes={dynNodes} dynEdges={dynEdges} currentStep={currentDynStep} />
        <ChatInput phase={solo.phase} onSubmit={handleChatSubmit} onReview={handleReview} onCommand={handleCommand} onStop={solo.resetState} interactionMode={solo.interactionMode} onInteractionModeChange={solo.setInteractionMode} selectedWorkflow={selectedWorkflow} onWorkflowChange={setSelectedWorkflow} />
      </div>
      <ResizeHandle onResize={(dx) => setCenterWidth((w) => Math.max(320, Math.min(800, w + dx)))} />
      <div className="solo-right-panel" style={{ flex: 1, minWidth: 280 }}>
        <div className="flex border-b border-gray-700">
          <button className={`px-4 py-2 text-sm ${rightTab === "editor" ? "text-white border-b-2 border-indigo-500" : "text-gray-400"}`} onClick={() => setRightTab("editor")}>编辑器</button>
          <button className={`px-4 py-2 text-sm ${rightTab === "files" ? "text-white border-b-2 border-indigo-500" : "text-gray-400"}`} onClick={() => setRightTab("files")}>工作区文件</button>
        </div>
        {rightTab === "editor" ? (
          <MarkdownPanel content={solo.editorContent} onChange={solo.updateEditor} phase={solo.phase} />
        ) : (
          <WorkspacePanel taskId={solo.taskId} />
        )}
      </div>
      {graphModal && (
        <StaticGraphModal type={graphModal.type} name={graphModal.name} onClose={() => setGraphModal(null)} />
      )}
    </div>
  );
}
