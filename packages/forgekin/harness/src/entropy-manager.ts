/**
 * entropy-manager — Harness 第 6 层：清理现实（Entropy Control 退役，FR-HRN-04）。
 *
 * 移植 `harness/entropy_manager.py`（TS 重写）：
 * - DocGardener：每日文档新鲜度扫描（mtime 缓存 + 批量 stat）
 * - DebtTracker：技术债务跟踪（记录 / 状态流转 / 汇总）
 * - RuleEvolution：规则演化（propose → activate → mutate → deprecate → retire）
 * - GarbageCollection：定时清理（过期临时文件回收）
 * - EntropyManager：facade（pre_check 轻量检查 + post_track 失败转债务/规则）
 *
 * 熵管理是内置核心能力；实际扫描/修复作为后台 Cron 任务运行，
 * pre_execute 只做轻量检查。
 *
 * @module @flowforge/forgekin-harness
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 文档新鲜度记录（DocGardener 跟踪项）。 */
export interface DocEntry {
  /** 文档文件路径。 */
  readonly path: string;
  /** 最后修改时间（epoch 秒）。 */
  last_modified: number;
  /** 最后检查时间（epoch 秒）。 */
  last_checked: number;
  /** 陈旧度 0.0（新鲜）~ 1.0（完全陈旧）。 */
  staleness_score: number;
  /** 该文档依赖的源文件路径集合。 */
  readonly linked_sources: Set<string>;
}

/** 技术债务严重级别。 */
export enum DebtSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** 技术债务状态。 */
export enum DebtStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  WONT_FIX = 'wont_fix',
}

/** 单条技术债务。 */
export interface DebtItem {
  /** 唯一标识（DEBT-0001 递增）。 */
  readonly id: string;
  /** 人类可读描述。 */
  readonly description: string;
  /** 严重级别。 */
  readonly severity: DebtSeverity;
  /** 当前状态。 */
  status: DebtStatus;
  /** 记录时间（epoch 秒）。 */
  readonly created_at: number;
  /** 来源（harness_violation / manual 等）。 */
  readonly source: string;
  /** 附加元数据。 */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** 规则生命周期阶段。 */
export enum RuleLifecycle {
  PROPOSED = 'proposed',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  RETIRED = 'retired',
}

/** 一条带生命周期与变异历史的规则。 */
export interface EvolvingRule {
  /** 唯一标识（RULE-0001 递增）。 */
  readonly id: string;
  /** 规则名。 */
  readonly name: string;
  /** 规则强制内容。 */
  readonly description: string;
  /** 当前生命周期阶段。 */
  lifecycle: RuleLifecycle;
  /** 规则版本号。 */
  readonly version: number;
  /** 创建时间（epoch 秒）。 */
  readonly created_at: number;
  /** 最后变异时间（epoch 秒）。 */
  mutated_at: number;
  /** 变异次数。 */
  readonly mutation_count: number;
  /** 演化来源规则 ID（如有）。 */
  readonly parent_id: string | undefined;
  /** 附加元数据。 */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** 垃圾回收调度条目。 */
export interface GCSchedule {
  /** 资源类型（checkpoints / sessions / cache_entries / task_states）。 */
  readonly resource_type: string;
  /** 清理前的最大年龄（天，默认 30）。 */
  readonly max_age_days: number;
  /** 上次 GC 运行时间（epoch 秒）。 */
  last_run: number;
  /** 运行间隔（小时，默认 24）。 */
  readonly interval_hours: number;
}

/** DocGardener：文档新鲜度扫描（批量 stat + mtime 缓存）。 */
export class DocGardener {
  /** 陈旧度阈值（高于此值标记，默认 0.7）。 */
  readonly staleThreshold: number;
  /** mtime 缓存 TTL（秒，默认 60）。 */
  readonly mtimeCacheTtl: number;
  /** 跟踪的文档条目（path → DocEntry）。 */
  readonly entries = new Map<string, DocEntry>();

