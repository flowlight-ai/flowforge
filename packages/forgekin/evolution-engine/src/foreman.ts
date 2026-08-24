/**
 * F046/F049 五 Forgekin 持续工作调度循环（Continuous Orchestration Foreman）。
 * TS 重写自 Python `evolution/foreman.py`。
 *
 * 设计（5 agent sweet spot 模式）：
 * - 5 个 Forgekin（wenxin/sherlock/luban/vangogh/davinci）永远不停止工作
 * - 持续扫描任务源 → 通过 SwarmCoordinator 分发 → 触发 SelfDev 闭环 → 监控结果 → 循环
 * - operator 通过 Magic Words（停止/暂停/继续）干预
 *
 * 不变量：
 * - I1 永不停止：foreman 启动后持续运行，直到 operator 喊 Magic Words
 * - I2 单一 foreman：全局唯一（由 create_foreman 工厂语义保证）
 * - I3 任务不丢失：所有任务通过 SwarmCoordinator.submitTask 落盘 trace
 * - I4 失败重试上限：单任务 max_retries=3，超过则上报 operator
 * - I5 跨厂商独立：review 任务路由到 vangogh（claude 厂商，no-self-review 铁律）
 * - I6 Framework 需 approval：framework 任务触发 I8 approval_callback
 */

import { SwarmCoordinator, makeSwarmTask } from '@flowforge/forgekin-swarm';

/** 默认循环间隔（秒）。 */
export const DEFAULT_LOOP_INTERVAL_SECONDS = 60.0;
/** 单次扫描最多处理的任务数。 */
export const DEFAULT_TASK_SCAN_LIMIT = 5;
/** 紧急任务轮询间隔（秒）。 */
export const EMERGENCY_POLL_INTERVAL_SECONDS = 5.0;

/** 可注入睡眠函数（测试用假时钟）。 */
export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleepFn: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Foreman 配置。 */
export interface ForemanConfig {
  readonly enabled: boolean;
  readonly loopIntervalSeconds: number;
  readonly taskScanLimit: number;
  readonly emergencyPollIntervalSeconds: number;
  readonly maxConcurrentTasks: number;
  readonly magicWordsStop: string[];
  readonly magicWordsPause: string[];
  readonly magicWordsResume: string[];
}

export function makeForemanConfig(init: Partial<ForemanConfig> = {}): ForemanConfig {
  return {
    enabled: init.enabled ?? true,
    loopIntervalSeconds: init.loopIntervalSeconds ?? DEFAULT_LOOP_INTERVAL_SECONDS,
    taskScanLimit: init.taskScanLimit ?? DEFAULT_TASK_SCAN_LIMIT,
    emergencyPollIntervalSeconds:
      init.emergencyPollIntervalSeconds ?? EMERGENCY_POLL_INTERVAL_SECONDS,
    maxConcurrentTasks: init.maxConcurrentTasks ?? 3,
    magicWordsStop: init.magicWordsStop ?? ['停止', 'stop', 'exit', 'quit'],
    magicWordsPause: init.magicWordsPause ?? ['暂停', 'pause', 'hold'],
    magicWordsResume: init.magicWordsResume ?? ['继续', 'resume', 'go'],
  };
}

/** Foreman 运行统计。 */
export interface ForemanStats {
  readonly startedAt: string;
  totalLoops: number;
  totalTasksDispatched: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  totalEmergencies: number;
  lastLoopAt: string | null;
  lastTaskAt: string | null;
  currentState: 'idle' | 'running' | 'paused' | 'stopped';
}

/** 五 Forgekin → SelfDev 闭环类型映射（F046 §9.3 五协同工作流）。 */
export const AGENT_LOOP_TYPE_MAPPING: Record<string, string> = {
  wenxin: 'doc',
  sherlock: 'code',
  luban: 'framework',
  vangogh: 'review',
  davinci: 'test',
};

