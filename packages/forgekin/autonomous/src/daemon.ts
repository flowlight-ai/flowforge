/**
 * autonomous daemon — F052 自主运行守护进程（对齐 Python AutonomousDaemon）。
 *
 * 工作循环（类 clowder-ai 自主工作模式）：
 * 1. 扫描项目 — 发现文档缺失/代码 TODO/测试缺失
 * 2. 提交任务 — SwarmTask 提交给 SwarmCoordinator
 * 3. 调度分发 — coordinator.runContinuously() 按 I3 能力匹配分发
 * 4. 执行任务 — 调用灵智体 LLM 真实生成（铁律 3：禁止 Mock LLM）
 * 5. 心跳上报 — heartbeat 上报进度，progress=1.0 自动完成
 * 6. 循环往复 — 每 scan_interval 秒扫描一次，24h 不间断
 *
 * Bug 修复对齐：
 * - Bug 1: 后台任务消费循环（5s 与 dispatch 节奏对齐）+ 拾取即上报
 *   heartbeat(0.1) 防重复拾取 + 全局并发控制
 * - Bug 2: 无效产出检测（标记集 + usage.error）
 * - Bug 4: 未注册灵智体显式 fail_task，避免静默悬挂
 * - Bug 5: 无效/异常产出主动 fail_task，不悬挂等超时
 *
 * @module @flowforge/forgekin-autonomous
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SwarmCoordinator, SwarmTask, SwarmTaskStatus } from '@flowforge/forgekin-swarm';
import {
  AutonomousConfig,
  INVALID_OUTPUT_MARKERS,
  MIN_VALID_OUTPUT_LENGTH,
  ScannerConfig,
  makeAutonomousConfig,
  makeScannerConfig,
} from './config.js';
import { scanProject } from './scanner.js';

/** 睡眠函数注入类型（测试可替换为即时实现） */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 灵智体执行器接口（结构兼容 ForgekinBase.chat，铁律 3：真实 LLM） */
export interface AutonomousForgekin {
  chat(messages: ReadonlyArray<Record<string, string>>): Promise<Record<string, unknown>>;
}

/** 自进化活动日志条目 */
export interface AutonomousActivityEntry {
  readonly timestamp: string;
  readonly event_type: string;
  readonly title: string;
  readonly [key: string]: unknown;
}

/** 已完成任务产出条目（供 Web 可观测性展示） */
export interface AutonomousCompletedOutput {
  readonly timestamp: string;
  readonly task_id: string;
  readonly title: string;
  readonly agent_id: string;
  readonly model: string;
  readonly content: string;
  readonly content_preview: string;
  readonly output_path: string | null;
}

/** AutonomousDaemon 构造参数 */
export interface AutonomousDaemonOptions {
  /** SwarmCoordinator 实例（已注册 5 灵智体） */
  readonly coordinator: SwarmCoordinator;
  /** 项目根目录（扫描范围，红线 11 注入） */
  readonly projectRoot: string;
  /** 灵智体实例字典 {forgekin_id: AutonomousForgekin} */
  readonly forgekins?: Record<string, AutonomousForgekin> | undefined;
  /** 运行配置（可覆盖默认扫描间隔等） */
  readonly config?: Partial<AutonomousConfig> | undefined;
  /** 扫描配置（目录/清单/模式） */
  readonly scannerConfig?: Partial<ScannerConfig> | undefined;
  /** 睡眠函数注入（测试用） */
  readonly sleepFn?: SleepFn | undefined;
  /** 代码/测试产出审阅目录（相对项目根，对齐 Python flowforge/.autonomous/patches） */
  readonly patchesDirName?: string | undefined;
  /** 未知类型产出目录 */
  readonly outputsDirName?: string | undefined;
}

/**
 * 5 灵智体 24h 自主运行守护进程。
 */
