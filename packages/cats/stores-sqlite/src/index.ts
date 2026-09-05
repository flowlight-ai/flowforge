/**
 * SqliteStoresBackend — Cordis plugin that mounts all SQLite store
 * implementations and registers them with the {@link CatStores} aggregate
 * under the `sqlite` backend name（批次 6.5，T4.2.6）.
 *
 * dsh 范式（对齐 `@flowforge/session-persistence-sqlite`）：static inject =
 * ['catStores']、static Config（Schemastery）、constructor 内打开
 * `node:sqlite` DatabaseSync（`:memory:` 支持 + 父目录 mkdir）、schema 初始化、
 * 实例化 21 个 store、`ctx.effect` 注册到 `catStores.registerBackend('sqlite',
 * …)`，fiber dispose 时注销并 close db。
 *
 * Mount in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'
 * - name: '@flowforge/cats-stores-sqlite'
 *   config:
 *     path: data/cats.db
 * ```
 *
 * @module @flowforge/cats-stores-sqlite
 */

import { Context, Service } from '@flowforge/cordis'
import z from '@flowforge/schemastery'
import type { CatStores } from '@flowforge/cats-stores'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { type JournalMode, openDatabase } from './schema.ts'
import { SqliteBacklogStore } from './sqlite/backlog-store.ts'
import { SqliteDeliveryCursorStore } from './sqlite/delivery-cursor-store.ts'
import {
  SqliteDossierDistillationProposalStore,
  SqliteDossierObservationStore,
  SqliteMemoryGovernanceStore,
} from './sqlite/dossier-stores.ts'
import { SqliteInvocationRecordStore } from './sqlite/invocation-record-store.ts'
import { SqliteMemoryStore } from './sqlite/memory-store.ts'
import { SqliteMessageStore } from './sqlite/message-store.ts'
import { SqliteProfileUpdateProposalStore } from './sqlite/profile-update-proposal-store.ts'
import { SqliteProposalStore } from './sqlite/proposal-store.ts'
import { SqliteSessionChainStore } from './sqlite/session-chain-store.ts'
import { SqliteSessionHandoffProposalStore } from './sqlite/session-handoff-proposal-store.ts'
import { SqliteSignalArticleStore } from './sqlite/signal-article-store.ts'
import { SqliteSummaryStore } from './sqlite/summary-store.ts'
import { SqliteTaskStore } from './sqlite/task-store.ts'
import { SqliteTaskManagedWorkRegistrationStore, SqliteTaskProgressStore } from './sqlite/task-stores.ts'
import { SqliteThreadMemoryStore, SqliteVoteStore } from './sqlite/thread-memory-store.ts'
import { SqliteThreadReadStateStore } from './sqlite/read-state-store.ts'
import { SqliteThreadStore } from './sqlite/thread-store.ts'

export { SCHEMA_VERSION } from './schema.ts'
export type { JournalMode } from './schema.ts'

/** Backend name registered with the CatStores aggregate. */
export const SQLITE_BACKEND_NAME = 'sqlite'

/** Valid `journal_mode` pragmas (kept in sync with {@link JournalMode}). */
const JOURNAL_MODES: readonly JournalMode[] = ['wal', 'delete', 'truncate', 'persist']

/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests); any other relative path is resolved
   * against the process CWD, and missing parent directories are created.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) is the recorded
   * durability model; rollback-journal modes exist for filesystems where
   * WAL's shared-memory files do not work (network mounts).
   */
  journalMode?: JournalMode
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * SQLite backend service for cats-stores. Mounted via
     * `ctx.plugin(SqliteStoresBackend, { path, journalMode })`. Exposes the
     * concrete store instances for tests / direct inspection.
     */
    catStoresSqlite: SqliteStoresBackend
  }
}

/**
 * The SQLite durable stores backend. Opens ONE `DatabaseSync` shared by all
 * nine stores; write-atomic sequences (CAS, seq allocation, dedup) run inside
 * `BEGIN IMMEDIATE` transactions — the Redis Lua replacement.
 */
export class SqliteStoresBackend extends Service {
  static inject = ['catStores']

  /** 注入的 CatStores 聚合服务（见 static inject）。 */
  readonly catStores!: CatStores

  static Config: z<Config> = z.object({
    path: z.string().default('data/cats.db'),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  })

  override readonly name = SQLITE_BACKEND_NAME

