/**
 * Store seams (session/settings/runtime/handoff) + in-memory contract
 * implementations, following the EP1-6 ports style. Real SQLite/Redis/host
 * stores are bound by the host in EP2.
 */

import type {
  CatId,
  RestoreActiveSessionResult,
  RuntimeSessionMetadata,
  SessionHandoffProposal,
  SessionRecord,
  SessionStatus,
} from '../contract/session.ts';
import type { SettingsRecord } from '../contract/settings.ts';

// ── Thread ────────────────────────────────────────────────────────────────

export interface Thread {
  id: string;
  title?: string;
  createdBy: string;
  projectPath?: string;
  externalRuntimeAnchorState?: { userId: string };
  /** Shared default thread marker (host sets on default/shared system threads). */
  shared?: boolean;
}

export interface IThreadStore {
  get(threadId: string): Promise<Thread | null> | Thread | null;
  list(userId?: string): Promise<Thread[]> | Thread[];
  create(userId: string, title?: string, projectPath?: string): { id: string } | Promise<{ id: string }>;
  updateProjectPath?(threadId: string, projectPath: string): void | Promise<void>;
}

export class MemoryThreadStore implements IThreadStore {
  private readonly threads = new Map<string, Thread>();
  private seq = 0;

  constructor(seed: Record<string, Thread> = {}) {
    for (const [id, thread] of Object.entries(seed)) {
      this.threads.set(id, { ...thread, id });
      this.seq = Math.max(this.seq, this.threads.size);
    }
  }

  get(threadId: string): Thread | null {
    return this.threads.get(threadId) ?? null;
  }
  list(userId?: string): Thread[] {
    const all = [...this.threads.values()];
    return userId ? all.filter((t) => t.createdBy === userId) : all;
  }
  create(userId: string, title?: string, projectPath?: string): { id: string } {
    this.seq += 1;
    const id = `thread_${this.seq}`;
    const record: Thread = { id, createdBy: userId };
    if (title !== undefined) record.title = title;
    if (projectPath !== undefined) record.projectPath = projectPath;
    this.threads.set(id, record);
    return { id };
  }
  updateProjectPath(threadId: string, projectPath: string): void {
    const t = this.threads.get(threadId);
    if (t) t.projectPath = projectPath;
  }
  put(thread: Thread): void {
    this.threads.set(thread.id, thread);
  }
}

// ── Session chain ────────────────────────────────────────────────────────

export interface RestoreActiveInput {
  targetSessionId: string;
  expectedActiveSessionId: string | null;
  displacedSealReason: string;
}

export interface ISessionChainStore {
  get(sessionId: string): Promise<SessionRecord | null> | SessionRecord | null;
  getActive(catId: CatId, threadId: string, userId: string): Promise<SessionRecord | null> | SessionRecord | null;
  getChain(catId: CatId, threadId: string, userId?: string): Promise<SessionRecord[]> | SessionRecord[];
  getChainByThread(threadId: string): Promise<SessionRecord[]> | SessionRecord[];
  bindCliSessionId(sessionId: string, cliSessionId: string): Promise<SessionRecord | null> | SessionRecord | null;
  getByCliSessionId(cliSessionId: string): Promise<SessionRecord | null> | SessionRecord | null;
  getOrCreateActive(input: {
    threadId: string;
    catId: CatId;
    userId: string;
  }): Promise<SessionRecord> | SessionRecord;
  restoreActiveSession(input: RestoreActiveInput): Promise<RestoreActiveSessionResult> | RestoreActiveSessionResult;
  /** Swap a session's status (used by the sealer memory impl / host seam). */
  update?(sessionId: string, status: SessionStatus): Promise<void> | void;
}

