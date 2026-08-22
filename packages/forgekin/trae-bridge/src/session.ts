/**
 * @flowforge/forgekin-trae-bridge — 会话管理（TS 移植自 `llm/trae/session.py`）
 *
 * 管理 Trae LLM 客户端的会话上下文，支持通过注入的 SessionMemoryStore
 * 持久化（对齐 Python MemoryManager 依赖注入，铁律 3/4：不直接操作数据库）。
 */
import type { BridgeMessage } from './models.js';
import type { TraeClientConfig } from './config.js';

/** MemoryManager 的 short_term 存储使用的 key 前缀 */
const SESSION_KEY_PREFIX = 'trae_session:';

/** 会话持久化存储接口（对齐 Python MemoryManager save/retrieve 关键接口） */
export interface SessionMemoryStore {
  save(scope: string, key: string, value: unknown): Promise<void>;
  retrieve(scope: string, key: string): Promise<unknown[]>;
}

/** 会话序列化数据 */
export interface TraeSessionData {
  session_id: string;
  messages: BridgeMessage[];
  created_at: number;
  updated_at: number;
}

/** Trae LLM 会话上下文（维护消息历史 + 可选持久化） */
export class TraeSession {
  readonly sessionId: string;
  private readonly config: TraeClientConfig;
  private messages: BridgeMessage[] = [];
  private createdAt: number;
  private updatedAt: number;
  private memoryStore: SessionMemoryStore | null = null;

  constructor(sessionId: string, config: TraeClientConfig) {
    this.sessionId = sessionId;
    this.config = config;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /** 添加消息到会话历史（role 非法时抛错，对齐 Python ValueError） */
  addMessage(role: string, content: string): void {
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new TypeError(`role 必须是 system/user/assistant，得到: ${role}`);
    }
    this.messages.push({ role, content });
    this.updatedAt = Date.now();
  }

  /** 获取会话上下文（消息列表的副本） */
  getContext(): BridgeMessage[] {
    return [...this.messages];
  }

  /** 清除会话历史 */
  clear(): void {
    this.messages = [];
    this.updatedAt = Date.now();
  }

  /** 设置持久化存储（依赖注入，铁律 3） */
  setMemoryStore(memoryStore: SessionMemoryStore): void {
    this.memoryStore = memoryStore;
  }

  /** 持久化会话（未配置 session_persistence 或未注入存储时跳过；失败仅吞掉） */
  async save(): Promise<void> {
    if (!this.config.session_persistence) {
      return;
    }
    if (this.memoryStore === null) {
      return;
    }
    try {
      const data: TraeSessionData = {
        session_id: this.sessionId,
        messages: this.messages,
        created_at: this.createdAt,
        updated_at: this.updatedAt,
      };
      await this.memoryStore.save('short_term', `${SESSION_KEY_PREFIX}${this.sessionId}`, data);
    } catch {
      // 对齐 Python：持久化失败仅 warning，不影响主流程
    }
  }

  /** 从持久化加载会话（未配置/未注入时跳过；失败仅吞掉） */
  async load(): Promise<void> {
    if (!this.config.session_persistence) {
      return;
    }
    if (this.memoryStore === null) {
      return;
    }
    try {
      const results = await this.memoryStore.retrieve(
        'short_term',
        `${SESSION_KEY_PREFIX}${this.sessionId}`,
      );
      if (results.length > 0) {
        // retrieve 返回的是搜索结果列表，取第一个匹配（对齐 Python results[0]）
        const item = results[0];
        let data: unknown = item;
        if (typeof item === 'object' && item !== null && 'value' in item) {
          data = (item as Record<string, unknown>)['value'];
        }
        if (typeof data === 'object' && data !== null && 'messages' in data) {
          const record = data as Record<string, unknown>;
          const messages = record['messages'];
          if (Array.isArray(messages)) {
            this.messages = messages as BridgeMessage[];
          }
          if (typeof record['created_at'] === 'number') {
            this.createdAt = record['created_at'];
          }
          if (typeof record['updated_at'] === 'number') {
            this.updatedAt = record['updated_at'];
          }
        }
      }
    } catch {
      // 对齐 Python：加载失败仅 warning
    }
  }

  /** 序列化会话为字典 */
  toDict(): TraeSessionData {
    return {
      session_id: this.sessionId,
      messages: this.messages,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }

  /** 从字典反序列化会话 */
  static fromDict(data: TraeSessionData, config: TraeClientConfig): TraeSession {
    const session = new TraeSession(data.session_id, config);
    session.messages = data.messages ?? [];
    session.createdAt = data.created_at ?? Date.now();
    session.updatedAt = data.updated_at ?? Date.now();
    return session;
  }
}

/** Trae LLM 会话管理器（管理多个 TraeSession 实例） */
export class TraeSessionManager {
  private readonly config: TraeClientConfig;
  private readonly sessions: Map<string, TraeSession> = new Map();
  private memoryStore: SessionMemoryStore | null = null;

  constructor(config: TraeClientConfig) {
    this.config = config;
  }

  /** 注入持久化存储（设置后所有新建会话自动使用） */
  setMemoryStore(memoryStore: SessionMemoryStore): void {
    this.memoryStore = memoryStore;
  }

  /** 创建新会话（已存在时返回现有会话，对齐 Python create_session） */
  createSession(sessionId: string): TraeSession {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const session = new TraeSession(sessionId, this.config);
    if (this.memoryStore !== null) {
      session.setMemoryStore(this.memoryStore);
    }
    this.sessions.set(sessionId, session);
    return session;
  }

  /** 获取会话（不存在返回 null） */
  getSession(sessionId: string): TraeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** 关闭会话（从内存中移除，不删除已持久化的数据） */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** 列出所有活跃会话 ID */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /** 关闭所有会话 */
  async closeAll(): Promise<void> {
    this.sessions.clear();
  }
}
