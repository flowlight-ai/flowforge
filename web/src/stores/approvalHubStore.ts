/**
 * Approval Hub Store (Zustand)
 *
 * 职责：管理审批中心的待审批项列表、badge 计数
 *
 * 用途：
 *   - ActivityBar 右下角审批铃铛的 badge 数字
 *   - ApprovalHubDrawer 的待审批列表
 *   - 通过 SSE/WebSocket 实时更新
 */

import { create } from "zustand";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalItem {
  /** 审批项 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 提议者（如 forgekin_id） */
  proposer?: string;
  /** 提议时间 */
  proposed_at: string;
  /** 状态 */
  status: ApprovalStatus;
  /** 类型（如 framework_change / self_modify / external_call） */
  kind?: string;
  /** 风险等级（low / medium / high） */
  risk_level?: "low" | "medium" | "high";
  /** 详情 URL */
  detail_url?: string;
}

export interface ApprovalHubState {
  /** 待审批项列表 */
  pending: ApprovalItem[];
  /** 待审批数量（badge） */
  count: number;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最后更新时间 */
  lastUpdated: number | null;
  /** 是否已订阅 SSE（避免重复订阅） */
  subscribed: boolean;
  /** 抽屉是否打开 */
  isOpen: boolean;

  /** 设置待审批列表 */
  setPending: (items: ApprovalItem[]) => void;
  /** 添加审批项 */
  addPending: (item: ApprovalItem) => void;
  /** 更新审批项状态 */
  updateItemStatus: (id: string, status: ApprovalStatus) => void;
  /** 移除审批项 */
  removeItem: (id: string) => void;
  /** 从后端拉取待审批列表 */
  fetchPending: () => Promise<void>;
  /** 批准 */
  approve: (id: string) => Promise<boolean>;
  /** 拒绝 */
  reject: (id: string, reason?: string) => Promise<boolean>;
  /** 标记已订阅 */
  setSubscribed: (subscribed: boolean) => void;
  /** 打开抽屉 */
  open: () => void;
  /** 关闭抽屉 */
  close: () => void;
  /** 切换抽屉 */
  toggle: () => void;
  /** 重置 */
  reset: () => void;
}

export const useApprovalHubStore = create<ApprovalHubState>((set, get) => ({
  pending: [],
  count: 0,
  loading: false,
  error: null,
  lastUpdated: null,
  subscribed: false,
  isOpen: false,

  setPending: (items) =>
    set({
      pending: items,
      count: items.filter((i) => i.status === "pending").length,
      lastUpdated: Date.now(),
    }),

  addPending: (item) =>
    set((state) => ({
      pending: [item, ...state.pending],
      count: item.status === "pending" ? state.count + 1 : state.count,
    })),

  updateItemStatus: (id, status) =>
    set((state) => {
      const oldItem = state.pending.find((i) => i.id === id);
      const oldPending = oldItem?.status === "pending";
      const newPending = status === "pending";
      return {
        pending: state.pending.map((i) =>
          i.id === id ? { ...i, status } : i
        ),
        count: state.count + (newPending ? 1 : 0) - (oldPending ? 1 : 0),
      };
    }),

  removeItem: (id) =>
    set((state) => {
      const item = state.pending.find((i) => i.id === id);
      const wasPending = item?.status === "pending";
      return {
        pending: state.pending.filter((i) => i.id !== id),
        count: wasPending ? state.count - 1 : state.count,
      };
    }),

  fetchPending: async () => {
    set({ loading: true, error: null });
    try {
      const r = await fetch("/api/v1/approvals?status=pending");
      if (!r.ok) {
        set({ loading: false, error: `HTTP ${r.status}` });
        return;
      }
      const data = await r.json();
      const items = (data?.items || data?.data || []) as ApprovalItem[];
      get().setPending(items);
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  approve: async (id) => {
    try {
      const r = await fetch(`/api/v1/approvals/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) return false;
      get().updateItemStatus(id, "approved");
      return true;
    } catch {
      return false;
    }
  },

  reject: async (id, reason) => {
    try {
      const r = await fetch(`/api/v1/approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || "" }),
      });
      if (!r.ok) return false;
      get().updateItemStatus(id, "rejected");
      return true;
    } catch {
      return false;
    }
  },

  setSubscribed: (subscribed) => set({ subscribed }),

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  reset: () =>
    set({
      pending: [],
      count: 0,
      loading: false,
      error: null,
      lastUpdated: null,
      subscribed: false,
      isOpen: false,
    }),
}));
