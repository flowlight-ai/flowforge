/**
 * Chat Store (Zustand)
 *
 * 来源：clowder-ai/packages/web/src/stores/chatStore.ts（简化版）
 * 职责：管理聊天消息、流式响应、附件、Diff 文件
 *
 * 设计原则：
 *   - 替代 HelmLayout 中 50+ useState 中与 chat 相关的部分
 *   - 不持久化（消息由后端 /api/v1/threads 持久化）
 *   - 流式响应通过 patchMessage 增量更新
 */

import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number | string;
  /** 智能体 ID（如 wenxin/sherlock/luban 等 Forgekin） */
  persona?: string;
  /** 模型名称 */
  model?: string;
  /** 流式响应是否完成 */
  isStreaming?: boolean;
  /** T7 审核徽章 */
  llm_meta?: {
    t7_passed?: boolean;
    judge_score?: number;
    reviewer?: string;
  };
  /**
   * 离线缓存来源标记（参考 clowder-ai cachedFrom）。
   * 仅在从 IndexedDB 加载时盖 'idb' 戳，供 hydration merge 层识别
   * "此消息来自缓存"并在服务端真相到达后替换。不持久化到快照。
   */
  cachedFrom?: "idb";
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
}

export interface DiffFile {
  filePath: string;
  original: string;
  current: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
}

export interface ChatState {
  /** 当前会话消息列表 */
  messages: ChatMessage[];
  /** 用户消息（兼容 HelmLayout 旧字段） */
  userMessages: ChatMessage[];
  /** 附件列表 */
  attachments: Attachment[];
  /** Diff 文件列表（工具调用产生的文件变更） */
  diffFiles: DiffFile[];
  /** 是否正在流式响应 */
  isStreaming: boolean;
  /** 当前选中的模型 */
  selectedModel: string;
  /** 恢复提示（用于断点续传） */
  resumePrompt: { task_id: string; intent: string } | null;

  /** 添加消息 */
  addMessage: (message: ChatMessage) => void;
  /** 批量添加消息 */
  addMessages: (messages: ChatMessage[]) => void;
  /** 更新消息（用于流式响应） */
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  /** 移除消息 */
  removeMessage: (id: string) => void;
  /** 清空所有消息 */
  clearMessages: () => void;
  /** 设置流式状态 */
  setStreaming: (streaming: boolean) => void;
  /** 设置当前模型 */
  setSelectedModel: (model: string) => void;
  /** 添加附件 */
  addAttachment: (attachment: Attachment) => void;
  /** 移除附件 */
  removeAttachment: (id: string) => void;
  /** 添加 Diff 文件 */
  addDiffFile: (file: DiffFile) => void;
  /** 设置恢复提示 */
  setResumePrompt: (prompt: { task_id: string; intent: string } | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  userMessages: [],
  attachments: [],
  diffFiles: [],
  isStreaming: false,
  selectedModel: "auto",
  resumePrompt: null,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      // 同步到 userMessages（兼容旧字段，只保留 user role）
      ...(message.role === "user"
        ? { userMessages: [...state.userMessages, message] }
        : {}),
    })),

  addMessages: (newMessages) =>
    set((state) => ({
      messages: [...state.messages, ...newMessages],
      userMessages: [
        ...state.userMessages,
        ...newMessages.filter((m) => m.role === "user"),
      ],
    })),

  patchMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    })),

  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
      userMessages: state.userMessages.filter((m) => m.id !== id),
    })),

  clearMessages: () => set({ messages: [], userMessages: [] }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),

  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    })),

  addDiffFile: (file) =>
    set((state) => {
      // 按 filePath 去重合并
      const existing = state.diffFiles.find((f) => f.filePath === file.filePath);
      if (existing) {
        return {
          diffFiles: state.diffFiles.map((f) =>
            f.filePath === file.filePath ? file : f
          ),
        };
      }
      return { diffFiles: [...state.diffFiles, file] };
    }),

  setResumePrompt: (prompt) => set({ resumePrompt: prompt }),
}));
