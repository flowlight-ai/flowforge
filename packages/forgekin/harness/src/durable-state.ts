/**
 * durable-state — Harness 第 1 层：感知现实（F008 durable-state-surfaces）。
 *
 * 移植 `harness/durable_state.py`（TS 重写）：
 * 把跨 session / 跨 agent / 跨时间持续存在的"现实状态"通过统一接口暴露，
 * 解决开放环境失败模式 1（感知失败：agent 不知道现实发生了什么）。
 *
 * - DurableState：单条记录的版本化快照（含 last_writer 审计追责）
 * - DurableStateSurface：抽象接口（read/write/delete 三不变量）
 * - SqliteDurableState：SQLite 后端（node:sqlite，WAL + 乐观锁 version）
 * - GitDurableState：Git 后端（每个 key 一个 JSON 文件 + commit 审计）
 *
 * 关键不变量：
 *   1. read 不存在时返回 undefined（不抛异常）
 *   2. write 自动版本自增（乐观锁）
 *   3. delete 返回是否删除成功（不存在返回 false）
 *
 * @module @flowforge/forgekin-harness
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Durable State 单条记录 —— Built-to-Persist（对应 roleagent.md §1.2 现实状态层）。 */
export interface DurableState {
  /** 记录唯一 ID（`ds-` + uuid4 前 12 位）。 */
  readonly state_id: string;
  /** 状态键（业务语义标识，如 `task:123:status`）。 */
  readonly key: string;
  /** 状态值（任意可 JSON 序列化的数据）。 */
  readonly value: unknown;
  /** 乐观锁版本号（每次 write 自增，>= 1）。 */
  readonly version: number;
  /** 最后写入者标识（agent_id / operator_id）。 */
  readonly last_writer: string;
  /** 创建时间 ISO 8601。 */
  readonly created_at: string;
  /** 最后更新时间 ISO 8601。 */
  readonly updated_at: string;
}