  readonly db: DatabaseSync
  readonly messageStore: SqliteMessageStore
  readonly threadStore: SqliteThreadStore
  readonly taskStore: SqliteTaskStore
  readonly backlogStore: SqliteBacklogStore
  readonly memoryStore: SqliteMemoryStore
  readonly invocationRecordStore: SqliteInvocationRecordStore
  readonly sessionChainStore: SqliteSessionChainStore
  readonly deliveryCursorStore: SqliteDeliveryCursorStore
  readonly summaryStore: SqliteSummaryStore
  // 批次52：其余 12 个 full-contract store
  readonly threadReadStateStore: SqliteThreadReadStateStore
  readonly voteStore: SqliteVoteStore
  readonly threadMemoryStore: SqliteThreadMemoryStore
  readonly taskProgressStore: SqliteTaskProgressStore
  readonly taskManagedWorkRegistrationStore: SqliteTaskManagedWorkRegistrationStore
  readonly signalArticleStore: SqliteSignalArticleStore
  readonly dossierDistillationProposalStore: SqliteDossierDistillationProposalStore
  readonly dossierObservationStore: SqliteDossierObservationStore
  readonly memoryGovernanceStore: SqliteMemoryGovernanceStore
  readonly proposalStore: SqliteProposalStore
  readonly profileUpdateProposalStore: SqliteProfileUpdateProposalStore
  readonly sessionHandoffProposalStore: SqliteSessionHandoffProposalStore

  constructor(ctx: Context, config: Config) {
    super(ctx, 'catStoresSqlite')
    const journalMode = config.journalMode ?? 'wal'
    if (!JOURNAL_MODES.includes(journalMode)) {
      throw new Error(
        `invalid journalMode "${journalMode}"; expected one of ${JOURNAL_MODES.join('/')}`,
      )
    }
    const actual = config.path === ':memory:' ? ':memory:' : resolve(config.path)
    if (actual !== ':memory:') {
      mkdirSync(dirname(actual), { recursive: true })
    }
    this.db = openDatabase(actual, journalMode)

    this.messageStore = new SqliteMessageStore(this.db)
    this.threadStore = new SqliteThreadStore(this.db)
    this.taskStore = new SqliteTaskStore(this.db)
    this.backlogStore = new SqliteBacklogStore(this.db)
    this.memoryStore = new SqliteMemoryStore(this.db)
    this.invocationRecordStore = new SqliteInvocationRecordStore(this.db)
    this.sessionChainStore = new SqliteSessionChainStore(this.db)
    this.deliveryCursorStore = new SqliteDeliveryCursorStore(this.db)
    this.summaryStore = new SqliteSummaryStore(this.db)
    this.threadReadStateStore = new SqliteThreadReadStateStore(this.db)
    this.voteStore = new SqliteVoteStore(this.db)
    this.threadMemoryStore = new SqliteThreadMemoryStore(this.db)
    this.taskProgressStore = new SqliteTaskProgressStore(this.db)
    this.taskManagedWorkRegistrationStore = new SqliteTaskManagedWorkRegistrationStore(this.db)
    this.signalArticleStore = new SqliteSignalArticleStore(this.db)
    this.dossierDistillationProposalStore = new SqliteDossierDistillationProposalStore(this.db)
    this.dossierObservationStore = new SqliteDossierObservationStore(this.db)
    this.memoryGovernanceStore = new SqliteMemoryGovernanceStore(this.db)
    this.proposalStore = new SqliteProposalStore(this.db)
    this.profileUpdateProposalStore = new SqliteProfileUpdateProposalStore(this.db)
    this.sessionHandoffProposalStore = new SqliteSessionHandoffProposalStore(this.db)

    ctx.effect(() => {
      ctx.catStores.registerBackend(SQLITE_BACKEND_NAME, {
        messageStore: this.messageStore,
        threadStore: this.threadStore,
        taskStore: this.taskStore,
        backlogStore: this.backlogStore,
        memoryStore: this.memoryStore,
        invocationRecordStore: this.invocationRecordStore,
        sessionChainStore: this.sessionChainStore,
        deliveryCursorStore: this.deliveryCursorStore,
        summaryStore: this.summaryStore,
        threadReadStateStore: this.threadReadStateStore,
        voteStore: this.voteStore,
        threadMemoryStore: this.threadMemoryStore,
        taskProgressStore: this.taskProgressStore,
        taskManagedWorkRegistrationStore: this.taskManagedWorkRegistrationStore,
        signalArticleStore: this.signalArticleStore,
        dossierDistillationProposalStore: this.dossierDistillationProposalStore,
        dossierObservationStore: this.dossierObservationStore,
        memoryGovernanceStore: this.memoryGovernanceStore,
        proposalStore: this.proposalStore,
        profileUpdateProposalStore: this.profileUpdateProposalStore,
        sessionHandoffProposalStore: this.sessionHandoffProposalStore,
      })
      return () => {
        ctx.catStores.unregisterBackend(SQLITE_BACKEND_NAME)
      }
    }, 'catStoresSqlite.register')

    ctx.effect(() => {
      return () => {
        this.db.close()
      }
    }, 'catStoresSqlite.close')
  }
}

export default SqliteStoresBackend
