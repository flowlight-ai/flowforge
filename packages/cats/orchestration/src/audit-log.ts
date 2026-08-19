/**
 * EventAuditLogService — append-only 事件审计日志 Cordis 服务。
 *
 * 移植自 clowder-ai `orchestration/EventAuditLog.ts`（R13 一切皆插件改造）：
 * - 只追加不可修改；每事件唯一 ID + 时间戳；按日期分片 NDJSON 便于归档
 * - clowder-ai 的模块级 singleton（getEventAuditLog）改为 Cordis 生命周期，
 *   目录经构造参数注入（默认 `./data/audit-logs`，测试可指向临时目录）
 * - `Context` 扩展挂载点：`ctx.catsAudit`（对齐 24-stage4 计划 T4.5.2）
 *
 * @module @flowforge/cats-orchestration/audit
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@flowforge/cordis'
import type { AuditEvent, AuditEventInput } from '@flowforge/cats-shared'
import { DEFAULT_AUDIT_DIR } from './invariant.ts'

export interface EventAuditLogOptions {
  /** NDJSON 分片目录；默认 `./data/audit-logs`（受 AUDIT_LOG_DIR 环境变量覆盖）。 */
  auditDir?: string
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 事件审计日志 — mounted by `@flowforge/cats-orchestration`.
     * Append-only NDJSON 按日分片；即使持久层丢失，真相仍可追溯。
     */
    catsAudit: EventAuditLogService
  }
}

/**
 * Cordis service exposing the append-only audit log at `ctx.catsAudit`.
 */
export class EventAuditLogService extends Service {
  static inject: readonly string[] = []

  readonly auditDir: string
  private initialized = false

  constructor(ctx: Context, options: EventAuditLogOptions = {}) {
    super(ctx, 'catsAudit')
    this.auditDir = resolve(options.auditDir ?? process.env.AUDIT_LOG_DIR ?? DEFAULT_AUDIT_DIR)
  }

  /** Append an event; returns the created event with generated ID + timestamp. */
  async append(input: AuditEventInput): Promise<AuditEvent> {
    await this.ensureInitialized()

    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...input,
    }

    const filepath = join(this.auditDir, this.getFilename(event.timestamp))
    await appendFile(filepath, `${JSON.stringify(event)}\n`, 'utf-8')
    return event
  }

  /** Read all events from a specific date (YYYY-MM-DD string or Date). */
  async readByDate(date: string | Date): Promise<AuditEvent[]> {
    await this.ensureInitialized()

    const dateStr = typeof date === 'string' ? date : this.formatDate(date)
    const filepath = join(this.auditDir, `audit-${dateStr}.ndjson`)
    if (!existsSync(filepath)) return []

    const content = await readFile(filepath, 'utf-8')
    const events: AuditEvent[] = []
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try {
        events.push(JSON.parse(line) as AuditEvent)
      } catch {
        this.ctx.logger.warn('cats-audit: failed to parse line %s', line.slice(0, 100))
      }
    }
    return events
  }

  /** Read all events of a specific type within the trailing `days` window (default 30). */
  async readByType(type: string, options?: { days?: number }): Promise<AuditEvent[]> {
    return this.collect((e) => e.type === type, options?.days ?? 30)
  }

  /** Read all events for a specific thread within the trailing `days` window. */
  async readByThread(threadId: string, options?: { days?: number }): Promise<AuditEvent[]> {
    return this.collect((e) => e.threadId === threadId, options?.days ?? 30)
  }

  /** Absolute path to today's audit log file. */
  getLogPath(): string {
    return resolve(this.auditDir, this.getFilename(Date.now()))
  }

  /** List available audit files (newest first). */
  async listFiles(): Promise<string[]> {
    await this.ensureInitialized()
    const files = await readdir(this.auditDir)
    return files.filter((f) => f.startsWith('audit-') && f.endsWith('.ndjson')).sort().reverse()
  }

  private async collect(predicate: (e: AuditEvent) => boolean, days: number): Promise<AuditEvent[]> {
    const events: AuditEvent[] = []
    for (let i = 0; i < days; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dayEvents = await this.readByDate(date)
      events.push(...dayEvents.filter(predicate))
    }
    return events.sort((a, b) => b.timestamp - a.timestamp)
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (!existsSync(this.auditDir)) {
      await mkdir(this.auditDir, { recursive: true })
      this.ctx.logger.info('cats-audit: created directory %s', this.auditDir)
    }
    this.initialized = true
  }

  private getFilename(timestamp: number): string {
    return `audit-${this.formatDate(new Date(timestamp))}.ndjson`
  }

  private formatDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }
}