export class AutonomousDaemon {
  readonly config: AutonomousConfig;
  private readonly coordinator: SwarmCoordinator;
  private readonly root: string;
  private readonly forgekins = new Map<string, AutonomousForgekin>();
  private readonly scannerConfig: ScannerConfig;
  private readonly sleepFn: SleepFn;
  private readonly patchesDirName: string;
  private readonly outputsDirName: string;
  private running = false;
  private dispatchPromise: Promise<void> | null = null;
  /** Bug 1 修复：后台任务消费循环 */
  private consumerPromise: Promise<void> | null = null;
  /** 执行器任务追踪集合（防 GC 提前回收） */
  private readonly executorPromises = new Set<Promise<void>>();
  /**
   * 任务标题 → 最新 task_id 映射（状态感知去重，修复死循环 Bug：
   * 替代永久保留标题的集合，允许已完成/失败任务重新提交）
   */
  private readonly titleToTaskId = new Map<string, string>();
  /** 自进化活动历史（最近 200 条） */
  private activityLog: AutonomousActivityEntry[] = [];
  /** 已完成任务产出（最近 50 条） */
  private completedOutputs: AutonomousCompletedOutput[] = [];
  private scanCount = 0;

  constructor(options: AutonomousDaemonOptions) {
    this.coordinator = options.coordinator;
    this.root = options.projectRoot;
    this.config = makeAutonomousConfig(options.config);
    this.scannerConfig = makeScannerConfig(options.scannerConfig);
    this.sleepFn = options.sleepFn ?? defaultSleep;
    this.patchesDirName = options.patchesDirName ?? path.join('flowforge', '.autonomous', 'patches');
    this.outputsDirName = options.outputsDirName ?? path.join('flowforge', '.autonomous', 'outputs');
    if (options.forgekins) {
      for (const [id, forgekin] of Object.entries(options.forgekins)) {
        this.forgekins.set(id, forgekin);
      }
    }
  }

