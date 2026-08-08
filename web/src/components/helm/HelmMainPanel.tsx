"use client";

/**
 * HelmMainPanel — 主聊天区面板（Phase 3 拆分）
 *
 * 从 HelmLayout 拆出，包含：
 *   - Plan 更新通知条
 *   - ModeSelector 模式选择器（4 种模式）
 *   - council 模式：渲染 CouncilChatPanel
 *   - normal/helm/auto 模式：渲染 ChatStream + ChatInput + resumePrompt
 *   - chatMessages / dynNodes 动态图计算
 *   - handleChatSubmit / handleReview / handleApprovalAction
 *
 * 替代 HelmLayout 中的 chatMessages useMemo、dynNodes useMemo、handleChatSubmit 等。
 */

import dynamic from "next/dynamic";
import { useMemo, useCallback } from "react";
import { ChatMessage, DynNode, DynEdge } from "./helm-types";
import {
  entryToChatMessages,
  mergeStreamingMessages,
  appendTaskHistory,
} from "./helm-utils";
import ChatStream from "./ChatStream";
import ChatInput from "./ChatInput";
import { type HelmMode } from "./ModeSelector";
import type { useHelmWebSocket } from "../../hooks/useHelmWebSocket";
import type { useHelmPlan } from "./hooks/useHelmPlan";
import type { useHelmDiff } from "./hooks/useHelmDiff";

type HelmWS = ReturnType<typeof useHelmWebSocket>;
type PlanState = ReturnType<typeof useHelmPlan>;
type DiffState = ReturnType<typeof useHelmDiff>;

/* Phase 3: council 模式渲染 CouncilChatPanel（4 模式融合） */
const CouncilChatPanel = dynamic(() => import("./CouncilChatPanel"), {
  ssr: false,
});

function getModeSteps(mode: string): { key: string; label: string }[] {
  const m = mode.toLowerCase().replace(/[_-]/g, "_");
  if (m === "react")
    return [
      { key: "thought", label: "Thought" },
      { key: "action", label: "Action" },
      { key: "observation", label: "Observation" },
    ];
  if (m === "plan_execute")
    return [
      { key: "planner", label: "Planner" },
      { key: "executor", label: "Executor" },
    ];
  if (m === "plan_execute_critic")
    return [
      { key: "planner", label: "Planner" },
      { key: "executor", label: "Executor" },
      { key: "critic", label: "Critic" },
    ];
  if (m === "reflexion")
    return [
      { key: "action", label: "Action" },
      { key: "observation", label: "Observation" },
      { key: "reflect", label: "Reflect" },
    ];
  if (m === "self_refine")
    return [
      { key: "draft", label: "Draft" },
      { key: "critic", label: "Critic" },
      { key: "refine", label: "Refine" },
    ];
  if (m === "workflow" || m === "pipeline" || m === "chain")
    return [{ key: "execute", label: "Execute" }];
  return [{ key: "execute", label: "Execute" }];
}