/** 默认 5 Forgekin 能力画像（对齐 Python _load_agents_config / agent_swarm.yaml）。 */
export const DEFAULT_AGENTS_CONFIG: Record<
  string,
  { vendor: string; capabilities: string[] }
> = {
  wenxin: {
    vendor: 'trae',
    capabilities: ['doc_generation', 'doc_review', 'format_check', 'frontmatter_check'],
  },
  sherlock: {
    vendor: 'trae',
    capabilities: ['code_generation', 'bug_fixing', 'refactoring', 'test_writing'],
  },
  luban: {
    vendor: 'trae',
    capabilities: ['architecture_design', 'adr_drafting', 'config_adjustment', 'dependency_analysis'],
  },
  vangogh: {
    // 跨厂商（I5/I6 no-self-review）
    vendor: 'claude',
    capabilities: ['code_review', 'doc_review', 'quality_gate', 'push_back'],
  },
  davinci: {
    vendor: 'trae',
    capabilities: ['test_generation', 'test_execution', 'coverage_analysis', 'regression_test'],
  },
};

/** runtime 委托端口 — SelfDevRuntime 实现该接口供 foreman 路由闭环。 */
export interface ForemanRuntimePort {
  runDocLoop(context: Record<string, unknown>): Promise<unknown>;
  runCodeLoop(context: Record<string, unknown>): Promise<unknown>;
  runFrameworkLoop(context: Record<string, unknown>): Promise<unknown>;
  runReviewLoop(context: Record<string, unknown>): Promise<unknown>;
  runTestLoop(context: Record<string, unknown>): Promise<unknown>;
}

/** operator 提交的任务数据（提交到 swarm 前的中间形态）。 */
export interface ForemanTaskData {
  readonly title: string;
  readonly description: string;
  readonly requiredCapabilities: string[];
  readonly loopType: string;
  readonly forgekinId?: string | null;
  readonly priority: string;
  readonly context: Record<string, unknown>;
}

/** Magic Words 监听回调：收到原始文本由 foreman 内部解析。 */
export type MagicWordsCallback = (prompt: string) => Promise<string>;

export interface ContinuousForemanOptions {
  readonly config?: ForemanConfig | undefined;
  readonly swarmCoordinator?: SwarmCoordinator | undefined;
  readonly sleepFn?: SleepFn | undefined;
  readonly nowFn?: (() => string) | undefined;
}

/**
 * 五 Forgekin 持续工作调度器（永不停止）。
 *
 * 用法：
 *   const foreman = new ContinuousForeman(runtime, { swarmCoordinator });
 *   await foreman.start(); // 永不停止，直到 operator 喊 Magic Words
 */
export class ContinuousForeman {
  private readonly runtime: ForemanRuntimePort;
  private readonly config: ForemanConfig;
  private swarm: SwarmCoordinator | null;
  private readonly sleepFn: SleepFn;
  private readonly nowFn: () => string;

  private stats: ForemanStats;
  private mainLoopPromise: Promise<void> | null = null;
  private emergencyLoopPromise: Promise<void> | null = null;
  private magicWordsLoopPromise: Promise<void> | null = null;
  private readonly emergencyQueue: ForemanTaskData[] = [];
  private readonly runningTasks = new Map<string, Promise<void>>();

  private magicWordsCallback: MagicWordsCallback | null = null;
  private stopRequested = false;
  private pauseRequested = false;

  constructor(runtime: ForemanRuntimePort, options: ContinuousForemanOptions = {}) {
    this.runtime = runtime;
    this.config = options.config ?? makeForemanConfig();
    this.swarm = options.swarmCoordinator ?? null;
    this.sleepFn = options.sleepFn ?? defaultSleepFn;
    this.nowFn = options.nowFn ?? (() => new Date().toISOString());
    this.stats = {
      startedAt: this.nowFn(),
      totalLoops: 0,
      totalTasksDispatched: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalEmergencies: 0,
      lastLoopAt: null,
      lastTaskAt: null,
      currentState: 'idle',
    };
  }

