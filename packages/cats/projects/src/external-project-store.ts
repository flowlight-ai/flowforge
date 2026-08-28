/**
 * @flowforge/cats-projects — external project store（F076，P2-1 path traversal 防护）。
 *
 * TS 移植自 clowder-ai `domains/projects/external-project-store.ts`。
 * 插件化改造：Redis 依赖剥离为 `ExternalProjectKV` 注入接口（宿主提供持久实现），
 * 默认 `MemoryExternalProjectKV` 供 tests/dev。
 *
 * @module @flowforge/cats-projects/external-project-store
 */

import { resolve, sep } from 'node:path';
import type { CreateExternalProjectInput, ExternalProject } from './types.js';
import { ExternalProjectKeys, generateSortableId } from './types.js';

/** 外部项目 KV 端口：detail hash + userList zset（对齐 Redis 语义的子集）。 */
export interface ExternalProjectKV {
  hset(key: string, fields: Record<string, string>): Promise<void> | void;
  hgetall(key: string): Promise<Record<string, string> | null> | Record<string, string> | null;
  del(key: string): Promise<void> | void;
  zadd(key: string, score: number, member: string): Promise<void> | void;
  zrem(key: string, member: string): Promise<void> | void;
  /** 按 score 倒序取 [start, stop]（含负索引，-1 表示末尾）。 */
  zrevrange(key: string, start: number, stop: number): Promise<string[]> | string[];
}

/** 内存 KV 实现：hash Map + zset Map（同分按 member 字典序，稳定且对齐 Redis 语义）。 */
export class MemoryExternalProjectKV implements ExternalProjectKV {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly zsets = new Map<string, Map<string, number>>();

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    for (const [field, value] of Object.entries(fields)) {
      hash.set(field, value);
    }
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const hash = this.hashes.get(key);
    if (!hash || hash.size === 0) return null;
    return Object.fromEntries(hash);
  }

  async del(key: string): Promise<void> {
    this.hashes.delete(key);
    this.zsets.delete(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    let zset = this.zsets.get(key);
    if (!zset) {
      zset = new Map();
      this.zsets.set(key, zset);
    }
    zset.set(member, score);
  }

  async zrem(key: string, member: string): Promise<void> {
    this.zsets.get(key)?.delete(member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset || zset.size === 0) return [];
    const entries = [...zset.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const normalizedStart = start < 0 ? Math.max(entries.length + start, 0) : start;
    const normalizedStop = stop < 0 ? Math.max(entries.length + stop, 0) : stop;
    return entries.slice(normalizedStart, normalizedStop + 1).map(([member]) => member);
  }
}

/** F076 外部项目 store — KV 注入 + P2-1 路径逃逸防护。 */
export class ExternalProjectStore {
  private readonly kv: ExternalProjectKV;

  constructor(kv: ExternalProjectKV = new MemoryExternalProjectKV()) {
    this.kv = kv;
  }

  async create(userId: string, input: CreateExternalProjectInput): Promise<ExternalProject> {
    if (!input.sourcePath) {
      throw new Error('sourcePath is required');
    }
    // P2-1: Prevent path traversal — resolved backlogPath must stay within sourcePath
    const backlogPath = input.backlogPath ?? 'docs/ROADMAP.md';
    const resolvedBacklog = resolve(input.sourcePath, backlogPath);
    const resolvedSource = resolve(input.sourcePath);
    if (!resolvedBacklog.startsWith(`${resolvedSource}${sep}`) && resolvedBacklog !== resolvedSource) {
      throw new Error('backlogPath must not escape sourcePath');
    }
    const now = Date.now();
    const project: ExternalProject = {
      id: `ep-${generateSortableId(now)}`,
      userId,
      name: input.name,
      description: input.description,
      sourcePath: input.sourcePath,
      backlogPath,
      createdAt: now,
      updatedAt: now,
    };
    await this.kv.hset(ExternalProjectKeys.detail(project.id), this.serializeProject(project));
    await this.kv.zadd(ExternalProjectKeys.userList(userId), now, project.id);
    return project;
  }

  async listByUser(userId: string): Promise<ExternalProject[]> {
    const ids = await this.kv.zrevrange(ExternalProjectKeys.userList(userId), 0, -1);
    if (ids.length === 0) return [];
    const result: ExternalProject[] = [];
    for (const id of ids) {
      const row = await this.kv.hgetall(ExternalProjectKeys.detail(id));
      if (!row || !row.id) continue;
      result.push(this.hydrateProject(row));
    }
    return result;
  }

  async getById(id: string): Promise<ExternalProject | null> {
    const data = await this.kv.hgetall(ExternalProjectKeys.detail(id));
    if (!data || !data.id) return null;
    return this.hydrateProject(data);
  }

  async update(id: string, patch: Partial<CreateExternalProjectInput>): Promise<ExternalProject | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    const updated: ExternalProject = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.sourcePath !== undefined ? { sourcePath: patch.sourcePath } : {}),
      ...(patch.backlogPath !== undefined ? { backlogPath: patch.backlogPath } : {}),
      updatedAt: Date.now(),
    };
    await this.kv.hset(ExternalProjectKeys.detail(id), this.serializeProject(updated));
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const project = await this.getById(id);
    if (!project) return false;
    await this.kv.del(ExternalProjectKeys.detail(id));
    await this.kv.zrem(ExternalProjectKeys.userList(project.userId), id);
    return true;
  }

  private serializeProject(project: ExternalProject): Record<string, string> {
    return {
      id: project.id,
      userId: project.userId,
      name: project.name,
      description: project.description,
      sourcePath: project.sourcePath,
      backlogPath: project.backlogPath,
      createdAt: String(project.createdAt),
      updatedAt: String(project.updatedAt),
    };
  }

  private hydrateProject(data: Record<string, string>): ExternalProject {
    return {
      id: data.id ?? '',
      userId: data.userId ?? '',
      name: data.name ?? '',
      description: data.description ?? '',
      sourcePath: data.sourcePath ?? '',
      backlogPath: data.backlogPath ?? 'docs/ROADMAP.md',
      createdAt: Number.parseInt(data.createdAt ?? '0', 10),
      updatedAt: Number.parseInt(data.updatedAt ?? '0', 10),
    };
  }
}