  /** mtime 缓存：{filePath: [mtime, cachedAt]}。 */
  private readonly mtimeCache = new Map<string, [number | undefined, number]>();
  /** 目录批量 stat 缓存：{dirPath: {filename: mtime}}。 */
  private readonly dirCache = new Map<string, Map<string, number>>();
  private readonly dirCacheTs = new Map<string, number>();

  constructor(staleThreshold = 0.7, mtimeCacheTtl = 60) {
    this.staleThreshold = staleThreshold;
    this.mtimeCacheTtl = mtimeCacheTtl;
  }

  /** 获取文件 mtime（缓存 → 目录批量 stat → 单文件 stat 三级回退）。 */
  private getMtime(filePath: string): number | undefined {
    const now = Date.now() / 1000;

    // 1. mtime 缓存
    const cached = this.mtimeCache.get(filePath);
    if (cached !== undefined) {
      const [cachedMtime, cachedAt] = cached;
      if (now - cachedAt < this.mtimeCacheTtl) {
        return cachedMtime;
      }
    }

    // 2. 目录批量 stat
    let mtime: number | undefined;
    try {
      const st = statSync(filePath, { throwIfNoEntry: false });
      mtime = st === undefined ? undefined : st.mtimeMs / 1000;
    } catch {
      mtime = undefined;
    }
    if (mtime === undefined) {
      this.mtimeCache.set(filePath, [undefined, now]);
      return undefined;
    }

    const dirPath = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    const fileName = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);

    // 刷新目录缓存（TTL 过期时）
    const dirCachedAt = this.dirCacheTs.get(dirPath);
    if (dirCachedAt === undefined || now - dirCachedAt >= this.mtimeCacheTtl) {
      const dirEntries = new Map<string, number>();
      try {
        for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
          try {
            dirEntries.set(entry.name, statSync(join(dirPath, entry.name)).mtimeMs / 1000);
          } catch {
            // 跳过无法 stat 的条目
          }
        }
        this.dirCache.set(dirPath, dirEntries);
        this.dirCacheTs.set(dirPath, now);
      } catch {
        this.dirCache.delete(dirPath);
        this.dirCacheTs.delete(dirPath);
      }
    }

    const batchMtime = this.dirCache.get(dirPath)?.get(fileName);
    this.mtimeCache.set(filePath, [batchMtime ?? mtime, now]);
    return batchMtime ?? mtime;
  }

  /** 失效 mtime 缓存（指定文件或全部）。 */
  invalidateCache(filePath?: string | undefined): void {
    if (filePath === undefined) {
      this.mtimeCache.clear();
      this.dirCache.clear();
      this.dirCacheTs.clear();
      return;
    }
    this.mtimeCache.delete(filePath);
    const dirPath = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    this.dirCache.delete(dirPath);
    this.dirCacheTs.delete(dirPath);
  }

  /** 注册文档用于新鲜度跟踪。 */
  registerDoc(docPath: string, linkedSources?: ReadonlySet<string> | undefined): void {
    const now = Date.now() / 1000;
    const mtime = this.getMtime(docPath);
    this.entries.set(docPath, {
      path: docPath,
      last_modified: mtime ?? now,
      last_checked: now,
      staleness_score: 0,
      linked_sources: new Set(linkedSources ?? []),
    });
  }