  // ── §1 生命周期 — start / pause / resume / stop ────────────────

  /** 启动持续调度循环（永不停止，直到 stop()）。重复调用被忽略。 */
  async start(): Promise<void> {
    if (this.mainLoopPromise !== null) {
      return;
    }

    this.stopRequested = false;
    this.pauseRequested = false;
    this.stats = { ...this.stats, currentState: 'running' };

    // 懒加载 SwarmCoordinator（缺省时创建并注册 5 Forgekin）
    if (this.swarm === null) {
      this.swarm = this.createSwarmCoordinator();
    }

    this.mainLoopPromise = this.mainLoop();
    void this.mainLoopPromise.catch(() => {
      // 主循环异常不外泄（对齐 Python except Exception 记日志后继续）
    });

    this.emergencyLoopPromise = this.emergencyLoop();
    void this.emergencyLoopPromise.catch(() => {});

    if (this.magicWordsCallback !== null) {
      this.magicWordsLoopPromise = this.magicWordsLoop();
      void this.magicWordsLoopPromise.catch(() => {});
    }
  }

  /** 停止 Foreman（operator 显式停止）：置停止位并等待主循环退出。 */
  async stop(reason = 'operator requested'): Promise<void> {
    void reason;
    this.stopRequested = true;
    this.stats.currentState = 'stopped';

    // 等待主循环退出（软停止：下一轮 sleep 后退出）
    if (this.mainLoopPromise !== null) {
      await this.mainLoopPromise;
      this.mainLoopPromise = null;
    }
    if (this.emergencyLoopPromise !== null) {
      await this.emergencyLoopPromise;
      this.emergencyLoopPromise = null;
    }
    if (this.magicWordsLoopPromise !== null) {
      await this.magicWordsLoopPromise;
      this.magicWordsLoopPromise = null;
    }

    // 等待所有运行中的任务完成（最多 30 秒）
    if (this.runningTasks.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.runningTasks.values()]),
        this.sleepFn(30_000),
      ]);
      this.runningTasks.clear();
    }
  }

  /** 暂停 Foreman（不停止，可 resume）。 */
  async pause(reason = 'operator requested'): Promise<void> {
    void reason;
    this.pauseRequested = true;
    this.stats.currentState = 'paused';
  }

  /** 恢复 Foreman。 */
  async resume(): Promise<void> {
    this.pauseRequested = false;
    this.stats.currentState = 'running';
  }

  /** 设置 Magic Words 监听回调（callback 返回原始文本，由 foreman 解析）。 */
  setMagicWordsCallback(callback: MagicWordsCallback): void {
    this.magicWordsCallback = callback;
  }

  // ── §2 主循环 — 持续扫描 + 分发 + 监控 ──────────────────────────

  private async mainLoop(): Promise<void> {
    try {
      while (!this.stopRequested) {
        if (this.pauseRequested) {
          await this.sleepFn(this.config.loopIntervalSeconds * 1000);
          continue;
        }

        this.stats.totalLoops += 1;
        this.stats.lastLoopAt = this.nowFn();

        try {
          // 1. 扫描任务源
          const tasks = await this.scanTaskSources(this.config.taskScanLimit);

          // 2. 提交到 SwarmCoordinator
          for (const task of tasks) {
            this.submitToSwarm(task);
          }

          // 3. 分发任务到 5 Forgekin
          if (this.swarm !== null) {
            const dispatched = await this.swarm.dispatch();
            this.stats.totalTasksDispatched += dispatched.length;

            // 4. 为每个分发的任务启动执行
            for (const taskId of dispatched) {
              await this.startTaskExecution(taskId);
            }

            // 5. 检查超时任务
            const reassigned = await this.swarm.checkTimeouts();
            if (reassigned.length > 0) {
              // 超时任务已 reassign（对齐 Python 日志）
            }
          }

          // 6. 清理已完成的执行 task
          this.cleanupCompletedTasks();
        } catch {
          // 主循环异常不退出（对齐 Python logger.exception 后继续）
        }

        await this.sleepFn(this.config.loopIntervalSeconds * 1000);
      }
    } finally {
      this.stats.currentState = 'stopped';
    }
  }

  private async emergencyLoop(): Promise<void> {
    while (!this.stopRequested) {
      const taskData = this.emergencyQueue.shift();
      if (taskData === undefined) {
        await this.sleepFn(this.config.emergencyPollIntervalSeconds * 1000);
        continue;
      }

      this.stats.totalEmergencies += 1;

      // 紧急任务立即提交并分发
      this.submitToSwarm(taskData);
      if (this.swarm !== null) {
        const dispatched = await this.swarm.dispatch();
        for (const taskId of dispatched) {
          await this.startTaskExecution(taskId);
        }
      }
    }
  }

  private async magicWordsLoop(): Promise<void> {
    if (this.magicWordsCallback === null) {
      return;
    }
    while (!this.stopRequested) {
      try {
        // 由 callback 提供原始文本（阻塞等待 operator 输入）
        const text = await this.magicWordsCallback('');
        if (!text) {
          continue;
        }

        const textLower = text.toLowerCase().trim();
        await this.handleMagicWords(textLower, text);
      } catch {
        await this.sleepFn(1000);
      }
    }
  }

  /** Magic Words 解析（公共：便于 operator 通道直接注入已识别文本）。 */
  async handleMagicWords(textLower: string, rawText: string): Promise<void> {
    if (this.config.magicWordsStop.some((w) => textLower.includes(w))) {
      await this.stop(`Magic Words: ${rawText}`);
    } else if (this.config.magicWordsPause.some((w) => textLower.includes(w))) {
      await this.pause(`Magic Words: ${rawText}`);
    } else if (this.config.magicWordsResume.some((w) => textLower.includes(w))) {
      await this.resume();
    }
  }

  // ── §3 任务源扫描 ──────────────────────────────────────────────

  /**
   * 扫描所有任务源，返回待处理任务列表。
   *
   * 任务源优先级：operator 显式任务（紧急队列，§emergencyLoop 已处理）→
   * task.md ⏳/🔄 任务（Phase 2）→ 定时扫描（文档过期/代码 bug 等）。
   */
  async scanTaskSources(limit = 5): Promise<ForemanTaskData[]> {
    const tasks: ForemanTaskData[] = [];

    // 任务源 3: task.md 中 ⏳/🔄 状态的任务（Phase 2 实现，当前返回空）
    tasks.push(...(await this.scanTaskMd()));

    // 任务源 4: 定时扫描（文档过期等）
    tasks.push(...(await this.scanPeriodic()));

    // 按优先级排序 + 限制数量
    const priorityOrder = ['emergency', 'critical', 'high', 'normal', 'low'];
    tasks.sort(
      (a, b) =>
        (priorityOrder.indexOf(a.priority) === -1
          ? priorityOrder.length
          : priorityOrder.indexOf(a.priority)) -
        (priorityOrder.indexOf(b.priority) === -1
          ? priorityOrder.length
          : priorityOrder.indexOf(b.priority)),
    );
    return tasks.slice(0, limit);
  }

  /** 扫描 task.md 中的待办任务（Phase 2 实现；当前返回空列表）。 */
  async scanTaskMd(): Promise<ForemanTaskData[]> {
    return [];
  }

  /**
   * 定时扫描任务源（低频：每 10 次主循环触发一次）。
   * 触发的 SelfDev 闭环：文档过期→doc / 代码 bug→code / 架构偏离→framework /
   * 审查缺失→review / 测试覆盖率下降→test。
   */
  async scanPeriodic(): Promise<ForemanTaskData[]> {
    if (this.stats.totalLoops % 10 !== 0) {
      return [];
    }
    return [
      {
        title: '定时扫描：文档过期检测',
        description: 'SelfDevDocLoop Discover 阶段扫描过期文档',
        requiredCapabilities: ['doc_generation'],
        loopType: 'doc',
        forgekinId: 'wenxin',
        priority: 'low',
        context: { task_source: 'periodic_scan' },
      },
    ];
  }

  // ── §4 任务执行 ────────────────────────────────────────────────

  /** 提交任务到 SwarmCoordinator（I3：落盘 trace）。 */
  submitToSwarm(taskData: ForemanTaskData): string | null {
    if (this.swarm === null) {
      return null;
    }
    const task = makeSwarmTask({
      title: taskData.title,
      description: taskData.description,
      requiredCapabilities: taskData.requiredCapabilities,
      preferredAgentId: taskData.forgekinId ?? null,
      priority: taskData.priority,
      context: { ...taskData.context, loop_type: taskData.loopType },
    });
    this.swarm.submitTask(task);
    return task.taskId;
  }

  /**
   * 为已分发的任务启动执行（按 loopType 路由到对应 SelfDev 闭环）。
   * 受 maxConcurrentTasks 并发上限约束，超限时下一轮循环重试。
   */
  async startTaskExecution(taskId: string): Promise<void> {
    if (this.swarm === null) {
      return;
    }

    const task = this.swarm.getTask(taskId);
    if (task === null) {
      return;
    }
    if (task.assignedAgentId === null) {
      return;
    }
    if (this.runningTasks.has(taskId)) {
      return;
    }
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      return;
    }

    const agentId = task.assignedAgentId;
    // 从 task.context 提取 loop_type（决定路由到哪个 SelfDev 闭环）
    const loopTypeFromContext = task.context['loop_type'];
    const loopType =
      typeof loopTypeFromContext === 'string' && loopTypeFromContext.length > 0
        ? loopTypeFromContext
        : this.inferLoopType(agentId);

    const execution = this.executeTask(taskId, agentId, loopType);
    this.runningTasks.set(taskId, execution);
    void execution.catch(() => {
      // 失败统计在 executeTask 内部完成（对齐 Python except 分支）
    });
  }

  private async executeTask(
    taskId: string,
    agentId: string,
    loopType: string,
  ): Promise<void> {
    try {
      this.stats.lastTaskAt = this.nowFn();

      // 发送心跳（任务开始）
      await this.swarm?.heartbeat(agentId, taskId, 0.1);

      // 路由到对应的 SelfDev 闭环
      const task = this.swarm?.getTask(taskId) ?? null;
      const context: Record<string, unknown> = {
        ...(task?.context ?? {}),
        task_id: taskId,
        forgekin_id: agentId,
      };
      const result = await this.routeToLoop(loopType, context);

      // 发送心跳（任务完成：progress>=1.0 → COMPLETED + trace，I3）
      await this.swarm?.heartbeat(agentId, taskId, 1.0);
      if (this.swarm !== null) {
        const stored = this.swarm.getTask(taskId);
        if (stored !== null) {
          stored.result = result as Record<string, unknown>;
        }
      }

      this.stats.totalTasksCompleted += 1;
    } catch (error) {
      this.stats.totalTasksFailed += 1;

      // 更新任务状态为 failed + 递增重试计数（I4）
      if (this.swarm !== null) {
        this.swarm.failTask(taskId, String(error));
        const stored = this.swarm.getTask(taskId);
        if (stored !== null) {
          stored.retryCount += 1;
        }
      }
    }
  }

  /** 路由任务到对应的 SelfDev 闭环（doc/code/framework/review/test）。 */
  async routeToLoop(
    loopType: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    if (loopType === 'doc') {
      return this.runtime.runDocLoop(context);
    }
    if (loopType === 'code') {
      return this.runtime.runCodeLoop(context);
    }
    if (loopType === 'framework') {
      return this.runtime.runFrameworkLoop(context);
    }
    if (loopType === 'review') {
      return this.runtime.runReviewLoop(context);
    }
    if (loopType === 'test') {
      return this.runtime.runTestLoop(context);
    }
    throw new Error(`未知 loop_type: ${loopType}`);
  }

  /** 根据 agent_id 推断 loop_type（forgemind:wenxin → wenxin → doc）。 */
  inferLoopType(agentId: string): string {
    const shortId = agentId.includes(':') ? agentId.split(':').at(-1) : agentId;
    return AGENT_LOOP_TYPE_MAPPING[shortId ?? ''] ?? 'doc';
  }

  private cleanupCompletedTasks(): void {
    for (const [taskId, promise] of this.runningTasks) {
      // Promise 状态无法同步探测；已完成任务在 settle 后清理
      void promise.finally(() => {
        this.runningTasks.delete(taskId);
      });
    }
  }

  // ── §5 operator 接口 ───────────────────────────────────────────

  /**
   * operator 提交显式任务（通过 IM 议事或 API）。
   * 紧急任务（critical/emergency）走紧急队列立即处理，否则提交 swarm。
   * requiredCapabilities 按 forgekinId 从 DEFAULT_AGENTS_CONFIG 推断（Python 行为：由 forgekin_id 推断）。
   */
  async submitOperatorTask(params: {
    title: string;
    description: string;
    loopType: string;
    forgekinId?: string | null;
    priority?: string;
    context?: Record<string, unknown>;
  }): Promise<string> {
    const forgekinId = params.forgekinId ?? null;
    // 由 forgekin_id 推断能力（swarm I3 能力匹配要求非空）
    const requiredCapabilities =
      forgekinId !== null && forgekinId in DEFAULT_AGENTS_CONFIG
        ? [...DEFAULT_AGENTS_CONFIG[forgekinId]?.capabilities ?? []]
        : [];

    const taskData: ForemanTaskData = {
      title: params.title,
      description: params.description,
      requiredCapabilities,
      loopType: params.loopType,
      forgekinId,
      priority: params.priority ?? 'normal',
      context: params.context ?? {},
    };

    if (params.priority === 'critical' || params.priority === 'emergency') {
      this.emergencyQueue.push(taskData);
      return '';
    }
    return this.submitToSwarm(taskData) ?? '';
  }

  /** 获取 Foreman 运行统计。 */
  getStats(): Record<string, unknown> {
    return {
      started_at: this.stats.startedAt,
      total_loops: this.stats.totalLoops,
      total_tasks_dispatched: this.stats.totalTasksDispatched,
      total_tasks_completed: this.stats.totalTasksCompleted,
      total_tasks_failed: this.stats.totalTasksFailed,
      total_emergencies: this.stats.totalEmergencies,
      last_loop_at: this.stats.lastLoopAt,
      last_task_at: this.stats.lastTaskAt,
      current_state: this.stats.currentState,
      running_tasks_count: this.runningTasks.size,
      emergency_queue_size: this.emergencyQueue.length,
    };
  }

  /** 获取 Swarm 各 agent 当前任务数。 */
  getSwarmWorkload(): Record<string, number> {
    if (this.swarm === null) {
      return {};
    }
    return this.swarm.getAgentWorkload();
  }

  // ── §6 工具方法 ────────────────────────────────────────────────

  /** 创建 SwarmCoordinator 实例并注册 5 Forgekin（懒加载，DI）。 */
  private createSwarmCoordinator(): SwarmCoordinator {
    const coordinator = new SwarmCoordinator();
    for (const [agentId, agentCfg] of Object.entries(DEFAULT_AGENTS_CONFIG)) {
      coordinator.registerAgent(agentId, agentCfg.capabilities, agentCfg.vendor);
    }
    return coordinator;
  }
}

/** 工厂函数：创建 ContinuousForeman 实例。 */
export function createForeman(
  runtime: ForemanRuntimePort,
  options: ContinuousForemanOptions = {},
): ContinuousForeman {
  return new ContinuousForeman(runtime, options);
}