export class MemorySessionChainStore implements ISessionChainStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private seq = 0;

  constructor(seed: SessionRecord[] = []) {
    for (const s of seed) this.sessions.set(s.id, { ...s });
    this.seq = Math.max(...[0, ...seed.map((s) => s.seq)]);
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  get(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }
  getActive(catId: CatId, threadId: string, userId: string): SessionRecord | null {
    return (
      [...this.sessions.values()].find(
        (s) => s.catId === catId && s.threadId === threadId && s.userId === userId && s.status === 'active',
      ) ?? null
    );
  }
  getChain(catId: CatId, threadId: string, userId?: string): SessionRecord[] {
    const all = [...this.sessions.values()].filter((s) => s.catId === catId && s.threadId === threadId);
    return userId ? all.filter((s) => s.userId === userId) : all;
  }
  getChainByThread(threadId: string): SessionRecord[] {
    return [...this.sessions.values()].filter((s) => s.threadId === threadId);
  }
  bindCliSessionId(sessionId: string, cliSessionId: string): SessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const existing = [...this.sessions.values()].find((s) => s.cliSessionId === cliSessionId);
    if (existing && existing.id !== sessionId) return null;
    session.cliSessionId = cliSessionId;
    return { ...session };
  }
  getByCliSessionId(cliSessionId: string): SessionRecord | null {
    return [...this.sessions.values()].find((s) => s.cliSessionId === cliSessionId) ?? null;
  }
  getOrCreateActive(input: { threadId: string; catId: CatId; userId: string }): SessionRecord {
    const active = this.getActive(input.catId, input.threadId, input.userId);
    if (active) return { ...active };
    const session: SessionRecord = {
      id: `session_${this.nextSeq()}`,
      threadId: input.threadId,
      catId: input.catId,
      userId: input.userId,
      seq: this.seq,
      status: 'active',
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }
  restoreActiveSession(input: RestoreActiveInput): RestoreActiveSessionResult {
    const target = this.sessions.get(input.targetSessionId);
    if (!target) return { status: 'target_missing' };
    if (target.status !== 'sealed') {
      return { status: 'target_not_restorable', targetStatus: target.status };
    }
    const { catId, threadId, userId } = target;
    const before = this.getActive(catId, threadId, userId);
    if (before && before.id !== input.targetSessionId) {
      const expected = input.expectedActiveSessionId;
      if (expected == null) return { status: 'active_changed', activeSessionId: before.id };
      if (expected !== before.id) return { status: 'active_changed', activeSessionId: before.id };
      // displace the current active
      before.status = 'completed';
    }
    target.status = 'active';
    const displaced = before && before.id !== target.id ? before.id : undefined;
    const result: Extract<RestoreActiveSessionResult, { status: 'restored' }> = { status: 'restored', session: { ...target } };
    if (displaced !== undefined) result.displacedSessionId = displaced;
    return result;
  }
  update(sessionId: string, status: SessionStatus): void {
    const s = this.sessions.get(sessionId);
    if (s) s.status = status;
  }
  get size(): number {
    return this.sessions.size;
  }
}

/** Sealer seam (requestSeal/finalize); host binds the real reaper in EP2. */
export interface SessionSealer {
  requestSeal(input: { sessionId: string; reason: string }): Promise<{ accepted: boolean; status?: string }>;
  finalize(input: { sessionId: string }): Promise<{ sealed: boolean; clean: boolean }>;
}

export class MemorySessionSealer implements SessionSealer {
  constructor(
    private readonly modes: {
      requestFail?: boolean;
      finalizeSealed?: boolean;
      finalizeClean?: boolean;
    } = {},
  ) {}

  async requestSeal(input: { sessionId: string; reason: string }): Promise<{ accepted: boolean; status?: string }> {
    void input;
    if (this.modes.requestFail) return { accepted: false, status: 'active' };
    return { accepted: true, status: 'active' };
  }
  async finalize(input: { sessionId: string }): Promise<{ sealed: boolean; clean: boolean }> {
    void input;
    return { sealed: this.modes.finalizeSealed ?? true, clean: this.modes.finalizeClean ?? true };
  }
}