  /** 检查所有跟踪文档的新鲜度，返回陈旧文档列表。 */
  async checkFreshness(options: { force?: boolean | undefined } = {}): Promise<
    Array<{ path: string; staleness_score: number; reason: string }>
  > {
    const now = Date.now() / 1000;
    const stale: Array<{ path: string; staleness_score: number; reason: string }> = [];

    for (const [docPath, entry] of this.entries) {
      // 跳过近期检查过的文档（除非强制）
      if (!options.force && now - entry.last_checked < this.mtimeCacheTtl) {
        if (entry.staleness_score >= this.staleThreshold) {
          stale.push({
            path: docPath,
            staleness_score: Math.round(entry.staleness_score * 1000) / 1000,
            reason: 'cached_stale',
          });
        }
        continue;
      }
      entry.last_checked = now;

      let maxSourceStaleness = 0;
      const staleSources: string[] = [];

      for (const sourcePath of entry.linked_sources) {
        const sourceMtime = this.getMtime(sourcePath);
        if (sourceMtime === undefined) {
          staleSources.push(sourcePath);
          maxSourceStaleness = Math.max(maxSourceStaleness, 0.5);
          continue;
        }
        if (sourceMtime > entry.last_modified) {
          const ageDays = (now - entry.last_modified) / 86400;
          const sourceStaleness = Math.min(1.0, ageDays / 30.0);
          maxSourceStaleness = Math.max(maxSourceStaleness, sourceStaleness);
          staleSources.push(sourcePath);
        }
      }

      // 刷新文档自身 mtime
      const docMtime = this.getMtime(docPath);
      if (docMtime !== undefined) {
        entry.last_modified = docMtime;
      }

      const docAgeDays = (now - entry.last_modified) / 86400;
      const ageStaleness = Math.min(1.0, docAgeDays / 90.0);
      entry.staleness_score = Math.max(maxSourceStaleness, ageStaleness);

      if (entry.staleness_score >= this.staleThreshold) {
        const reasonParts: string[] = [];
        if (staleSources.length > 0) {
          reasonParts.push(`sources modified: ${staleSources.slice(0, 3).join(', ')}`);
        }
        if (ageStaleness >= this.staleThreshold) {
          reasonParts.push(`doc age: ${Math.floor(docAgeDays)} days`);
        }
        stale.push({
          path: docPath,
          staleness_score: Math.round(entry.staleness_score * 1000) / 1000,
          reason: reasonParts.length > 0 ? reasonParts.join('; ') : 'high staleness',
        });
      }
    }
    return stale;
  }
}

/** DebtTracker：技术债务跟踪（记录 / 状态流转 / 汇总）。 */
export class DebtTracker {
  /** 债务项注册表（id → DebtItem）。 */
  readonly items = new Map<string, DebtItem>();
  private nextId = 1;

  /** 记录一条新技术债务，返回 ID。 */
  record(
    description: string,
    severity = DebtSeverity.MEDIUM,
    source = '',
    metadata?: Readonly<Record<string, unknown>> | undefined,
  ): string {
    const itemId = `DEBT-${String(this.nextId).padStart(4, '0')}`;
    this.nextId += 1;
    this.items.set(itemId, {
      id: itemId,
      description,
      severity,
      status: DebtStatus.OPEN,
      created_at: Date.now() / 1000,
      source,
      metadata: { ...(metadata ?? {}) },
    });
    return itemId;
  }

  /** 更新债务状态；返回是否找到并更新。 */
  updateStatus(itemId: string, status: DebtStatus): boolean {
    const item = this.items.get(itemId);
    if (item === undefined) {
      return false;
    }
    item.status = status;
    return true;
  }

  /** 获取所有未解决（open/acknowledged/in_progress）的债务项。 */
  getOpenItems(): DebtItem[] {
    return [...this.items.values()].filter((item) =>
      item.status === DebtStatus.OPEN ||
      item.status === DebtStatus.ACKNOWLEDGED ||
      item.status === DebtStatus.IN_PROGRESS,
    );
  }

  /** 债务全景汇总（按严重级别与状态计数）。 */
  getSummary(): Readonly<{
    total_items: number;
    open_items: number;
    by_severity: Readonly<Record<string, number>>;
    by_status: Readonly<Record<string, number>>;
  }> {
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const s of Object.values(DebtSeverity)) {
      bySeverity[s] = 0;
    }
    for (const s of Object.values(DebtStatus)) {
      byStatus[s] = 0;
    }
    for (const item of this.items.values()) {
      bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    }
    return {
      total_items: this.items.size,
      open_items: this.getOpenItems().length,
      by_severity: bySeverity,
      by_status: byStatus,
    };
  }
}