/** 生成新的 DurableState 记录。 */
export function createDurableState(
  key: string,
  value: unknown,
  writer: string,
  now: string = new Date().toISOString(),
): DurableState {
  return {
    state_id: `ds-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    key,
    value,
    version: 1,
    last_writer: writer,
    created_at: now,
    updated_at: now,
  };
}

/** Durable State Surface 抽象接口 —— Built-to-Persist（统一读写接口）。 */
export interface DurableStateSurface {
  /** 读取指定 key 的当前值；不存在时返回 undefined。 */
  read(key: string): Promise<unknown | undefined>;
  /** 写入状态（upsert + 版本自增），返回写入后的记录。 */
  write(key: string, value: unknown, writer: string): Promise<DurableState>;
  /** 删除指定 key；返回是否删除成功（不存在返回 false）。 */
  delete(key: string): Promise<boolean>;
}

/** SQLite 后端 DurableState 实现 —— Built-to-Persist（单文件部署、零运维）。 */
export class SqliteDurableState implements DurableStateSurface {
  readonly dbPath: string;
  readonly tableName: string;
  readonly walMode: boolean;

  private readonly db: DatabaseSync;

  constructor(dbPath: string, tableName = 'durable_state', walMode = true) {
    this.dbPath = dbPath;
    this.tableName = tableName;
    this.walMode = walMode;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    if (walMode) {
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.exec('PRAGMA synchronous=NORMAL;');
    }
    this.initSchema();
  }

  /** 初始化表结构（幂等）。 */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        state_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        last_writer TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_writer ON ${this.tableName}(last_writer);`,
    );
  }

  /** 将 SQLite 行映射为 DurableState。 */
  private rowToState(row: {
    state_id: string;
    key: string;
    value_json: string;
    version: number;
    last_writer: string;
    created_at: string;
    updated_at: string;
  }): DurableState {
    return {
      state_id: row.state_id,
      key: row.key,
      value: JSON.parse(row.value_json) as unknown,
      version: row.version,
      last_writer: row.last_writer,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async read(key: string): Promise<unknown | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE key = ?;`)
      .get(key) as
      | {
          state_id: string;
          key: string;
          value_json: string;
          version: number;
          last_writer: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return row ? this.rowToState(row).value : undefined;
  }

  async write(key: string, value: unknown, writer: string): Promise<DurableState> {
    const valueJson = JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? String(v) : v,
    );
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE key = ?;`)
      .get(key) as
      | {
          state_id: string;
          key: string;
          value_json: string;
          version: number;
          last_writer: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    let state: DurableState;
    if (!existing) {
      state = createDurableState(key, value, writer, now);
      this.db
        .prepare(
          `INSERT INTO ${this.tableName}
           (key, state_id, value_json, version, last_writer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
        )
        .run(
          state.key,
          state.state_id,
          valueJson,
          state.version,
          state.last_writer,
          state.created_at,
          state.updated_at,
        );
    } else {
      const old = this.rowToState(existing);
      state = {
        state_id: old.state_id,
        key,
        value,
        version: old.version + 1,
        last_writer: writer,
        created_at: old.created_at,
        updated_at: now,
      };
      this.db
        .prepare(
          `UPDATE ${this.tableName}
           SET value_json = ?, version = ?, last_writer = ?, updated_at = ?
           WHERE key = ?;`,
        )
        .run(valueJson, state.version, state.last_writer, state.updated_at, key);
    }
    return state;
  }

  async delete(key: string): Promise<boolean> {
    const result = this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE key = ?;`)
      .run(key);
    return result.changes > 0;
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }
}

/** Git 后端 DurableState 实现 —— Built-to-Persist（版本审计 / 回滚 / diff）。 */
export class GitDurableState implements DurableStateSurface {
  readonly repoPath: string;
  readonly branch: string;
  readonly authorName: string;
  readonly authorEmail: string;

  constructor(
    repoPath: string,
    branch = 'main',
    authorName = 'flowforge-harness-v7',
    authorEmail = 'harness-v7@flowforge.local',
  ) {
    this.repoPath = repoPath;
    this.branch = branch;
    this.authorName = authorName;
    this.authorEmail = authorEmail;
    this.initRepo();
  }

  /** 初始化 Git 仓库（已存在则跳过）。 */
  private initRepo(): void {
    mkdirSync(this.repoPath, { recursive: true });
    if (!existsSync(join(this.repoPath, '.git'))) {
      this.runGit(['init', '-b', this.branch]);
      this.runGit(['config', 'user.name', this.authorName]);
      this.runGit(['config', 'user.email', this.authorEmail]);
      writeFileSync(
        join(this.repoPath, 'README.md'),
        '# Durable State Repository\n\nAuto-initialized by GitDurableState (harness).\n',
        'utf8',
      );
      this.runGit(['add', 'README.md']);
      this.runGit(['commit', '-m', 'chore: initialize durable state repository']);
    }
  }

  /** 执行 git 命令；非零退出码抛 RuntimeError。 */
  private runGit(args: readonly string[]): string {
    try {
      return execFileSync('git', [...args], {
        cwd: this.repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      }).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git ${args.join(' ')} failed: ${message}`);
    }
  }

  /** 将 state key 映射到文件路径（sha1 前 24 位，避免非法文件名字符）。 */
  private keyToPath(key: string): string {
    const safe = createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 24);
    return join(this.repoPath, `${safe}.json`);
  }

  async read(key: string): Promise<unknown | undefined> {
    const path = this.keyToPath(key);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { value?: unknown };
      return data.value;
    } catch {
      return undefined;
    }
  }

  async write(key: string, value: unknown, writer: string): Promise<DurableState> {
    const path = this.keyToPath(key);
    const now = new Date().toISOString();

    // 读取旧版本以计算 version
    let oldVersion = 0;
    let oldCreatedAt = now;
    if (existsSync(path)) {
      try {
        const oldData = JSON.parse(readFileSync(path, 'utf8')) as {
          version?: unknown;
          created_at?: unknown;
        };
        oldVersion =
          typeof oldData.version === 'number' ? oldData.version : Number(oldData.version) || 0;
        if (typeof oldData.created_at === 'string') {
          oldCreatedAt = oldData.created_at;
        }
      } catch {
        // 损坏文件按新记录处理
      }
    }

    const state: DurableState = {
      state_id: `ds-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      key,
      value,
      version: oldVersion + 1,
      last_writer: writer,
      created_at: oldCreatedAt,
      updated_at: now,
    };
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
    this.runGit(['add', path.split(/[\\/]/).pop() ?? path]);
    this.runGit([
      'commit',
      '-m',
      `chore(durable_state): write key=${key} v=${state.version} by=${writer}`,
    ]);
    return state;
  }

  async delete(key: string): Promise<boolean> {
    const path = this.keyToPath(key);
    if (!existsSync(path)) {
      return false;
    }
    try {
      rmSync(path);
      this.runGit(['add', '-A']);
      this.runGit(['commit', '-m', `chore(durable_state): delete key=${key}`]);
      return true;
    } catch {
      return false;
    }
  }
}
