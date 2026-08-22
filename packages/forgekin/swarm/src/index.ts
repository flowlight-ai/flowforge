/**
 * @flowforge/forgekin-swarm — 阶段7 T7.15 Swarm 协同调度域 Cordis 插件
 *
 * 挂载 `ctx.forgeSwarm`：多 Forgekin 协同调度（capability routing +
 * heartbeat 超时回收 + 跨厂商/no-self-review 过滤 + 能力互补推荐），
 * 对齐 Python `forgemind/swarm.py`（SwarmCoordinator + 单例工厂）。
 * I1 单一调度器：插件实例即全局唯一协调器入口。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  ArchiveFn,
  NowFn,
  SleepFn,
  SwarmAgentSummary,
  SwarmCoordinator,
  SwarmCoordinatorConfig,
} from './coordinator.js';
import { SwarmTask, SwarmTaskStatus } from './models.js';

export * from './config.js';
export * from './coordinator.js';
export * from './models.js';

export interface SwarmServiceOptions {
  /** 协调器配置（snake_case 键，可经 toCoordinatorConfig 从 YAML 转换） */
  readonly config?: SwarmCoordinatorConfig | undefined;
  /** trace 归档函数注入（测试用） */
  readonly archiveFn?: ArchiveFn | undefined;
  /** 当前时间注入（测试用） */
  readonly nowFn?: NowFn | undefined;
  /** 睡眠注入（测试用） */
  readonly sleepFn?: SleepFn | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Swarm 域：多 Forgekin 协同调度器 */
    forgeSwarm: SwarmService;
  }
}

export class SwarmService extends Service {
  readonly coordinator: SwarmCoordinator;
  /** 调度循环 Promise（startLoop 后非 null） */
  loopPromise: Promise<void> | null = null;

  constructor(ctx: Context, options: SwarmServiceOptions = {}) {
    super(ctx, 'forgeSwarm');
    this.coordinator = new SwarmCoordinator(options);
  }

  // ── Agent / 任务门面 ────────────────────────────────────────

  /** 注册 agent（对齐 coordinator.registerAgent） */
  registerAgent(agentId: string, capabilities: string[], vendor = 'unknown'): void {
    this.coordinator.registerAgent(agentId, capabilities, vendor);
  }

  /** 提交任务（I2 提交必有 trace） */
  submitTask(task: SwarmTask): string {
    return this.coordinator.submitTask(task);
  }

  /** 分发待处理任务（I3 capability-based routing） */
  dispatch(): Promise<string[]> {
    return this.coordinator.dispatch();
  }

  /** agent 心跳上报（I4） */
  heartbeat(
    agentId: string,
    taskId: string | null = null,
    progress = 0.0,
    status = 'busy',
  ): Promise<void> {
    return this.coordinator.heartbeat(agentId, taskId, progress, status);
  }

  /** 超时检测与 reassign（I4 心跳超时回收） */
  checkTimeouts(): Promise<string[]> {
    return this.coordinator.checkTimeouts();
  }

  /** 取消任务 */
  cancelTask(taskId: string, reason = ''): boolean {
    return this.coordinator.cancelTask(taskId, reason);
  }

  /** 主动标记任务失败 */
  failTask(taskId: string, reason = ''): boolean {
    return this.coordinator.failTask(taskId, reason);
  }

  // ── 查询门面 ────────────────────────────────────────────────

  getTask(taskId: string): SwarmTask | null {
    return this.coordinator.getTask(taskId);
  }

  getTaskStatus(taskId: string): SwarmTaskStatus | null {
    return this.coordinator.getTaskStatus(taskId);
  }

  listTasks(status?: SwarmTaskStatus): SwarmTask[] {
    return this.coordinator.listTasks(status);
  }

  listAgents(): SwarmAgentSummary[] {
    return this.coordinator.listAgents();
  }

  getAgentWorkload(): Record<string, number> {
    return this.coordinator.getAgentWorkload();
  }

  // ── 调度循环 ────────────────────────────────────────────────

  /** 启动持续调度循环（重复调用幂等；interval 默认取 config dispatch_interval） */
  startLoop(interval?: number): Promise<void> {
    if (this.loopPromise === null) {
      this.loopPromise =
        interval === undefined
          ? this.coordinator.runContinuously()
          : this.coordinator.runContinuously(interval);
      void this.loopPromise.finally(() => {
        this.loopPromise = null;
      });
    }
    return this.loopPromise;
  }

  /** 软停止调度循环（等待当前 sleep 完成后退出） */
  async stopLoop(): Promise<void> {
    this.coordinator.stop();
    if (this.loopPromise !== null) {
      await this.loopPromise;
    }
  }

  /** 快照（trace 日志）：agents / tasks 状态分布 */
  snapshot(): {
    agents: number;
    tasks: number;
    byStatus: Record<string, number>;
    running: boolean;
  } {
    const byStatus: Record<string, number> = {};
    for (const task of this.coordinator.tasks.values()) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    }
    return {
      agents: this.coordinator.agents.size,
      tasks: this.coordinator.tasks.size,
      byStatus,
      running: this.coordinator.running,
    };
  }
}

export default function Plugin(ctx: Context, options?: SwarmServiceOptions) {
  return ctx.plugin(SwarmService, options);
}