/** RuleEvolution：规则生命周期管理（提议/激活/变异/废弃/退役）。 */
export class RuleEvolution {
  /** 规则注册表（id → EvolvingRule）。 */
  readonly rules = new Map<string, EvolvingRule>();
  private nextId = 1;

  /** 提议一条新规则，返回 ID。 */
  propose(
    name: string,
    description: string,
    metadata?: Readonly<Record<string, unknown>> | undefined,
  ): string {
    const ruleId = `RULE-${String(this.nextId).padStart(4, '0')}`;
    this.nextId += 1;
    const now = Date.now() / 1000;
    this.rules.set(ruleId, {
      id: ruleId,
      name,
      description,
      lifecycle: RuleLifecycle.PROPOSED,
      version: 1,
      created_at: now,
      mutated_at: now,
      mutation_count: 0,
      parent_id: undefined,
      metadata: { ...(metadata ?? {}) },
    });
    return ruleId;
  }

  /** 激活一条 proposed 规则；返回是否成功。 */
  activate(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule === undefined || rule.lifecycle !== RuleLifecycle.PROPOSED) {
      return false;
    }
    rule.lifecycle = RuleLifecycle.ACTIVE;
    return true;
  }

  /** 变异一条 active 规则（原规则废弃 + 新版本创建）；返回新规则 ID 或 undefined。 */
  mutate(
    ruleId: string,
    newDescription: string,
    metadata?: Readonly<Record<string, unknown>> | undefined,
  ): string | undefined {
    const rule = this.rules.get(ruleId);
    if (rule === undefined || rule.lifecycle !== RuleLifecycle.ACTIVE) {
      return undefined;
    }
    rule.lifecycle = RuleLifecycle.DEPRECATED;
    rule.mutated_at = Date.now() / 1000;

    const newId = `RULE-${String(this.nextId).padStart(4, '0')}`;
    this.nextId += 1;
    const now = Date.now() / 1000;
    this.rules.set(newId, {
      id: newId,
      name: rule.name,
      description: newDescription,
      lifecycle: RuleLifecycle.ACTIVE,
      version: rule.version + 1,
      created_at: now,
      mutated_at: now,
      mutation_count: rule.mutation_count + 1,
      parent_id: ruleId,
      metadata: { ...(metadata ?? {}) },
    });
    return newId;
  }

  /** 废弃一条 active 规则；返回是否成功。 */
  deprecate(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule === undefined || rule.lifecycle !== RuleLifecycle.ACTIVE) {
      return false;
    }
    rule.lifecycle = RuleLifecycle.DEPRECATED;
    rule.mutated_at = Date.now() / 1000;
    return true;
  }

  /** 退役一条 deprecated 规则；返回是否成功。 */
  retire(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule === undefined || rule.lifecycle !== RuleLifecycle.DEPRECATED) {
      return false;
    }
    rule.lifecycle = RuleLifecycle.RETIRED;
    rule.mutated_at = Date.now() / 1000;
    return true;
  }

  /** 获取所有 active 规则。 */
  getActiveRules(): EvolvingRule[] {
    return [...this.rules.values()].filter((r) => r.lifecycle === RuleLifecycle.ACTIVE);
  }
}

/** GarbageCollection：定时清理过期资源（默认 4 类调度）。 */
export class GarbageCollection {
  /** GC 调度注册表（resource_type → GCSchedule）。 */
  readonly schedules = new Map<string, GCSchedule>();
  /** 数据目录（相对 cwd，可由配置覆盖）。 */
  readonly dataDir: string;
  /** 待清理的临时文件扩展名。 */
  readonly tmpExtensions = new Set(['.tmp', '.bak', '.log', '.temp', '.cache']);

  constructor(dataDir = 'data') {
    this.dataDir = dataDir;
    this.registerDefaultSchedules();
  }

