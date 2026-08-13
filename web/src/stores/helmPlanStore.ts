/**
 * Helm Plan Store (Zustand)
 *
 * 职责：管理 Plan（任务执行计划）状态
 *
 * 替代 HelmLayout 中的 useState：
 *   - currentPlan / planLoading / planUpdateNotification
 *   - newlyAddedSteps
 */

import { create } from "zustand";

export interface PlanStep {
  name: string;
  description?: string;
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
  /** 期望输出 */
  expected_output?: string;
  /** 实际输出 */
  actual_output?: string;
  /** 工具调用 */
  tool?: string;
  /** 开始/结束时间戳 */
  started_at?: number;
  ended_at?: number;
}

export interface Plan {
  /** Plan ID（后端返回） */
  id: string | number;
  /** Plan 标题 */
  title?: string;
  /** 步骤列表 */
  steps: PlanStep[];
  /** 用户编辑过的步骤名（用于 diff 标记） */
  edited_steps: string[];
  /** Plan 创建时间 */
  created_at?: number;
  /** Plan 状态 */
  status?: "draft" | "confirmed" | "executing" | "completed" | "rejected";
}

export interface HelmPlanState {
  /** 当前 Plan */
  currentPlan: Plan | null;
  /** 是否正在加载 Plan */
  planLoading: boolean;
  /** Plan 更新通知（toast 用的临时消息） */
  planUpdateNotification: string | null;
  /** 新增的步骤索引集合（用于高亮显示） */
  newlyAddedSteps: Set<number>;

  /** 设置当前 Plan */
  setCurrentPlan: (plan: Plan | null) => void;
  /** 设置 Plan 加载状态 */
  setPlanLoading: (loading: boolean) => void;
  /** 显示更新通知 */
  showPlanUpdateNotification: (msg: string) => void;
  /** 清除更新通知 */
  clearPlanUpdateNotification: () => void;
  /** 添加新步骤索引到高亮集合 */
  addNewlyAddedStep: (index: number) => void;
  /** 清空高亮集合 */
  clearNewlyAddedSteps: () => void;
  /** 确认 Plan（调用后端 API） */
  confirmPlan: (taskId: string, planId: string, editedSteps?: PlanStep[]) => Promise<boolean>;
  /** 拒绝 Plan（调用后端 API） */
  rejectPlan: (taskId: string, planId: string) => Promise<boolean>;
  /** 重置 */
  reset: () => void;
}

export const useHelmPlanStore = create<HelmPlanState>((set, get) => ({
  currentPlan: null,
  planLoading: false,
  planUpdateNotification: null,
  newlyAddedSteps: new Set(),

  setCurrentPlan: (plan) => set({ currentPlan: plan }),

  setPlanLoading: (loading) => set({ planLoading: loading }),

  showPlanUpdateNotification: (msg) => set({ planUpdateNotification: msg }),

  clearPlanUpdateNotification: () => set({ planUpdateNotification: null }),

  addNewlyAddedStep: (index) =>
    set((state) => {
      const next = new Set(state.newlyAddedSteps);
      next.add(index);
      return { newlyAddedSteps: next };
    }),

  clearNewlyAddedSteps: () => set({ newlyAddedSteps: new Set() }),

  confirmPlan: async (taskId, planId, editedSteps) => {
    if (!taskId) return false;
    try {
      const body: Record<string, unknown> = {
        // 数字 ID 转 number，字符串 ID 原样透传（避免 parseInt 非数字 → NaN/0）
        plan_id: /^\d+$/.test(planId) ? parseInt(planId, 10) : planId,
      };
      if (editedSteps && editedSteps.length > 0) {
        body.edited_steps = editedSteps;
      } else {
        const { currentPlan } = get();
        if (currentPlan && currentPlan.edited_steps.length > 0) {
          const steps = currentPlan.steps.filter((step) =>
            currentPlan.edited_steps.includes(step.name)
          );
          if (steps.length > 0) body.edited_steps = steps;
        }
      }
      const r = await fetch(`/api/v1/tasks/${taskId}/plan/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.data) {
        get().setCurrentPlan(data.data);
      }
      return true;
    } catch {
      return false;
    }
  },

  rejectPlan: async (taskId, planId) => {
    if (!taskId) return false;
    try {
      const r = await fetch(`/api/v1/tasks/${taskId}/plan/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.data) {
        get().setCurrentPlan(data.data);
      }
      return true;
    } catch {
      return false;
    }
  },

  reset: () =>
    set({
      currentPlan: null,
      planLoading: false,
      planUpdateNotification: null,
      newlyAddedSteps: new Set(),
    }),
}));
