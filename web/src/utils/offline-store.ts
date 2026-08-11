/**
 * IndexedDB 离线缓存（参考 clowder-ai offline-store，适配 flowforge 数据结构）
 *
 * 三级缓存目标：实现页面秒开 —— F5/冷启动时先从 IDB 读快照立即渲染，
 * 再异步 fetch API 用服务端真相刷新（cache-then-network）。
 *
 * 三个 object store：
 *   - threads              会话列表快照（单条记录，key='thread-list'）
 *   - thread-messages      每对话消息（上限 50 条，过滤 isStreaming 占位）
 *   - thread-active-state  每对话活跃状态（流式状态/所选模型，用于 F5 首屏还原）
 *
 * cachedFrom 标记：每条从 IDB 加载的消息盖 cachedFrom='idb' 戳，
 * hydration merge 层据此识别 "此消息来自缓存" 并在服务端真相到达后替换。
 * 持久化前会剥离该标记，避免污染快照。
 */

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { ChatMessage } from "@/stores/chatStore";
import type { Thread } from "@/stores/threadStore";

const DB_NAME = "flowforge-offline";
/**
 * Schema 版本：当持久化记录结构变化时递增（如 ChatMessage 字段语义变更）。
 * upgrade 钩子在版本跃迁时丢弃旧 store —— 快照非事实源，丢弃安全，下次
 * hydration 从 API 重建。NEVER decrement。
 */
const DB_VERSION = 1;
/** 每对话持久化消息上限，避免无界增长 */
const MAX_SNAPSHOT_MESSAGES = 50;

/**
 * 每对话持久化的活跃状态。F5 首屏在 fetchQueue 异步返回前先用它还原
 * "上次离开时此对话正在流式生成 / 选用某模型" 的状态，避免假 "空闲" 闪烁。
 */
export interface PersistedThreadActiveState {
  /** 该对话是否正在流式响应（离线前快照） */
  isStreaming: boolean;
  /** 该对话选中的模型 */
  selectedModel: string;
}

interface FlowForgeOfflineDB extends DBSchema {
  threads: {
    key: string;
    value: { id: string; threads: Thread[]; updatedAt: number };
  };
  "thread-messages": {
    key: string;
    value: {
      threadId: string;
      messages: ChatMessage[];
      updatedAt: number;
    };
  };
  "thread-active-state": {
    key: string;
    value: {
      threadId: string;
      isStreaming: boolean;
      selectedModel: string;
      updatedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<FlowForgeOfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FlowForgeOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FlowForgeOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // 版本跃迁：丢弃所有旧 store，避免旧契约的脏快照残留。
        // oldVersion === 0 = 全新安装，无旧数据可丢。
        if (oldVersion > 0) {
          for (const name of Array.from(db.objectStoreNames)) {
            db.deleteObjectStore(name);
          }
        }
        if (!db.objectStoreNames.contains("threads")) {
          db.createObjectStore("threads", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("thread-messages")) {
          db.createObjectStore("thread-messages", { keyPath: "threadId" });
        }
        if (!db.objectStoreNames.contains("thread-active-state")) {
          db.createObjectStore("thread-active-state", { keyPath: "threadId" });
        }
      },
    });
  }
  return dbPromise;
}

/** SSR / 非浏览器环境守卫：IndexedDB 仅在浏览器可用 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

// ── 会话列表缓存 ───────────────────────────────────────────────

/** 加载会话列表快照，用于冷启动/ F5 首屏立即渲染 */
export async function loadCachedThreads(): Promise<Thread[] | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDB();
    const record = await db.get("threads", "thread-list");
    return record?.threads ?? null;
  } catch {
    // IDB 故障不应阻塞首屏，降级为无缓存
    return null;
  }
}

/** 保存会话列表快照（API 刷新后写回） */
export async function saveThreadsToCache(threads: Thread[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDB();
    await db.put("threads", {
      id: "thread-list",
      threads,
      updatedAt: Date.now(),
    });
  } catch {
    // 写入失败不影响主流程
  }
}