  private registerDefaultSchedules(): void {
    const defaults: GCSchedule[] = [
      { resource_type: 'checkpoints', max_age_days: 7, last_run: 0, interval_hours: 24 },
      { resource_type: 'sessions', max_age_days: 1, last_run: 0, interval_hours: 6 },
      { resource_type: 'cache_entries', max_age_days: 30, last_run: 0, interval_hours: 12 },
      { resource_type: 'task_states', max_age_days: 14, last_run: 0, interval_hours: 24 },
    ];
    for (const schedule of defaults) {
      this.schedules.set(schedule.resource_type, schedule);
    }
  }

  /** 注册自定义 GC 调度。 */
  registerSchedule(schedule: GCSchedule): void {
    this.schedules.set(schedule.resource_type, schedule);
  }

  /** 检查所有调度，对到期的资源类型执行 GC。 */
  async checkAndCollect(): Promise<
    Readonly<{
      collected: string[];
      details: Readonly<Record<string, unknown>>;
    }>
  > {
    const now = Date.now() / 1000;
    const collected: string[] = [];
    const details: Record<string, unknown> = {};

    for (const [resourceType, schedule] of this.schedules) {
      const hoursSinceLast = (now - schedule.last_run) / 3600;
      if (hoursSinceLast < schedule.interval_hours) {
        continue;
      }
      const result = await this.collectResource(resourceType, schedule);
      schedule.last_run = now;
      collected.push(resourceType);
      details[resourceType] = result;
    }
    return { collected, details };
  }