  /** 注册灵智体实例（用于执行任务时调用 LLM） */
  registerForgekin(forgekinId: string, forgekin: AutonomousForgekin): void {
    this.forgekins.set(forgekinId, forgekin);
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── 主循环 ──────────────────────────────────────────────────

  /** 主循环 — 24h 持续运行 */
  async runForever(): Promise<void> {
    this.running = true;
    this.logActivity('daemon_started', 'AutonomousDaemon 启动', {
      scan_interval: this.config.scan_interval_seconds,
    });

    // 启动 SwarmCoordinator 后台调度循环
    this.dispatchPromise = this.coordinator.runContinuously(5.0);
    // Bug 1 修复：启动后台任务消费循环（持续执行 ASSIGNED 任务）
    this.consumerPromise = this.taskConsumerLoop();

    let scanCount = 0;
    while (this.running) {
      scanCount += 1;
      try {
        this.scanCount = scanCount;
        this.logActivity('scan_started', `第 ${scanCount} 轮自主扫描`);

        // 1. 扫描项目，发现任务（状态感知去重内置）
        const tasks = scanProject(this.root, this.scannerConfig, (title) =>
          this.isTaskInProgress(title),
        );
        this.logActivity('scan_completed', `扫描完成：发现 ${tasks.length} 个潜在任务`, {
          scan_round: scanCount,
        });

        // 2. 提交任务（状态感知去重 + 限量）
        let submitted = 0;
        for (const task of tasks.slice(0, this.config.max_tasks_per_scan)) {
          if (this.isTaskInProgress(task.title)) {
            continue;
          }
          this.coordinator.submitTask(task);
          this.titleToTaskId.set(task.title, task.taskId);
          submitted += 1;
          this.logActivity('task_submitted', task.title, {
            task_id: task.taskId,
            required_capabilities: task.requiredCapabilities,
          });
        }

        // 3. 等待 dispatch 分发（任务执行由后台消费循环承担，Bug 1 修复）
        await this.sleepFn(1000);

        // 4. 等待下一轮扫描
        await this.sleepFn(this.config.scan_interval_seconds * 1000);
      } catch {
        // 出错后等 1 分钟再重试（对齐 Python）
        await this.sleepFn(60_000);
      }
    }

    // 清理：停止任务消费循环
    if (this.consumerPromise !== null) {
      await this.consumerPromise.catch(() => undefined);
      this.consumerPromise = null;
    }
    // 等待执行器任务结束（最多 5s，避免强制中断正在执行的 LLM 调用）
    if (this.executorPromises.size > 0) {
      const all = Promise.allSettled([...this.executorPromises]);
      await Promise.race([all, this.sleepFn(5000)]);
      this.executorPromises.clear();
    }
    // 停止 SwarmCoordinator 调度循环
    this.coordinator.stop();
    if (this.dispatchPromise !== null) {
      await this.dispatchPromise.catch(() => undefined);
      this.dispatchPromise = null;
    }
    this.logActivity('daemon_stopped', 'AutonomousDaemon 已停止', {
      total_scans: scanCount,
    });
  }

  /** 停止自主运行（软停止：当前轮结束后退出） */
  stop(): void {
    this.running = false;
  }

  /**
   * 状态感知的任务去重检查（修复死循环 Bug）。
   *
   * - PENDING/ASSIGNED/RUNNING → true（进行中，跳过提交）
   * - COMPLETED/FAILED/CANCELLED/REASSIGNED → false（允许重新提交）
   * - 未找到 task_id 或任务不存在 → false（首次提交或被清理）
   */
  isTaskInProgress(title: string): boolean {
    const taskId = this.titleToTaskId.get(title);
    if (taskId === undefined) {
      return false;
    }
    const task = this.coordinator.tasks.get(taskId);
    if (task === undefined) {
      return false;
    }
    return (
      task.status === SwarmTaskStatus.PENDING ||
      task.status === SwarmTaskStatus.ASSIGNED ||
      task.status === SwarmTaskStatus.RUNNING
    );
  }

  /** 扫描项目发现任务（公开入口，供测试/手动触发） */
  scanProjectOnce(): SwarmTask[] {
    return scanProject(this.root, this.scannerConfig, (title) =>
      this.isTaskInProgress(title),
    );
  }

  // ── 任务执行（真实 LLM 调用，铁律 3）────────────────────────

  /**
   * 后台任务消费循环（Bug 1 修复）。
   *
   * 每 consumer_interval（默认 5s）轮询一次，与 dispatch 节奏对齐，
   * 确保扫描间隔内新分配的任务也会被尽快执行（避免心跳超时 FAILED）。
   */
  private async taskConsumerLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.executeAssignedTasks();
      } catch {
        // 循环不退出（对齐 Python）
      }
      await this.sleepFn(this.config.consumer_interval_seconds * 1000);
    }
  }

  /**
   * 执行所有 ASSIGNED 状态的任务。
   *
   * Bug 1 修复：拾取后立即上报 heartbeat(0.1) 推进状态为 RUNNING
   * 防重复拾取；全局并发控制按当前 RUNNING 数计算剩余容量。
   */
  async executeAssignedTasks(): Promise<void> {
    // 全局并发控制：当前 RUNNING（执行中）任务数
    let runningCount = 0;
    for (const task of this.coordinator.tasks.values()) {
      if (task.status === SwarmTaskStatus.RUNNING) {
        runningCount += 1;
      }
    }
    let remaining = Math.max(0, this.config.max_concurrent_tasks - runningCount);
    if (remaining <= 0) {
      return;
    }

    for (const task of [...this.coordinator.tasks.values()]) {
      if (remaining <= 0) {
        break;
      }
      if (task.status === SwarmTaskStatus.ASSIGNED && task.assignedAgentId) {
        // 立即上报心跳推进状态为 RUNNING（防重复拾取）
        try {
          await this.coordinator.heartbeat(task.assignedAgentId, task.taskId, 0.1, 'busy');
        } catch {
          // 容错（对齐 Python）
        }
        // 异步执行（不阻塞消费循环）
        const executor = this.executeTask(task).catch(() => undefined);
        this.executorPromises.add(executor);
        void executor.finally(() => this.executorPromises.delete(executor));
        remaining -= 1;
      }
    }
  }

  /**
   * 执行单个任务 — 调用灵智体 LLM 生成结果。
   *
   * 流程：heartbeat(0.1) → 心跳保活 → chat() → 停保活 →
   * 无效检测 → 落盘 → heartbeat(1.0)。
   */
  async executeTask(task: SwarmTask): Promise<void> {
    const agentId = task.assignedAgentId ?? '';
    const forgekin = this.forgekins.get(agentId);

    if (!forgekin) {
      // Bug 4 修复：未注册灵智体时显式终结任务，避免静默悬挂
      this.logActivity('task_failed', task.title, {
        task_id: task.taskId,
        agent_id: agentId,
        error: 'forgekin_not_registered',
      });
      this.coordinator.failTask(task.taskId, `forgekin 未注册: ${agentId}`);
      return;
    }

    // 心跳保活 — LLM 调用可能耗时 30-90s，需定期心跳防超时
    let keepaliveStopped = false;
    const keepalive = (async () => {
      let progress = 0.1;
      while (!keepaliveStopped) {
        try {
          await this.coordinator.heartbeat(agentId, task.taskId, progress, 'busy');
        } catch {
          // 容错（对齐 Python）
        }
        await this.sleepFn(this.config.keepalive_interval_seconds * 1000);
        progress = Math.min(0.9, progress + 0.1);
      }
    })();

    try {
      // 1. 上报开始
      await this.coordinator.heartbeat(agentId, task.taskId, 0.1, 'busy');

      // 2. 构造任务消息，调用 LLM
      const taskPrompt = this.buildTaskPrompt(task);
      const messages = [{ role: 'user', content: taskPrompt }];
      const result = await forgekin.chat(messages);

      // 3. 停止心跳保活
      keepaliveStopped = true;
      await keepalive.catch(() => undefined);

      // 4. 保存结果
      const content = typeof result.content === 'string' ? result.content : '';
      const model = typeof result.model === 'string' ? result.model : 'unknown';

      // 无效响应检测（铁律 2：禁止假数据；Bug 2 修复：CLI 错误前缀 + usage.error）
      const usage = result.usage as Record<string, unknown> | undefined;
      const usageError =
        usage !== null && typeof usage === 'object' && typeof usage.error === 'string'
          ? usage.error
          : '';
      const isInvalid =
        content.length === 0 ||
        content.length < MIN_VALID_OUTPUT_LENGTH ||
        INVALID_OUTPUT_MARKERS.some((marker) => content.includes(marker)) ||
        usageError.length > 0;
      if (isInvalid) {
        this.logActivity('task_invalid_output', task.title, {
          task_id: task.taskId,
          agent_id: agentId,
          model,
          content_length: content.length,
          content_preview: content.length > 0 ? content.slice(0, 200) : '(empty)',
          reason: '无效响应（无法回答/余额不足/超时/CLI 错误等）',
        });
        await this.coordinator.heartbeat(agentId, task.taskId, 0.0, 'error');
        // Bug 5 修复：主动终结任务
        this.coordinator.failTask(
          task.taskId,
          `invalid_output${usageError.length > 0 ? `: ${usageError}` : ''}`,
        );
        return;
      }

      task.result = {
        content,
        model,
        summary: content.length > 0 ? content.slice(0, 200) : '',
        completed_by: agentId,
        completed_at: new Date().toISOString(),
      };

      // 5. 真实落盘产出（铁律 2）
      const outputPath = this.persistTaskOutput(task, content, model);

      // 6. 上报完成（progress=1.0 触发 COMPLETED）
      await this.coordinator.heartbeat(agentId, task.taskId, 1.0, 'idle');

      this.logActivity('task_completed', task.title, {
        task_id: task.taskId,
        agent_id: agentId,
        model,
        content_length: content.length,
        content_preview: content.length > 0 ? content.slice(0, 300) : '',
        output_path: outputPath,
      });
      // 保存产出供 Web 可观测性展示（保留最近 50 条）
      this.completedOutputs.push({
        timestamp: new Date().toISOString(),
        task_id: task.taskId,
        title: task.title,
        agent_id: agentId,
        model,
        content,
        content_preview: content.length > 0 ? content.slice(0, 500) : '',
        output_path: outputPath,
      });
      if (this.completedOutputs.length > 50) {
        this.completedOutputs = this.completedOutputs.slice(-50);
      }
    } catch (error) {
      keepaliveStopped = true;
      const message = error instanceof Error ? error.message : String(error);
      this.logActivity('task_failed', task.title, {
        task_id: task.taskId,
        agent_id: agentId,
        error: message,
      });
      await this.coordinator.heartbeat(agentId, task.taskId, 0.0, 'error').catch(() => undefined);
      // Bug 5 修复：主动终结任务
      this.coordinator.failTask(task.taskId, `execution_exception: ${message}`);
    }
  }

  // ── 产出落盘（铁律 2：真实落盘）──────────────────────────────

  /**
   * 真实落盘任务产出。
   *
   * - doc_generation: 直接写入 docs 目录（声明式、不破坏代码）
   * - code_generation/test_generation: 写入 patches 目录供 operator 审阅
   * - 未知类型: 通用落盘到 outputs 目录
   *
   * @returns 落盘文件的相对路径（相对 project_root），失败时返回 null
   */
  persistTaskOutput(task: SwarmTask, content: string, model: string): string | null {
    if (!content) {
      return null;
    }

    const ctx = task.context ?? {};
    const required = task.requiredCapabilities;
    const ts = new Date().toISOString().replaceAll(/[-:]/g, '').replace('T', '_').slice(0, 15);

    try {
      if (required.includes('doc_generation')) {
        // 文档任务：直接写入目标路径
        let docRel = typeof ctx.doc_path === 'string' ? ctx.doc_path : '';
        if (docRel.length === 0) {
          docRel = path.join('docs', `autonomous_${ts}_${task.taskId.slice(0, 8)}.md`);
        }
        const target = path.join(this.root, docRel);
        mkdirSync(path.dirname(target), { recursive: true });
        // 添加 front-matter（铁律：文档必须含 front-matter）
        let finalContent = content;
        if (!content.startsWith('---')) {
          const frontmatter =
            '---\n' +
            'status: draft\n' +
            'type: autonomous_generated\n' +
            `created_at: ${new Date().toISOString()}\n` +
            `generated_by: ${task.assignedAgentId ?? 'unknown'}\n` +
            `model: ${model}\n` +
            `task_id: ${task.taskId}\n` +
            '---\n\n';
          finalContent = frontmatter + content;
        }
        writeFileSync(target, finalContent, 'utf-8');
        return docRel.split(path.sep).join('/');
      }

      if (required.includes('code_generation') || required.includes('test_generation')) {
        // 代码/测试任务：写入 patches 供 operator 审阅
        const patchesDir = path.join(this.root, this.patchesDirName);
        mkdirSync(patchesDir, { recursive: true });
        const sourceFile =
          (typeof ctx.file === 'string' && ctx.file) ||
          (typeof ctx.module === 'string' && ctx.module) ||
          'output';
        const sourceBasename = path.basename(String(sourceFile)).replace(/\.[^.]+$/, '');
        const patchFileName = `${task.taskId.slice(0, 12)}_${sourceBasename}.md`;
        const target = path.join(patchesDir, patchFileName);
        const header =
          '# 自主任务产出审阅\n\n' +
          `- **task_id**: ${task.taskId}\n` +
          `- **title**: ${task.title}\n` +
          `- **agent**: ${task.assignedAgentId ?? 'unknown'}\n` +
          `- **model**: ${model}\n` +
          `- **generated_at**: ${new Date().toISOString()}\n` +
          `- **source_file**: ${String(sourceFile)}\n` +
          `- **required_capabilities**: ${required.join(', ')}\n` +
          '\n## 审阅指南\n\n' +
          '1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）\n' +
          '2. 检查是否引入循环依赖或违反分层架构\n' +
          '3. 通过审核后，将下方代码块内容应用到对应源文件\n' +
          '4. 应用后必须运行对应测试验证（铁律 T1-T8）\n' +
          `\n## 任务上下文\n\n\`\`\`\n${task.description}\n\`\`\`\n` +
          '\n## LLM 产出内容\n\n';
        writeFileSync(target, header + content, 'utf-8');
        return path.relative(this.root, target).split(path.sep).join('/');
      }

      // 未知任务类型：通用落盘
      const outputsDir = path.join(this.root, this.outputsDirName);
      mkdirSync(outputsDir, { recursive: true });
      const target = path.join(outputsDir, `${task.taskId.slice(0, 12)}_${ts}.md`);
      writeFileSync(target, content, 'utf-8');
      return path.relative(this.root, target).split(path.sep).join('/');
    } catch {
      return null;
    }
  }

  // ── 提示词构造（真实文件上下文，铁律 2）──────────────────────

  /** 构造任务执行提示词（基于任务信息 + 真实文件上下文） */
  buildTaskPrompt(task: SwarmTask): string {
    let prompt =
      '你被分配了一个自主任务，请基于你的角色能力完成：\n\n' +
      `任务标题: ${task.title}\n` +
      `任务描述: ${task.description}\n` +
      `需要能力: ${task.requiredCapabilities.join(', ')}\n`;
    if (Object.keys(task.context).length > 0) {
      prompt += `上下文: ${JSON.stringify(task.context)}\n`;
    }

    const ctx = task.context;
    const required = task.requiredCapabilities;
    if (required.includes('doc_generation')) {
      prompt += this.buildDocContext(ctx);
    } else if (required.includes('code_generation')) {
      prompt += this.buildCodeContext(ctx);
    } else if (required.includes('test_generation')) {
      prompt += this.buildTestContext(ctx);
    }

    prompt +=
      '\n【重要】以上是项目真实文件内容，请基于实际代码和项目结构生成具体的、' +
      '可执行的成果。禁止生成假设性代码或示例代码——必须针对真实文件' +
      '进行修改或补充。产出格式：\n' +
      '- 文档任务：直接输出 Markdown 文档内容\n' +
      '- 代码任务：输出完整的修改后代码（带文件路径标注）\n' +
      '- 测试任务：输出完整的测试代码（带文件路径标注）';
    return prompt;
  }

  /** 为文档生成任务附加项目真实结构上下文 */
  private buildDocContext(ctx: Record<string, unknown>): string {
    const parts: string[] = ['\n--- 项目真实结构（用于生成文档参考）---\n'];
    try {
      const entries = readdirSync(this.root).sort();
      for (const name of entries) {
        if (name.startsWith('.') || this.scannerConfig.excludedDirs.has(name)) {
          continue;
        }
        const full = path.join(this.root, name);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          parts.push(`DIR ${name}/`);
          try {
            const subs = readdirSync(full).sort().slice(0, 8);
            for (const sub of subs) {
              if (!sub.startsWith('.')) {
                parts.push(`   - ${sub}`);
              }
            }
          } catch {
            // 容错（对齐 Python）
          }
        } else {
          parts.push(`FILE ${name}`);
        }
      }
    } catch {
      // 容错（对齐 Python）
    }

    const readmePath = path.join(this.root, 'README.md');
    if (safeExists(readmePath)) {
      try {
        const readme = readFileSync(readmePath, 'utf-8');
        parts.push('\n--- README.md（前800字）---\n');
        parts.push(readme.slice(0, 800));
      } catch {
        // 容错
      }
    }

    const docPath = typeof ctx.doc_path === 'string' ? ctx.doc_path : '';
    if (docPath.length > 0) {
      const targetDoc = path.join(this.root, docPath);
      if (safeExists(targetDoc)) {
        try {
          const existing = readFileSync(targetDoc, 'utf-8');
          parts.push(`\n--- 现有 ${docPath} 内容（前1000字，供参考）---\n`);
          parts.push(existing.slice(0, 1000));
        } catch {
          // 容错
        }
      } else {
        parts.push(`\n目标文档 ${docPath} 不存在，需新建。`);
      }
    }

    return `${parts.join('\n')}\n`;
  }

  /** 为代码修复任务附加目标文件真实完整内容 */
  private buildCodeContext(ctx: Record<string, unknown>): string {
    const fileRel = typeof ctx.file === 'string' ? ctx.file : '';
    if (fileRel.length === 0) {
      return '';
    }
    const targetFile = path.join(this.root, fileRel);
    if (!safeExists(targetFile)) {
      return `\n目标文件 ${fileRel} 不存在。\n`;
    }
    let content: string;
    try {
      content = readFileSync(targetFile, 'utf-8');
    } catch (error) {
      return `\n读取文件 ${fileRel} 失败: ${String(error)}\n`;
    }
    return (
      `\n--- 目标文件 ${fileRel} 完整内容（${content.length} 字符）---\n` +
      `${content}\n` +
      '--- 文件结束 ---\n' +
      '请在上述真实代码基础上，修复其中的 TODO/FIXME/NotImplementedError，' +
      '输出完整的修改后文件内容。禁止生成假设性或示例性代码。'
    );
  }

  /** 为测试生成任务附加目标模块真实完整内容 */
  private buildTestContext(ctx: Record<string, unknown>): string {
    const moduleRel = typeof ctx.module === 'string' ? ctx.module : '';
    if (moduleRel.length === 0) {
      return '';
    }
    const targetMod = path.join(this.root, moduleRel);
    if (!safeExists(targetMod)) {
      return `\n目标模块 ${moduleRel} 不存在。\n`;
    }
    let content: string;
    try {
      content = readFileSync(targetMod, 'utf-8');
      const maxLen = 6000;
      if (content.length > maxLen) {
        content = `${content.slice(0, maxLen)}\n\n# ... (已截断，共 ${content.length} 字符)`;
      }
    } catch (error) {
      return `\n读取模块 ${moduleRel} 失败: ${String(error)}\n`;
    }
    return (
      `\n--- 目标模块 ${moduleRel} 完整内容（供编写测试参考）---\n` +
      `${content}\n` +
      '--- 模块结束 ---\n' +
      '请基于上述真实代码，为其中的核心类和函数编写单元测试。' +
      '输出完整的测试代码，禁止生成假设性测试。'
    );
  }

  // ── 状态查询 ────────────────────────────────────────────────

  /** 记录自进化活动（供 API 和 Web 可观测性查询） */
  logActivity(eventType: string, title: string, extra: Record<string, unknown> = {}): void {
    this.activityLog.push({
      timestamp: new Date().toISOString(),
      event_type: eventType,
      title,
      ...extra,
    });
    // 保留最近 200 条
    if (this.activityLog.length > 200) {
      this.activityLog = this.activityLog.slice(-200);
    }
  }

  /** 获取 daemon 运行状态（供 /api/v1/forgemind/autonomous/status 查询） */
  getStatus(): Record<string, unknown> {
    const tasks = [...this.coordinator.tasks.values()];
    const recentActivities = this.activityLog.slice(-20);
    const completedCount = this.activityLog.filter(
      (a) => a.event_type === 'task_completed',
    ).length;
    const failedCount = this.activityLog.filter((a) => a.event_type === 'task_failed').length;
    return {
      running: this.running,
      scan_interval_seconds: this.config.scan_interval_seconds,
      scan_count: this.scanCount,
      registered_forgekins: [...this.forgekins.keys()],
      total_tasks: tasks.length,
      pending: tasks.filter((t) => t.status === SwarmTaskStatus.PENDING).length,
      assigned: tasks.filter((t) => t.status === SwarmTaskStatus.ASSIGNED).length,
      running_tasks: tasks.filter((t) => t.status === SwarmTaskStatus.RUNNING).length,
      completed: tasks.filter((t) => t.status === SwarmTaskStatus.COMPLETED).length,
      failed: tasks.filter((t) => t.status === SwarmTaskStatus.FAILED).length,
      submitted_titles: this.titleToTaskId.size,
      activity_log_count: this.activityLog.length,
      completed_tasks_total: completedCount,
      failed_tasks_total: failedCount,
      recent_activities: recentActivities,
    };
  }

  /** 获取自进化活动历史（供 Web 可观测性展示，倒序） */
  getActivityLog(limit = 100): AutonomousActivityEntry[] {
    return [...this.activityLog.slice(-limit)].reverse();
  }

  /** 获取已完成任务的产出（供 Web 聊天和可观测性展示，倒序） */
  getCompletedOutputs(limit = 20): AutonomousCompletedOutput[] {
    return [...this.completedOutputs.slice(-limit)].reverse();
  }
}

/** 安全 existsSync（文件存在且为文件） */
function safeExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