// ── 消息缓存 ───────────────────────────────────────────────────

/**
 * 持久化前剥离 cachedFrom 标记。该标记是每次加载时盖的临时装饰，
 * 不应回写到快照，否则下次加载会在已有戳上再盖（无害但污染记录）。
 */
function stripPersistMarkers(m: ChatMessage): ChatMessage {
  if (m.cachedFrom === undefined) return m;
  const copy = { ...m };
  delete copy.cachedFrom;
  return copy;
}

/**
 * 保存某对话的消息快照。
 * - 过滤 isStreaming 占位（它们是进行中的 UI 状态，非持久历史）
 * - 截断到最后 MAX_SNAPSHOT_MESSAGES 条
 * - 剥离 cachedFrom 标记
 */
export async function saveMessagesToCache(
  threadId: string,
  messages: ChatMessage[],
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDB();
    const persistable = messages
      .filter((m) => !m.isStreaming)
      .map(stripPersistMarkers);
    const trimmed = persistable.slice(-MAX_SNAPSHOT_MESSAGES);
    await db.put("thread-messages", {
      threadId,
      messages: trimmed,
      updatedAt: Date.now(),
    });
  } catch {
    // 写入失败不影响主流程
  }
}

/**
 * 加载某对话的消息快照。每条消息盖 cachedFrom='idb' 戳，
 * 供 hydration merge 层在服务端真相到达后替换缓存数据。
 */
export async function loadThreadMessages(
  threadId: string,
): Promise<{ messages: ChatMessage[]; updatedAt: number } | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDB();
    const record = await db.get("thread-messages", threadId);
    if (!record) return null;
    // 纵深防御：清理旧客户端可能写入的 isStreaming 占位或泄漏的 cachedFrom
    const filtered = record.messages
      .filter((m) => !m.isStreaming)
      .map(stripPersistMarkers);
    return {
      messages: filtered.map((m) => ({ ...m, cachedFrom: "idb" as const })),
      updatedAt: record.updatedAt,
    };
  } catch {
    return null;
  }
}

// ── 活跃状态缓存 ───────────────────────────────────────────────

/**
 * 保存某对话的活跃状态快照（流式状态/所选模型）。
 * 由内存 store 在活跃状态变化时 write-through 调用。
 */
export async function saveActiveStateToCache(
  threadId: string,
  state: PersistedThreadActiveState,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDB();
    await db.put("thread-active-state", {
      threadId,
      isStreaming: state.isStreaming,
      selectedModel: state.selectedModel,
      updatedAt: Date.now(),
    });
  } catch {
    // 写入失败不影响主流程
  }
}

/**
 * 加载某对话的活跃状态快照。useChatHistory 在 fetchQueue 异步触发前
 * 先用它还原首屏，避免假 "空闲" 闪烁。
 */
export async function loadThreadActiveState(
  threadId: string,
): Promise<PersistedThreadActiveState | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDB();
    const record = await db.get("thread-active-state", threadId);
    if (!record) return null;
    return {
      isStreaming: record.isStreaming,
      selectedModel: record.selectedModel,
    };
  } catch {
    return null;
  }
}

// ── 维护工具 ───────────────────────────────────────────────────

/** 清空所有离线缓存（登出/重置时调用） */
export async function clearAllOfflineCache(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDB();
    const tx = db.transaction(
      ["threads", "thread-messages", "thread-active-state"],
      "readwrite",
    );
    tx.objectStore("threads").clear();
    tx.objectStore("thread-messages").clear();
    tx.objectStore("thread-active-state").clear();
    await tx.done;
  } catch {
    // 清空失败静默处理
  }
}

/** 清除某对话的消息与活跃状态缓存（会话删除时调用） */
export async function clearThreadCache(threadId: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDB();
    const tx = db.transaction(
      ["thread-messages", "thread-active-state"],
      "readwrite",
    );
    await tx.objectStore("thread-messages").delete(threadId);
    await tx.objectStore("thread-active-state").delete(threadId);
    await tx.done;
  } catch {
    // 清空失败静默处理
  }
}