  /** 对单个资源类型执行收集（删除超龄临时文件）。 */
  private async collectResource(
    resourceType: string,
    schedule: GCSchedule,
  ): Promise<Readonly<Record<string, unknown>>> {
    const now = Date.now() / 1000;
    const cutoff = now - schedule.max_age_days * 86400;
    const deletedFiles: string[] = [];
    let totalSize = 0;

    try {
      for (const entry of readdirSync(this.dataDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        const filePath = join(this.dataDir, entry.name);
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (!this.tmpExtensions.has(ext)) {
          continue;
        }
        try {
          const stats = statSync(filePath);
          if (stats.mtimeMs / 1000 < cutoff) {
            totalSize += stats.size;
            unlinkSync(filePath);
            deletedFiles.push(filePath);
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // data 目录不存在或不可读时返回空结果
    }

    return {
      resource_type: resourceType,
      max_age_days: schedule.max_age_days,
      status: 'completed',
      deleted_count: deletedFiles.length,
      freed_bytes: totalSize,
      deleted_files: deletedFiles.slice(0, 50),
    };
  }
}

/** Harness 任务上下文（EntropyManager 的轻量执行上下文）。 */
export interface HarnessTaskContext {
  /** 任务 ID。 */
  readonly task_id: string;
  /** 任务元数据（pre_check 会注入熵告警）。 */
  metadata: Record<string, unknown>;
  /** 任务状态（check 时读取 harness_violations / linter_violations）。 */
  readonly state: Readonly<Record<string, unknown>>;
}

/** EntropyManager：熵管理门禁（facade）。 */
export class EntropyManager {
  readonly docGardenerEnabled: boolean;
  readonly debtTrackerEnabled: boolean;
  readonly ruleEvolutionEnabled: boolean;

  readonly docGardener: DocGardener | undefined;
  readonly debtTracker: DebtTracker | undefined;
  readonly ruleEvolution: RuleEvolution | undefined;
  readonly garbageCollection: GarbageCollection;

  /** 熵标志（后台任务写入，pre_check 读取）。 */
  readonly entropyFlags = new Map<string, unknown>();
  /** 高债务告警阈值（默认 5）。 */
  readonly highDebtThreshold: number;

  private preCheckCount = 0;
  private postTrackCount = 0;

  constructor(options: {
    docGardenerEnabled?: boolean | undefined;
    debtTrackerEnabled?: boolean | undefined;
    ruleEvolutionEnabled?: boolean | undefined;
    docStaleThreshold?: number | undefined;
    highDebtThreshold?: number | undefined;
    dataDir?: string | undefined;
  } = {}) {
    this.docGardenerEnabled = options.docGardenerEnabled ?? true;
    this.debtTrackerEnabled = options.debtTrackerEnabled ?? true;
    this.ruleEvolutionEnabled = options.ruleEvolutionEnabled ?? true;
    this.highDebtThreshold = options.highDebtThreshold ?? 5;
    this.docGardener = this.docGardenerEnabled
      ? new DocGardener(options.docStaleThreshold ?? 0.7)
      : undefined;
    this.debtTracker = this.debtTrackerEnabled ? new DebtTracker() : undefined;
    this.ruleEvolution = this.ruleEvolutionEnabled ? new RuleEvolution() : undefined;
    this.garbageCollection = new GarbageCollection(options.dataDir);
  }

  /** 执行前轻量熵检查（只检查后台任务写入的标志，不扫描）。 */
  async preCheck(ctx: HarnessTaskContext): Promise<void> {
    this.preCheckCount += 1;
    if (this.entropyFlags.get('high_debt_alert')) {
      ctx.metadata['entropy_alert'] = 'high_technical_debt';
    }
    if (this.entropyFlags.get('stale_docs_alert')) {
      ctx.metadata['stale_docs'] = true;
    }
  }

  /** 执行结果跟踪：错误/质量警告 → 债务项 + 规则演化候选。 */
  async postTrack(result: Readonly<Record<string, unknown>>, ctx: HarnessTaskContext): Promise<void> {
    this.postTrackCount += 1;
    const error = result['error'];
    if (error) {
      await this.recordFailure(result, ctx);
      if (this.debtTracker !== undefined) {
        const errorPreview =
          typeof error === 'string' ? error.slice(0, 200) : String(error).slice(0, 200);
        this.debtTracker.record(
          `Execution error on task ${ctx.task_id}: ${errorPreview}`,
          DebtSeverity.HIGH,
          'harness_error',
          { task_id: ctx.task_id, status: result['status'] },
        );
      }
    }

    const qualityWarning = result['quality_warning'];
    if (qualityWarning) {
      this.entropyFlags.set('last_quality_warning', ctx.task_id);
      if (this.debtTracker !== undefined) {
        const warningPreview = String(qualityWarning).slice(0, 200);
        this.debtTracker.record(
          `Quality warning on task ${ctx.task_id}: ${warningPreview}`,
          DebtSeverity.MEDIUM,
          'quality_warning',
          { task_id: ctx.task_id, gate: result['_feedback'] },
        );
      }
    }
  }

  /** 记录失败 → 从失败模式提议候选规则。 */
  private async recordFailure(
    result: Readonly<Record<string, unknown>>,
    ctx: HarnessTaskContext,
  ): Promise<void> {
    const error = String(result['error'] ?? 'unknown').slice(0, 100);
    if (this.ruleEvolution !== undefined) {
      this.ruleEvolution.propose(
        `Prevent failure: ${ctx.task_id}`,
        `Rule proposed from failure — ${error}`,
        { task_id: ctx.task_id, error },
      );
    }
  }

  /** 运行文档新鲜度扫描（后台 Cron 任务）。 */
  async runDocGardener(): Promise<Array<{ path: string; staleness_score: number; reason: string }>> {
    if (this.docGardener === undefined) {
      return [];
    }
    const staleDocs = await this.docGardener.checkFreshness();
    this.entropyFlags.set('stale_docs_alert', staleDocs.length > 0);
    return staleDocs;
  }

  /** 运行技术债务扫描（后台 Cron 任务）。 */
  async runDebtTracker(): Promise<
    Array<{ id: string; description: string; severity: DebtSeverity; status: DebtStatus; source: string }>
  > {
    if (this.debtTracker === undefined) {
      return [];
    }
    const openItems = this.debtTracker.getOpenItems();
    const highSeverityCount = openItems.filter(
      (item) => item.severity === DebtSeverity.HIGH || item.severity === DebtSeverity.CRITICAL,
    ).length;
    this.entropyFlags.set('high_debt_alert', highSeverityCount >= this.highDebtThreshold);
    return openItems.map((item) => ({
      id: item.id,
      description: item.description,
      severity: item.severity,
      status: item.status,
      source: item.source,
    }));
  }

  /** 分析失败记录 → 提议新规则。 */
  async runRuleEvolution(
    failures: ReadonlyArray<Readonly<Record<string, unknown>>>,
  ): Promise<Array<{ rule_id: string; name: string; description: string; lifecycle: string }>> {
    if (this.ruleEvolution === undefined || failures.length === 0) {
      return [];
    }
    const proposed: Array<{ rule_id: string; name: string; description: string; lifecycle: string }> = [];
    for (const failure of failures) {
      const taskId = String(failure['task_id'] ?? 'unknown');
      const error = String(failure['error'] ?? 'unknown').slice(0, 100);
      const ruleId = this.ruleEvolution.propose(
        `Prevent failure: ${taskId}`,
        `Rule proposed from failure — ${error}`,
        { ...failure },
      );
      proposed.push({
        rule_id: ruleId,
        name: `Prevent failure: ${taskId}`,
        description: `Rule proposed from failure — ${error}`,
        lifecycle: 'proposed',
      });
    }
    return proposed;
  }

  /** 运行全部熵检查，返回综合报告。 */
  async check(ctx: HarnessTaskContext): Promise<Readonly<Record<string, unknown>>> {
    const staleDocs = this.docGardener !== undefined
      ? await this.docGardener.checkFreshness()
      : [];
    const debtSummary = this.debtTracker?.getSummary() ?? {};
    const activeRules = this.ruleEvolution?.getActiveRules() ?? [];
    const gcResult = await this.garbageCollection.checkAndCollect();

    // 记录 harness 违规为债务
    if (this.debtTracker !== undefined) {
      const violations = (ctx.state['harness_violations'] as unknown) ?? [];
      if (Array.isArray(violations)) {
        for (const violation of violations) {
          if (typeof violation === 'object' && violation !== null) {
            const v = violation as Readonly<Record<string, unknown>>;
            this.debtTracker.record(
              String(v['violation'] ?? 'Unknown harness violation'),
              DebtSeverity.HIGH,
              'harness_violation',
              v,
            );
          }
        }
      }
      const linterViolations = (ctx.state['linter_violations'] as unknown) ?? [];
      if (Array.isArray(linterViolations)) {
        for (const lv of linterViolations) {
          if (typeof lv === 'object' && lv !== null) {
            const entry = lv as Readonly<Record<string, unknown>>;
            const severity =
              entry['severity'] === 'error' ? DebtSeverity.HIGH : DebtSeverity.MEDIUM;
            this.debtTracker.record(
              `Linter violation: ${String(entry['rule_name'] ?? 'unknown')} — ${String(entry['description'] ?? '')}`,
              severity,
              'linter',
              entry,
            );
          }
        }
      }
    }

    return {
      doc_freshness: {
        stale_count: staleDocs.length,
        stale_docs: staleDocs.slice(0, 10),
      },
      debt_summary: debtSummary,
      active_rules_count: activeRules.length,
      gc_result: gcResult,
    };
  }

  /** 设置熵标志（由后台任务调用）。 */
  setEntropyFlag(flagName: string, value: unknown): void {
    this.entropyFlags.set(flagName, value);
  }

  /** 获取熵管理状态。 */
  getStatus(): Readonly<Record<string, unknown>> {
    return {
      enabled: true,
      doc_gardener_enabled: this.docGardenerEnabled,
      debt_tracker_enabled: this.debtTrackerEnabled,
      rule_evolution_enabled: this.ruleEvolutionEnabled,
      pre_check_count: this.preCheckCount,
      post_track_count: this.postTrackCount,
      entropy_flags: Object.fromEntries(this.entropyFlags),
    };
  }
}
