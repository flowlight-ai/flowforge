/**
 * @flowforge/forgekin-autonomous — 阶段7 T7.19 F052 自主运行域 Cordis 插件
 *
 * 挂载 `ctx.forgeAutonomous`：5 灵智体 24h 自主运行守护进程 —
 * 扫描项目（文档缺失/TODO/测试缺失）→ SwarmTask 提交 →
 * I3 能力匹配分发 → 灵智体 LLM 真实执行 → 心跳上报 → 落盘产出，
 * 对齐 Python `forgemind/autonomous.py`（F20；类 clowder-ai 自主工作模式）。
 *
 * 铁律 2：扫描与落盘均为真实文件系统操作；铁律 3：执行走真实
 * forgekin.chat()；红线 11：路径/清单经配置注入。
 */
import { Context, Service } from '@flowforge/cordis';
import { SwarmCoordinator } from '@flowforge/forgekin-swarm';
import { AutonomousConfig, ScannerConfig } from './config.js';
import {
  AutonomousDaemon,
  AutonomousForgekin,
  SleepFn,
} from './daemon.js';

export * from './config.js';
export * from './daemon.js';
export * from './scanner.js';

export interface AutonomousServiceOptions {
  /** 项目根目录（默认 process.cwd()，红线 11） */
  readonly projectRoot?: string | undefined;
  /** SwarmCoordinator 实例（默认新建） */
  readonly coordinator?: SwarmCoordinator | undefined;
  /** 灵智体实例字典 {forgekin_id: AutonomousForgekin} */
  readonly forgekins?: Record<string, AutonomousForgekin> | undefined;
  /** 运行配置 */
  readonly config?: Partial<AutonomousConfig> | undefined;
  /** 扫描配置 */
  readonly scannerConfig?: Partial<ScannerConfig> | undefined;
  /** 睡眠函数注入（测试用） */
  readonly sleepFn?: SleepFn | undefined;
  /** 代码/测试产出审阅目录（相对项目根） */
  readonly patchesDirName?: string | undefined;
  /** 未知类型产出目录（相对项目根） */
  readonly outputsDirName?: string | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 自主运行域：F052 24h 自主守护进程 */
    forgeAutonomous: AutonomousService;
  }
}

export class AutonomousService extends Service {
  /** 调度器（与 daemon 共享） */
  readonly coordinator: SwarmCoordinator;
  /** 自主运行守护进程 */
  readonly daemon: AutonomousDaemon;
  /** runForever Promise（start 后非 null） */
  runPromise: Promise<void> | null = null;

  constructor(ctx: Context, options: AutonomousServiceOptions = {}) {
    super(ctx, 'forgeAutonomous');
    this.coordinator = options.coordinator ?? new SwarmCoordinator();
    this.daemon = new AutonomousDaemon({
      coordinator: this.coordinator,
      projectRoot: options.projectRoot ?? process.cwd(),
      forgekins: options.forgekins,
      config: options.config,
      scannerConfig: options.scannerConfig,
      sleepFn: options.sleepFn,
      patchesDirName: options.patchesDirName,
      outputsDirName: options.outputsDirName,
    });
  }

  // ── 门面 ────────────────────────────────────────────────────

  /** 注册灵智体实例（执行任务时调用其 chat） */
  registerForgekin(forgekinId: string, forgekin: AutonomousForgekin): void {
    this.daemon.registerForgekin(forgekinId, forgekin);
  }

  /** 启动 24h 自主运行主循环（异步后台） */
  start(): void {
    if (this.runPromise !== null) {
      return;
    }
    this.runPromise = this.daemon.runForever();
  }

  /** 停止自主运行（软停止：当前轮结束后退出） */
  stop(): void {
    this.daemon.stop();
  }

  /** 等待主循环退出（配合 stop 使用） */
  async waitStopped(): Promise<void> {
    if (this.runPromise !== null) {
      await this.runPromise;
      this.runPromise = null;
    }
  }

  /** 手动触发一轮扫描（供测试/调试） */
  scanOnce() {
    return this.daemon.scanProjectOnce();
  }

  /** 运行状态快照（供 /api/v1/forgemind/autonomous/status） */
  getStatus(): Record<string, unknown> {
    return this.daemon.getStatus();
  }

  /** 自进化活动历史（倒序） */
  getActivityLog(limit = 100) {
    return this.daemon.getActivityLog(limit);
  }

  /** 已完成任务产出（倒序） */
  getCompletedOutputs(limit = 20) {
    return this.daemon.getCompletedOutputs(limit);
  }
}

export default function Plugin(ctx: Context, options?: AutonomousServiceOptions) {
  return ctx.plugin(AutonomousService, options);
}
