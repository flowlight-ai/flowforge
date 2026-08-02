"use client";

/**
 * useHelmPlan — Plan 任务执行计划状态 Hook（Phase 3 拆分）
 *
 * 管理 Plan 状态及所有 Plan 相关操作（确认/拒绝/重新生成/步骤编辑/更新）。
 *
 * 注意：使用 PlanPanel 的 Plan/PlanStep 类型（而非 helmPlanStore 的类型），
 * 因为 ChatStream / PlanPanel 等组件依赖 PlanPanel 的类型定义。
 *
 * 替代 HelmLayout 中的 useState：
 *   currentPlan / planLoading / planUpdateNotification / newlyAddedSteps
 */

import { useState, useCallback, useEffect } from "react";
import type { Plan, PlanStep } from "../PlanPanel";
import type { useHelmWebSocket } from "../../../hooks/useHelmWebSocket";

type HelmWS = ReturnType<typeof useHelmWebSocket>;

export function useHelmPlan(helm: HelmWS) {
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planUpdateNotification, setPlanUpdateNotification] = useState<
    string | null
  >(null);
  const [newlyAddedSteps, setNewlyAddedSteps] = useState<Set<number>>(
    new Set()
  );

  // 从 entries 中检测 plan 事件
  useEffect(() => {
    for (const entry of helm.entries) {
      if (entry.type === "system" && entry.data?._plan) {
        setCurrentPlan(entry.data._plan as Plan);
        setPlanLoading(false);
      }
    }
  }, [helm.entries]);

  const handlePlanConfirm = useCallback(
    async (planId: string, editedSteps?: PlanStep[]) => {
      if (!helm.taskId) return;
      try {
        const body: Record<string, unknown> = {
          plan_id: parseInt(planId) || 0,
        };
        if (editedSteps) {
          body.edited_steps = editedSteps;
        } else if (currentPlan && currentPlan.edited_steps.length > 0) {
          const steps = currentPlan.steps.filter((step) =>
            currentPlan.edited_steps.includes(step.name)
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
      } catch {
        // noop
      }
    },
    [helm.taskId, currentPlan]
  );

  const handlePlanReject = useCallback(
    async (planId: string) => {
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
      } catch {
        // noop
      }
    },
    [helm.taskId]
  );

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

  const handlePlanStepEdit = useCallback(
    (stepIndex: number, step: Partial<PlanStep>) => {
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
    },
    [helm.taskId, currentPlan]
  );

  const handlePlanStepDelete = useCallback(
    (stepIndex: number) => {
      if (!currentPlan) return;
      const steps = [...currentPlan.steps];
      steps.splice(stepIndex, 1);
      setCurrentPlan({
        ...currentPlan,
        steps,
        total_steps: steps.length,
      });
    },
    [currentPlan]
  );

  const handlePlanStepAdd = useCallback(
    (step: PlanStep) => {
      if (!currentPlan) return;
      const steps = [...currentPlan.steps, step];
      setCurrentPlan({
        ...currentPlan,
        steps,
        total_steps: steps.length,
      });
    },
    [currentPlan]
  );

  const handlePlanUpdate = useCallback(
    async (newMessage: string) => {
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
              content:
                typeof e.data === "string"
                  ? e.data
                  : JSON.stringify(e.data || ""),
            })),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            const updatedPlan = data.data as Plan;
            setCurrentPlan(updatedPlan);
            if (updatedPlan.steps.length > prevStepCount) {
              const newIndices = new Set<number>();
              for (let i = prevStepCount; i < updatedPlan.steps.length; i++) {
                newIndices.add(i);
              }
              setNewlyAddedSteps(newIndices);
              setTimeout(() => setNewlyAddedSteps(new Set()), 3000);
            }
            if (updatedPlan.update_reasoning) {
              setPlanUpdateNotification(updatedPlan.update_reasoning);
              setTimeout(() => setPlanUpdateNotification(null), 5000);
            }
          }
        }
      } catch (err) {
        console.error("[useHelmPlan] Plan update failed:", err);
      } finally {
        setPlanLoading(false);
      }
    },
    [helm.taskId, currentPlan, helm.entries]
  );

  return {
    currentPlan,
    setCurrentPlan,
    planLoading,
    setPlanLoading,
    planUpdateNotification,
    setPlanUpdateNotification,
    newlyAddedSteps,
    setNewlyAddedSteps,
    handlePlanConfirm,
    handlePlanReject,
    handlePlanRegenerate,
    handlePlanStepEdit,
    handlePlanStepDelete,
    handlePlanStepAdd,
    handlePlanUpdate,
  };
}