interface HelmMainPanelProps {
  mode: HelmMode;
  setMode: (mode: HelmMode) => void;
  selectedWorkflow: string | null;
  setSelectedWorkflow: (wf: string | null) => void;
  helm: HelmWS;
  brandName: string;
  plan: PlanState;
  diff: DiffState;
  onFileOpen: (filePath: string, fileName: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  userMessages: ChatMessage[];
  setUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onCommand: (cmd: string) => void;
  resumePrompt: { task_id: string; intent: string } | null;
  onResumePrompt: () => void;
  onDismissResumePrompt: () => void;
  onRefreshTask: () => void;
  onClearChat: () => void;
}

export default function HelmMainPanel({
  mode,
  setMode,
  selectedWorkflow,
  setSelectedWorkflow,
  helm,
  brandName,
  plan,
  diff,
  onFileOpen,
  selectedModel,
  setSelectedModel,
  userMessages,
  setUserMessages,
  onCommand,
  resumePrompt,
  onResumePrompt,
  onDismissResumePrompt,
  onRefreshTask,
  onClearChat,
}: HelmMainPanelProps) {
  /* ── chatMessages: 合并 helm.entries + userMessages ── */
  const chatMessages = useMemo(() => {
    const msgs: ChatMessage[] = [];
    for (const entry of helm.entries) msgs.push(...entryToChatMessages(entry));
    for (const um of userMessages) msgs.push(um);
    msgs.sort((a, b) => {
      const ta =
        typeof a.timestamp === "number"
          ? a.timestamp
          : new Date(a.timestamp as string).getTime();
      const tb =
        typeof b.timestamp === "number"
          ? b.timestamp
          : new Date(b.timestamp as string).getTime();
      return ta - tb;
    });
    return mergeStreamingMessages(msgs);
  }, [helm.entries, userMessages]);

  /* ── dynNodes / dynEdges / currentDynStep: 动态执行图 ── */
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
        label:
          intentLabel.length > 24 ? intentLabel.slice(0, 24) + "…" : intentLabel,
        status:
          helm.phase === "completed"
            ? "completed"
            : helm.phase === "error"
            ? "error"
            : "running",
        type: "workflow",
      });
    }

    for (const entry of helm.entries) {
      if (entry.type === "stage") {
        const stepName = entry.data?.step || entry.data?.stage || entry.data?.label;
        const agentName = entry.data?.agent_name || entry.data?.agent;
        const modeStep = entry.data?.mode;
        const isExit =
          entry.data?.order === undefined || entry.data?.order === null;
        const isHuman = entry.data?.human === true;

        if (isHuman) {
          const reviewId = `review-${nodes.length}`;
          nodes.push({
            id: reviewId,
            label: stepName || "审核节点",
            status:
              helm.phase === "waiting_review"
                ? "running"
                : isExit
                ? "completed"
                : "running",
            type: "review",
            agent: agentName,
            parentId: "workflow-root",
          });
          if (currentAgentNodeId)
            edges.push({ from: currentAgentNodeId, to: reviewId });
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
              const r =
                typeof entry.data.result === "string"
                  ? entry.data.result
                  : JSON.stringify(entry.data.result);
              existing.summary = r.length > 60 ? r.slice(0, 60) + "…" : r;
            }
          }
          currentAgentNodeId = undefined;
          continue;
        }

        if (!isExit && stepName) {
          const agentId = `agent-${agentName || stepName}-${nodes.length}`;
          const label = agentName
            ? agentName
                .replace(/[_-]/g, " ")
                .replace(/\b\w/g, (c: string) => c.toUpperCase())
            : stepName;
          const status: "pending" | "running" | "completed" | "error" =
            "running";
          if (!currentStep) currentStep = agentId;

          nodes.push({
            id: agentId,
            label,
            status,
            type: "agent",
            agent: agentName,
            mode: modeStep,
            parentId: "workflow-root",
          });
          agentStartTimes[agentId] = Date.now();

          if (agentNodeIds.length > 0) {
            edges.push({
              from: agentNodeIds[agentNodeIds.length - 1],
              to: agentId,
            });
          } else {
            edges.push({ from: "workflow-root", to: agentId });
          }

          currentAgentNodeId = agentId;
          agentNodeIds.push(agentId);

          if (modeStep) {
            const modeSteps = getModeSteps(modeStep);
            for (const ms of modeSteps) {
              const stepId = `${agentId}-${ms.key}-${nodes.length}`;
              modeStepCounters[ms.key] =
                (modeStepCounters[ms.key] || 0) + 1;
              nodes.push({
                id: stepId,
                label: ms.label,
                status: "pending",
                type: "mode_step",
                agent: agentName,
                mode: modeStep,
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
        const isEnd =
          entry.data?.result !== undefined || entry.data?.error !== undefined;
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
              const r =
                typeof resultData === "string"
                  ? resultData
                  : JSON.stringify(resultData);
              existingTool.summary =
                r.length > 50 ? r.slice(0, 50) + "…" : r;
            }
            if (entry.data?.error) {
              existingTool.summary = entry.data.error;
            }
          }

          if (currentAgentNodeId) {
            const modeStepNodes = nodes.filter(
              (n) =>
                n.parentId === currentAgentNodeId &&
                n.type === "mode_step" &&
                n.status === "pending"
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
          label: entry.data?.draft_summary
            ? "审核: " + (entry.data.draft_summary as string).slice(0, 30)
            : "审核节点",
          status: helm.phase === "waiting_review" ? "running" : "completed",
          type: "review",
          summary: entry.data?.draft_summary,
          parentId: "workflow-root",
        });
        if (currentAgentNodeId)
          edges.push({ from: currentAgentNodeId, to: reviewId });
      }

      if (entry.type === "thinking" || entry.type === "llm-stream") {
        if (currentAgentNodeId) {
          const modeStepNodes = nodes.filter(
            (n) =>
              n.parentId === currentAgentNodeId &&
              n.type === "mode_step" &&
              n.status === "pending"
          );
          if (modeStepNodes.length > 0) {
            const stepLabel = entry.type === "thinking" ? "thought" : "";
            let targetStep = stepLabel
              ? modeStepNodes.find((n) =>
                  n.label.toLowerCase().includes(stepLabel)
                )
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
          existing.summary =
            content.length > 120 ? content.slice(0, 120) + "…" : content;
        }
      }
    }

    if (
      helm.phase === "completed" ||
      helm.phase === "error" ||
      helm.phase === "rejected" ||
      helm.phase === "interrupted"
    ) {
      for (const n of nodes) {
        if (n.status === "running" || n.status === "pending") {
          n.status =
            helm.phase === "error" ||
            helm.phase === "rejected" ||
            helm.phase === "interrupted"
              ? "error"
              : "completed";
        }
      }
      currentStep = undefined;
    }

    return { dynNodes: nodes, dynEdges: edges, currentDynStep: currentStep };
  }, [helm.entries, helm.phase, helm.intent]);

  /* ── handleChatSubmit ── */
  const handleChatSubmit = useCallback(
    (text: string, persona?: string, model?: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setUserMessages((prev) => [...prev, userMsg]);

      if (helm.taskId) {
        const brand = brandName.toLowerCase();
        appendTaskHistory(
          brand,
          {
            taskId: helm.taskId,
            persona: helm.persona || persona || "default",
            intent: helm.intent || text,
            phase: helm.phase,
            timestamp: Date.now(),
          },
          true
        );
      }

      const effectiveModel =
        model || (selectedModel === "auto" ? undefined : selectedModel);
      if (helm.phase === "idle") {
        helm.createTask(text, {
          persona: persona || "default",
          ...(effectiveModel ? { model: effectiveModel } : {}),
        });
      } else if (helm.phase === "completed" && helm.taskId) {
        helm.continueChat(text, {
          persona: persona || "default",
          ...(effectiveModel ? { model: effectiveModel } : {}),
        });
      } else if (
        helm.phase === "error" ||
        helm.phase === "rejected" ||
        helm.phase === "interrupted"
      ) {
        helm.createTask(text, {
          persona: persona || "default",
          ...(effectiveModel ? { model: effectiveModel } : {}),
        });
      } else if (helm.taskId) {
        fetch(`/api/v1/workspace/${helm.taskId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            content: text,
            model: effectiveModel,
          }),
        }).catch(() => {});
      }

      // 发送消息后，如果 plan 处于活跃状态，触发 plan 更新
      if (plan.currentPlan && plan.currentPlan.status !== "rejected") {
        plan.handlePlanUpdate(text);
      }
    },
    [helm, brandName, selectedModel, plan]
  );

  const handleReview = useCallback(
    (verdict: "pass" | "reject", feedback: string) => {
      helm.submitReview(verdict, feedback);
    },
    [helm]
  );

  const handleApprovalAction = useCallback(
    (messageId: string, approved: boolean, feedback: string) => {
      if (messageId === "review-inline")
        helm.submitReview(approved ? "pass" : "reject", feedback);
    },
    [helm]
  );

  return (
    <>
      {/* Plan 更新通知条 */}
      {plan.planUpdateNotification && (
        <div
          style={{
            padding: "6px 12px",
            background: "rgba(249,226,175,0.15)",
            borderBottom: "1px solid rgba(249,226,175,0.25)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#f9e2af",
          }}
        >
          <span>🔄</span>
          <span>计划已更新: {plan.planUpdateNotification}</span>
          <button
            onClick={() => plan.setPlanUpdateNotification(null)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "#f9e2af",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {mode === "council" ? (
        <div
          className="flex-1 flex flex-col min-h-0"
          data-helm-mode="council"
        >
          <CouncilChatPanel showSidebar={false} />
        </div>
      ) : (
        <>
          <ChatStream
            messages={chatMessages}
            phase={helm.phase}
            onApprovalAction={handleApprovalAction}
            stageProgress={helm.stageProgress}
            interactionMode={helm.interactionMode}
            dynNodes={dynNodes}
            dynEdges={dynEdges}
            currentStep={currentDynStep}
            onFileOpen={onFileOpen}
            onRetry={() => {
              if (helm.intent)
                helm.createTask(helm.intent, {
                  persona: helm.persona || "default",
                });
            }}
            onRefresh={onRefreshTask}
            onClear={onClearChat}
            taskId={helm.taskId ?? undefined}
            currentPlan={plan.currentPlan}
            planLoading={plan.planLoading}
            onPlanConfirm={plan.handlePlanConfirm}
            onPlanReject={plan.handlePlanReject}
            onPlanRegenerate={plan.handlePlanRegenerate}
            onPlanStepEdit={plan.handlePlanStepEdit}
            onPlanStepDelete={plan.handlePlanStepDelete}
            onPlanStepAdd={plan.handlePlanStepAdd}
            newlyAddedSteps={plan.newlyAddedSteps}
          />

          {resumePrompt && helm.phase === "idle" && (
            <div className="px-4 py-3 bg-amber-900/30 border-t border-amber-700/50 flex items-center gap-3">
              <span className="text-[var(--semantic-warning)] text-xs">
                ⏸ 发现未完成的任务: {resumePrompt.intent.slice(0, 40)}
              </span>
              <button
                onClick={onResumePrompt}
                className="text-xs px-3 py-1 bg-[var(--semantic-warning)] text-[var(--cafe-accent-foreground)] rounded hover:opacity-90"
              >
                继续执行
              </button>
              <button
                onClick={onDismissResumePrompt}
                className="text-xs px-3 py-1 bg-[var(--bg-muted)] text-[var(--text)] rounded hover:bg-[var(--bg-muted)]"
              >
                忽略
              </button>
            </div>
          )}

          <ChatInput
            phase={helm.phase}
            onSubmit={handleChatSubmit}
            onReview={handleReview}
            onCommand={onCommand}
            onStop={helm.resetState}
            interactionMode={helm.interactionMode}
            onInteractionModeChange={helm.setInteractionMode}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            selectedWorkflow={null}
            onWorkflowChange={() => {}}
            attachments={diff.attachments}
            onRemoveAttachment={diff.removeAttachment}
            taskId={helm.taskId ?? undefined}
          />
        </>
      )}
    </>
  );
}
