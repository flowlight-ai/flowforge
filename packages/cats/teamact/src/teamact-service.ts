/**
 * @flowforge/cats-teamact — T7.17 TeamActService（Cordis 插件服务）。
 *
 * 组装 TeamAct 协作协议全栈：
 *   - SteerQueue（F048 operator 实时干预，I1-I5 不变量）
 *   - PingPongCircuitBreaker（乒乓球熔断，roleagent.md §2.4）
 *   - TeamActState 工厂（六步循环状态机，F002 §2）
 *
 * 与 `packages/chat/approval` 打通（T7.17）：submitCommand 接受可选
 * `approvalHub` 注入点——当 ctx.chatApproval 已装载时，紧急指令（EMERGENCY）
 * 可同步记入提案面；缺省不强制，保持 steer 协议独立性。
 *
 * @module @flowforge/cats-teamact
 */

import { Context, Service } from '@flowforge/cordis';
import { PingPongCircuitBreaker, type PingPongCircuitBreakerOptions } from './circuit-breaker.js';
import { TeamActState, type TeamActStateOptions } from './state-machine.js';
import { SteerQueue, SteerCommand, type SteerQueueConfig } from './steer.js';

/** TeamActService 构造选项（对齐 teamact_steer.yaml 各段，铁律 5 参数外置）。 */
export interface TeamActServiceOptions {
  /** SteerQueue 配置（对齐 teamact_steer.yaml teamact_steer 段）。 */
  readonly steer?: SteerQueueConfig | undefined;
  /** 乒乓球熔断器选项（阈值/冷却/上限）。 */
  readonly circuitBreaker?: PingPongCircuitBreakerOptions | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** TeamAct 协作域：六步循环状态机 + Steer 队列 + 乒乓球熔断器 */
    catsTeamAct: TeamActService;
  }
}

/**
 * TeamAct 协作域服务 — 组装状态机/熔断器/Steer 队列。
 *
 * 挂载 `ctx.catsTeamAct`，提供：
 *   - queue：F048 SteerQueue（operator 干预队列）
 *   - breaker：PingPongCircuitBreaker（无进展检测）
 *   - createState()：六步循环状态机工厂
 */
export class TeamActService extends Service {
  /** F048 Steer 指令队列（operator 实时干预入口）。 */
  readonly queue: SteerQueue;
  /** 乒乓球熔断器（给数据不给结论）。 */
  readonly breaker: PingPongCircuitBreaker;

  constructor(ctx: Context, options: TeamActServiceOptions = {}) {
    super(ctx, 'catsTeamAct');
    this.queue = new SteerQueue(options.steer);
    this.breaker = new PingPongCircuitBreaker(options.circuitBreaker);
  }

  /** 创建 TeamAct 六步循环状态机实例。 */
  createState(options: TeamActStateOptions): TeamActState {
    return new TeamActState(options);
  }

  /** 提交 operator steer 指令（I2 校验委托给 SteerQueue.submit）。 */
  submitCommand(command: SteerCommand): string {
    return this.queue.submit(command);
  }

  /** 应用下一个 steer 指令到任务队列（I4/I5 不变量由 SteerQueue 保证）。 */
  applyNext(taskQueue: Parameters<SteerQueue['applyToQueue']>[0]): ReturnType<SteerQueue['applyToQueue']> {
    return this.queue.applyToQueue(taskQueue);
  }
}

export default TeamActService;
