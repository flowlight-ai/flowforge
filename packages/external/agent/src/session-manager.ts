/**
 * @flowforge/external-agent session-manager — 三方 Agent 会话管理（EX-009）。
 *
 * TS 重写自 flowforge/core/external_agent/session_manager.py：
 *   - SessionInfo: session_id（格式 sess-{provider}-{forgekin_id}-{ts}-{rand6}）/
 *     expires_at / shared_context
 *   - SessionManager: createSession(ttl=3600) / getSession（惰性过期清理）/
 *     extendSession / closeSession / listActiveSessions
 */

/** 会话信息（session_manager.py SessionInfo）。 */
export interface SessionInfo {
  /** 会话 ID（格式 sess-{provider}-{forgekin_id}-{ts}-{rand6}）。 */
  readonly session_id: string;
  /** Provider 名称。 */
  readonly provider_name: string;
  /** Forgekin ID。 */
  readonly forgekin_id: string;
  /** 创建时间戳（ISO 8601）。 */
  readonly created_at: string;
  /** 过期时间（epoch 毫秒）。 */
  readonly expires_at: number;
  /** 共享上下文。 */
  readonly shared_context: Record<string, unknown>;
}

/** 会话管理器（session_manager.py SessionManager）。 */
export class SessionManager {
  private readonly _sessions = new Map<string, SessionInfo>();

  /**
   * 创建会话（session_manager.py create_session）。
   *
   * @param providerName Provider 名称。
   * @param forgekinId Forgekin ID。
   * @param ttl 生存时间（秒，缺省 3600）。
   * @param sharedContext 共享上下文。
   */
  createSession(
    providerName: string,
    forgekinId: string,
    ttl = 3600,
    sharedContext: Record<string, unknown> = {},
  ): SessionInfo {
    const sessionId = `sess-${providerName}-${forgekinId}-${Date.now()}-${random6()}`;
    const now = Date.now();
    const session: SessionInfo = {
      session_id: sessionId,
      provider_name: providerName,
      forgekin_id: forgekinId,
      created_at: new Date(now).toISOString(),
      expires_at: now + ttl * 1000,
      shared_context: { ...sharedContext },
    };
    this._sessions.set(sessionId, session);
    return session;
  }

  /**
   * 获取会话（惰性过期清理：返回时若已过期则删除并返回 undefined）。
   */
  getSession(sessionId: string): SessionInfo | undefined {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    if (Date.now() > session.expires_at) {
      this._sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  /** 延长会话 TTL（session_manager.py extend_session）。 */
  extendSession(sessionId: string, extraTtlSeconds: number): SessionInfo | undefined {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    const extended: SessionInfo = {
      ...session,
      expires_at: Date.now() + extraTtlSeconds * 1000,
    };
    this._sessions.set(sessionId, extended);
    return extended;
  }

  /** 关闭会话（返回是否曾存在）。 */
  closeSession(sessionId: string): boolean {
    return this._sessions.delete(sessionId);
  }

  /** 列出活跃会话（惰性清理过期项后返回）。 */
  listActiveSessions(): SessionInfo[] {
    const now = Date.now();
    for (const [id, session] of [...this._sessions.entries()]) {
      if (now > session.expires_at) {
        this._sessions.delete(id);
      }
    }
    return [...this._sessions.values()];
  }

  /** 活跃会话数。 */
  get size(): number {
    return this.listActiveSessions().length;
  }
}

/** 生成 6 位随机字母数字（session_manager.py rand6）。 */
function random6(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