// ── Message ───────────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  threadId: string;
  content: string;
  timestamp: number;
}

export interface IMessageStore {
  getById(id: string): Promise<StoredMessage | null> | StoredMessage | null;
  append(input: { threadId: string; content: string; timestamp: number }): Promise<{ id: string }> | { id: string };
}

export class MemoryMessageStore implements IMessageStore {
  private readonly messages = new Map<string, StoredMessage>();
  private seq = 0;
  getById(id: string): StoredMessage | null {
    return this.messages.get(id) ?? null;
  }
  append(input: { threadId: string; content: string; timestamp: number }): { id: string } {
    this.seq += 1;
    const id = `msg_${this.seq}`;
    this.messages.set(id, { id, ...input });
    return { id };
  }
  get all(): StoredMessage[] {
    return [...this.messages.values()];
  }
}

// ── Handoff proposals ─────────────────────────────────────────────────────

export interface NewHandoffProposal {
  proposalId: string;
  catId: CatId;
  threadId: string;
  sourceSessionId?: string;
  done: string;
  nextSteps: string;
  worktreeBranch?: string;
  commits?: string[];
  gotchas?: string;
  clientRequestId?: string;
}

export interface ISessionHandoffProposalStore {
  create(input: NewHandoffProposal): Promise<SessionHandoffProposal> | SessionHandoffProposal;
  get(proposalId: string): Promise<SessionHandoffProposal | null> | SessionHandoffProposal | null;
  getByClientRequestId(clientRequestId: string, catId: CatId, threadId: string):
    | Promise<SessionHandoffProposal | null>
    | SessionHandoffProposal
    | null;
  listByThread(threadId: string): Promise<SessionHandoffProposal[]> | SessionHandoffProposal[];
  updateStatus(proposalId: string, status: SessionHandoffProposal['status']): void | Promise<void>;
}

export class MemoryHandoffProposalStore implements ISessionHandoffProposalStore {
  private readonly proposals = new Map<string, SessionHandoffProposal>();
  create(input: NewHandoffProposal): SessionHandoffProposal {
    const proposal: SessionHandoffProposal = {
      ...input,
      status: 'pending',
      persistedAt: Date.now(),
    };
    this.proposals.set(proposal.proposalId, proposal);
    return { ...proposal };
  }
  get(proposalId: string): SessionHandoffProposal | null {
    return this.proposals.get(proposalId) ?? null;
  }
  getByClientRequestId(clientRequestId: string, catId: CatId, threadId: string): SessionHandoffProposal | null {
    return (
      [...this.proposals.values()].find(
        (p) => p.clientRequestId === clientRequestId && p.catId === catId && p.threadId === threadId,
      ) ?? null
    );
  }
  listByThread(threadId: string): SessionHandoffProposal[] {
    return [...this.proposals.values()].filter((p) => p.threadId === threadId);
  }
  updateStatus(proposalId: string, status: SessionHandoffProposal['status']): void {
    const p = this.proposals.get(proposalId);
    if (p) p.status = status;
  }
}

// ── Runtime sessions ──────────────────────────────────────────────────────

export interface ExternalRuntimeSession {
  sessionId: string;
  threadId: string;
  catId?: CatId;
  runtime: string;
  runtimeSessionId: string;
  runtimeConversationId?: string;
  surface: 'cat-cafe-dispatch' | 'ide-direct';
  lastObservedAt: number;
  lifecycleState: string;
}

export interface IRuntimeSessionStore {
  getBySessionId(sessionId: string): Promise<RuntimeSessionMetadata | null> | RuntimeSessionMetadata | null;
  listExternal(opts: { surface?: 'cat-cafe-dispatch' | 'ide-direct'; catId?: CatId; limit?: number }):
    | Promise<ExternalRuntimeSession[]>
    | ExternalRuntimeSession[];
  registerExternal(input: ExternalRuntimeSession): void | Promise<void>;
  /** Native control: cursor delivery reads. */
  getCursor?(threadId: string, catId: CatId): Promise<{ seenCursor?: number } | null>;
  getSeenCursor?(threadId: string, catId: CatId): Promise<number | null>;
}

export class MemoryRuntimeSessionStore implements IRuntimeSessionStore {
  private readonly metadata = new Map<string, RuntimeSessionMetadata>();
  private readonly externals: ExternalRuntimeSession[] = [];

  getBySessionId(sessionId: string): RuntimeSessionMetadata | null {
    return this.metadata.get(sessionId) ?? null;
  }
  putMetadata(sessionId: string, metadata: RuntimeSessionMetadata): void {
    this.metadata.set(sessionId, metadata);
  }
  listExternal(opts: {
    surface?: 'cat-cafe-dispatch' | 'ide-direct';
    catId?: CatId;
    limit?: number;
  }): ExternalRuntimeSession[] {
    let list = this.externals;
    if (opts.surface) list = list.filter((e) => e.surface === opts.surface);
    if (opts.catId) list = list.filter((e) => e.catId === opts.catId);
    const limit = opts.limit ?? this.externals.length;
    return list.slice(0, Math.max(0, limit));
  }
  registerExternal(input: ExternalRuntimeSession): void {
    this.externals.push({ ...input });
  }
  async getCursor(threadId: string, catId: CatId): Promise<{ seenCursor?: number } | null> {
    void threadId;
    void catId;
    return null;
  }
  async getSeenCursor(threadId: string, catId: CatId): Promise<number | null> {
    void threadId;
    void catId;
    return null;
  }
}

// ── Small read models (transcript/search) ─────────────────────────────────

export interface IInvocationRecordStore {
  get(id: string): Promise<{ id: string } | null> | { id: string } | null;
}

export interface ITurnExecutionStore {
  get(id: string): Promise<{ id: string } | null> | { id: string } | null;
}

// ── Settings ──────────────────────────────────────────────────────────────

export type SettingsValidator = (key: string, value: unknown) => string | null;

export interface ISettingsStore {
  get(key: string, scope: string): Promise<SettingsRecord | null> | SettingsRecord | null;
  list(scope: string, userId?: string): Promise<SettingsRecord[]> | SettingsRecord[];
  set(record: SettingsRecord): void | Promise<void>;
  remove(key: string, scope: string): boolean | Promise<boolean>;
}

export class MemorySettingsStore implements ISettingsStore {
  private readonly records = new Map<string, SettingsRecord>();
  private version = 0;

  private keyOf(key: string, scope: string): string {
    return `${scope}:${key}`;
  }
  get(key: string, scope: string): SettingsRecord | null {
    return this.records.get(this.keyOf(key, scope)) ?? null;
  }
  list(scope: string, userId?: string): SettingsRecord[] {
    const all = [...this.records.values()].filter((r) => r.scope === scope);
    return userId ? all.filter((r) => r.updatedBy === userId) : all;
  }
  set(record: SettingsRecord): void {
    this.version += 1;
    this.records.set(this.keyOf(record.key, record.scope), { ...record, version: this.version });
  }
  remove(key: string, scope: string): boolean {
    return this.records.delete(this.keyOf(key, scope));
  }
}

// ── Audit / delivery cursor ───────────────────────────────────────────────

export interface AuditEventInput {
  type: string;
  threadId?: string;
  data: Record<string, unknown>;
}

export interface AuditLogPort {
  append(input: AuditEventInput): Promise<void> | void;
}

export class MemoryAuditLog implements AuditLogPort {
  readonly events: AuditEventInput[] = [];
  append(input: AuditEventInput): void {
    this.events.push(input);
  }
}

export interface IDeliveryCursorStore {
  getCursor(threadId: string, catId: CatId): Promise<{ seenCursor?: number } | null>;
  getSeenCursor(threadId: string, catId: CatId): Promise<number | null>;
}