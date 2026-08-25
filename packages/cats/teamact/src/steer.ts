/**
 * @flowforge/cats-teamact — T7.17 SteerQueue 队列干预（F048 TeamAct Queue Steer）。
 *
 * TS 重写自 `core/teamact/steer.py`：
 * operator 可以在不破坏 TeamAct 状态机（F002）的前提下，对正在执行的
 * TeamAct 队列进行细粒度实时干预。
 *
 * 7 个 SteerAction（F048 §2.3 处理矩阵）：
 *   PRIORITY_BOOST / INTERRUPT / REQUEUE / REDIRECT / PAUSE / RESUME / CANCEL
 *
 * 5 个关键不变量（F048 §2.5）：
 *   I1 SteerCommand 不可篡改（frozen 语义）
 *   I2 operator 独占 steer 权限（operator_id 校验）
 *   I3 Steer 影响 trace 记录（落盘 JSONL）
 *   I4 Steer 不破坏状态机（非 EMERGENCY 跳过队首）
 *   I5 紧急 steer 可中断任意阶段（EMERGENCY 可作用于队首）
 *
 * @module @flowforge/cats-teamact
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamActStep } from './types.js';
import { HistoryEntry } from './state-machine.js';
import { HandoffCapsule } from './handoff.js';

/** Steer 动作类型（F048 §2.3 处理矩阵 7 种动作）。 */
export enum SteerAction {
  /** 提升任务优先级（前移队列位置）。 */
  PRIORITY_BOOST = 'priority_boost',
  /** 中断当前任务（标记 + EMERGENCY 时推进到 VERDICT）。 */
  INTERRUPT = 'interrupt',
  /** 重新入队（移到队尾 + 重置 iteration）。 */
  REQUEUE = 'requeue',
  /** 重定向到其他 agent（修改 ball_holder）。 */
  REDIRECT = 'redirect',
  /** 暂停整个队列（停止 dispatch 新任务）。 */
  PAUSE = 'pause',
  /** 恢复队列（清除暂停标志）。 */
  RESUME = 'resume',
  /** 取消任务（标记 cancelled + 从队列移除）。 */
  CANCEL = 'cancel',
}

/** Steer 优先级（F048 §2.3 优先级矩阵 5 级）。 */
export enum SteerPriority {
  /** 1 — 非紧急调度。 */
  LOW = 'low',
  /** 2 — 默认调度。 */
  NORMAL = 'normal',
  /** 3 — 重要调度。 */
  HIGH = 'high',
  /** 4 — 关键调度。 */
  CRITICAL = 'critical',
  /** 5 — 紧急干预（I5 可中断原子操作）。 */
  EMERGENCY = 'emergency',
}

export namespace SteerPriority {
  /** 返回优先级数值（用于排序比较）。 */
  export function numeric(priority: SteerPriority): number {
    switch (priority) {
      case SteerPriority.LOW:
        return 1;
      case SteerPriority.NORMAL:
        return 2;
      case SteerPriority.HIGH:
        return 3;
      case SteerPriority.CRITICAL:
        return 4;
      case SteerPriority.EMERGENCY:
        return 5;
    }
  }
}

/** SteerCommand 构造选项（I1 不可篡改：全部字段只读）。 */
export interface SteerCommandOptions {
  /** Steer 动作类型（7 种枚举之一）。 */
  action: SteerAction;
  /** 目标任务 ID（必须存在于队列中）。 */
  targetTaskId: string;
  /** operator 必填理由（审计追溯依据，禁止空字符串）。 */
  reason: string;
  /** 发起 operator 标识（必须以 "operator" 开头，I2 校验）。 */
  operatorId: string;
  /** Steer 优先级（缺省 NORMAL）。 */
  priority?: SteerPriority | undefined;
  /** REDIRECT 时的目标 Forgekin ID（仅 REDIRECT 必填）。 */
  targetAgentId?: string | null | undefined;
  /** 附加数据（如 priority_boost 的 boost_level / redirect 的 capsule）。 */
  payload?: Readonly<Record<string, unknown>> | undefined;
  /** 超时自动失效时间（缺省 null 表示永不过期）。 */
  expiresAt?: Date | null | undefined;
  /** 指令唯一标识（缺省自动生成 steer-{uuid12}）。 */
  commandId?: string | undefined;
  /** 创建时间（缺省当前 UTC 时间）。 */
  createdAt?: Date | undefined;
}

/** SteerCommand — operator 实时干预指令（I1 不可篡改，frozen 语义）。 */
export class SteerCommand {
  readonly commandId: string;
  readonly action: SteerAction;
  readonly priority: SteerPriority;
  readonly targetTaskId: string;
  readonly targetAgentId: string | null;
  readonly reason: string;
  readonly operatorId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;

  constructor(options: SteerCommandOptions) {
    this.commandId = options.commandId ?? `steer-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    this.action = options.action;
    this.priority = options.priority ?? SteerPriority.NORMAL;
    this.targetTaskId = options.targetTaskId;
    this.targetAgentId = options.targetAgentId ?? null;
    this.reason = options.reason;
    this.operatorId = options.operatorId;
    this.payload = Object.freeze({ ...options.payload }) as Readonly<Record<string, unknown>>;
    this.createdAt = options.createdAt ?? new Date();
    this.expiresAt = options.expiresAt ?? null;

    // I1 不可篡改：冻结实例，运行时赋值抛 TypeError（对齐 Python frozen dataclass）
    Object.freeze(this);
  }

  /** 检查指令是否已过期（True 表示应被静默丢弃）。 */
  isExpired(now?: Date): boolean {
    if (this.expiresAt === null) return false;
    const current = now ?? new Date();
    return current >= this.expiresAt;
  }

  /** 是否为 EMERGENCY 优先级（I5 紧急中断语义）。 */
  isEmergency(): boolean {
    return this.priority === SteerPriority.EMERGENCY;
  }
}

/** Steer 执行效果记录（I3 trace 记录）。 */
export interface SteerEffectOptions {
  /** 对应的 SteerCommand ID。 */
  commandId: string;
  /** 是否成功应用。 */
  applied: boolean;
  /** 受影响的任务 ID 列表（缺省空）。 */
  affectedTasks?: string[] | undefined;
  /** 受影响的 Forgekin ID 列表（缺省空）。 */
  affectedAgents?: string[] | undefined;
  /** 副作用记录（如 emergency_interruption / queue_paused）。 */
  sideEffects?: Readonly<Record<string, unknown>> | undefined;
  /** 应用时间（缺省当前 UTC 时间）。 */
  appliedAt?: Date | undefined;
  /** 附加消息（失败原因/成功摘要）。 */
  message?: string | undefined;
}

/** Steer 执行效果记录（I3 trace 记录）。 */
export class SteerEffect {
  readonly commandId: string;
  readonly applied: boolean;
  readonly affectedTasks: readonly string[];
  readonly affectedAgents: readonly string[];
  readonly sideEffects: Readonly<Record<string, unknown>>;
  readonly appliedAt: Date;
  readonly message: string;

  constructor(options: SteerEffectOptions) {
    this.commandId = options.commandId;
    this.applied = options.applied;
    this.affectedTasks = options.affectedTasks ?? [];
    this.affectedAgents = options.affectedAgents ?? [];
    this.sideEffects = Object.freeze({ ...options.sideEffects }) as Readonly<Record<string, unknown>>;
    this.appliedAt = options.appliedAt ?? new Date();
    this.message = options.message ?? '';
  }
}

/** 队列中任务的 TS 视角最小接口（TeamActState 满足该接口）。 */
export interface SteerTaskLike {
  readonly taskId: string;
  ballHolder: string | null;
  iteration: number;
  currentStep: TeamActStep;
  history: HistoryEntry[];
  advance(action?: string, evidence?: string): TeamActStep;
  passBall?(toAgent: string, capsule: HandoffCapsule): boolean;
}

/** SteerQueue 配置（对齐 teamact_steer.yaml，铁律 5 参数外置）。 */
export interface SteerQueueConfig {
  /** 最大待应用指令数（缺省 100）。 */
  readonly maxPending?: number | undefined;
  /** I2 开关：只有 operator 能提交（缺省 true）。 */
  readonly operatorOnly?: boolean | undefined;
  /** I5 开关：EMERGENCY 可中断原子操作（缺省 true）。 */
  readonly emergencyCanInterruptAtomic?: boolean | undefined;
  readonly traceArchive?: {
    /** I3 开关（缺省 true）。 */
    readonly enabled?: boolean | undefined;
    /** 归档文件路径（相对路径，运行时拼 data_dir）。 */
    readonly path?: string | undefined;
  } | undefined;
}

/** 已应用记录（审计追溯用）。 */
export interface AppliedSteerRecord {
  readonly command: SteerCommand;
  readonly effect: SteerEffect;
}

/** Steer 指令队列 — 接收/校验/应用 operator steer 指令（F048 核心调度器）。 */
export class SteerQueue {
  private readonly pending: SteerCommand[] = [];
  private readonly applied: AppliedSteerRecord[] = [];
  private pausedFlag = false;
  private readonly maxPending: number;
  private readonly operatorOnly: boolean;
  private readonly emergencyCanInterrupt: boolean;
  private readonly archiveEnabled: boolean;
  private readonly archivePath: string | null;

  constructor(config: SteerQueueConfig = {}) {
    this.maxPending = config.maxPending ?? 100;
    this.operatorOnly = config.operatorOnly ?? true;
    this.emergencyCanInterrupt = config.emergencyCanInterruptAtomic ?? true;
    this.archiveEnabled = config.traceArchive?.enabled ?? true;
    this.archivePath = config.traceArchive?.path ?? null;
  }

  // ── 公开属性 ──────────────────────────────────────────────────

  /** 队列是否处于暂停状态（PAUSE 指令的效果）。 */
  get isPaused(): boolean {
    return this.pausedFlag;
  }

  /** 待应用指令数。 */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** 已应用指令数。 */
  get appliedCount(): number {
    return this.applied.length;
  }

  // ── 提交指令（I2 校验）──────────────────────────────────────

  /**
   * 提交 steer 指令（I2 校验 operator 权限）。
   *
   * @throws PermissionError 语义：operatorId 不以 "operator" 开头。
   * @throws RangeError 语义：maxPending 超限 / reason 为空 / 指令已过期。
   */
  submit(command: SteerCommand): string {
    // I2 校验：operator 独占 steer 权限
    if (this.operatorOnly && !command.operatorId.startsWith('operator')) {
      throw new PermissionError(
        `I2 只有 operator 能提交 SteerCommand，收到 operator_id=${command.operatorId}`,
      );
    }

    // reason 必填（审计追溯依据）
    if (!command.reason || command.reason.trim() === '') {
      throw new RangeError('SteerCommand.reason 不能为空（审计追溯依据）');
    }

    // 容量校验
    if (this.pending.length >= this.maxPending) {
      throw new RangeError(
        `SteerQueue 容量超限：pending=${this.pending.length} >= maxPending=${this.maxPending}`,
      );
    }

    // 过期校验（submit 阶段直接拒绝更安全）
    if (command.isExpired()) {
      throw new RangeError(
        `SteerCommand 已过期，拒绝提交：id=${command.commandId} expiresAt=${command.expiresAt?.toISOString()}`,
      );
    }

    this.pending.push(command);
    return command.commandId;
  }

  /** 列出待应用的 steer 指令（按 FIFO 顺序）。 */
  listPending(): SteerCommand[] {
    return [...this.pending];
  }

  /** 列出已应用的 steer 指令（按应用时间倒序，最近 limit 条）。 */
  listApplied(limit = 100): AppliedSteerRecord[] {
    if (limit <= 0) return [];
    return this.applied.slice(-limit).map((r) => ({ command: r.command, effect: r.effect }));
  }

  // ── 应用指令（I4 不破坏状态机）──────────────────────────────

  /**
   * 应用下一个 steer 指令到任务队列（I4 不破坏状态机）。
   *
   * 队列语义：queue[0] 为当前执行中任务（持球者），queue[1:] 为等待中任务。
   * I4：非 EMERGENCY 指令不修改 queue[0]。
   */
  async applyToQueue(taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    if (this.pending.length === 0) {
      return new SteerEffect({ commandId: '', applied: false, message: '无待应用指令' });
    }

    const command = this.pending.shift()!;

    // 二次过期校验（submit 到 apply 之间可能已过期）
    if (command.isExpired()) {
      const effect = new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `指令已过期，丢弃（expiresAt=${command.expiresAt?.toISOString()}）`,
      });
      this.applied.push({ command, effect });
      await this.archiveRecord(command, effect);
      return effect;
    }

    // 分发到对应处理器
    const effect = await this.dispatch(command, taskQueue);

    // 记录到已应用列表
    this.applied.push({ command, effect });

    // I3 归档
    await this.archiveRecord(command, effect);

    return effect;
  }

  // ── 分发器（7 个分支）──────────────────────────────────────

  /** 分发 steer 指令到对应处理器（处理器内实现 I4/I5）。 */
  async dispatch(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    switch (command.action) {
      case SteerAction.PRIORITY_BOOST:
        return this.applyPriorityBoost(command, taskQueue);
      case SteerAction.INTERRUPT:
        return this.applyInterrupt(command, taskQueue);
      case SteerAction.REQUEUE:
        return this.applyRequeue(command, taskQueue);
      case SteerAction.REDIRECT:
        return this.applyRedirect(command, taskQueue);
      case SteerAction.PAUSE:
        return this.applyPause(command);
      case SteerAction.RESUME:
        return this.applyResume(command);
      case SteerAction.CANCEL:
        return this.applyCancel(command, taskQueue);
      default:
        return new SteerEffect({
          commandId: command.commandId,
          applied: false,
          message: `未知 SteerAction: ${command.action}`,
        });
    }
  }

  // ── 1. PRIORITY_BOOST ───────────────────────────────────────

  /** PRIORITY_BOOST — 调整任务在队列中的位置（往前移）。I4 非 EMERGENCY 不能修改队首。 */
  async applyPriorityBoost(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    const targetId = command.targetTaskId;
    const boostLevel = Number(command.payload['boost_level'] ?? 1);
    const targetPosition = command.payload['target_position'];

    const idx = findTaskIndex(taskQueue, targetId);
    if (idx === null) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: `目标任务不存在: ${targetId}` });
    }

    // I4：非 EMERGENCY 不能修改队首
    if (idx === 0 && !command.isEmergency()) {
      return new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `I4 非 EMERGENCY 不能 boost 队首任务（队首为执行中任务，target=${targetId}）`,
        affectedTasks: [targetId],
        sideEffects: { i4_blocked: true },
      });
    }

    // 计算新位置
    const newIdx =
      targetPosition !== undefined
        ? Math.max(0, Number(targetPosition))
        : Math.max(0, idx - boostLevel);

    // 新位置不能等于原位置或越界
    if (newIdx >= taskQueue.length || newIdx === idx) {
      return new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `boost 无需调整：idx=${idx} new_idx=${newIdx}`,
        affectedTasks: [targetId],
      });
    }

    // 执行前移（in-place 交换）
    const task = taskQueue.splice(idx, 1)[0]!;
    taskQueue.splice(newIdx, 0, task);

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      affectedTasks: [targetId],
      affectedAgents: collectAgents([task]),
      sideEffects: { old_position: idx, new_position: newIdx, boost_level: boostLevel },
      message: `任务 ${targetId} 前移：${idx} → ${newIdx}`,
    });
  }

  // ── 2. INTERRUPT ────────────────────────────────────────────

  /**
   * INTERRUPT — 中断当前任务，触发 TeamAct Verdict 阶段。
   * I4 非 EMERGENCY 不能中断队首；I5 EMERGENCY 可中断队首推进到 VERDICT。
   */
  async applyInterrupt(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    const targetId = command.targetTaskId;
    const idx = findTaskIndex(taskQueue, targetId);
    if (idx === null) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: `目标任务不存在: ${targetId}` });
    }

    const task = taskQueue[idx]!;
    const sideEffects: Record<string, unknown> = { interrupted: true };

    // 队首任务中断需要 EMERGENCY（I4/I5）
    if (idx === 0) {
      if (!command.isEmergency()) {
        return new SteerEffect({
          commandId: command.commandId,
          applied: false,
          message: `I4 非 EMERGENCY 不能中断队首执行中任务（target=${targetId}）`,
          affectedTasks: [targetId],
          sideEffects: { i4_blocked: true },
        });
      }
      if (!this.emergencyCanInterrupt) {
        return new SteerEffect({
          commandId: command.commandId,
          applied: false,
          message: 'I5 紧急中断已被配置禁用',
          affectedTasks: [targetId],
          sideEffects: { i5_disabled: true },
        });
      }
      // I5：EMERGENCY 推进到 VERDICT 阶段
      const advancedTo = advanceToVerdict(task);
      sideEffects['emergency_interruption'] = true;
      sideEffects['advanced_to'] = advancedTo;
      sideEffects['i5_triggered'] = true;
    }

    // 在 history 中记录 interrupt 标记
    markHistory(task, `steer_interrupt:${command.commandId}`);

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      affectedTasks: [targetId],
      affectedAgents: collectAgents([task]),
      sideEffects,
      message: `任务 ${targetId} 已中断${idx === 0 ? '（EMERGENCY 推进到 VERDICT）' : ''}`,
    });
  }

  // ── 3. REQUEUE ──────────────────────────────────────────────

  /** REQUEUE — 重新入队（移到队尾 + 重置 iteration）。I4 非 EMERGENCY 不能 requeue 队首。 */
  async applyRequeue(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    const targetId = command.targetTaskId;
    const idx = findTaskIndex(taskQueue, targetId);
    if (idx === null) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: `目标任务不存在: ${targetId}` });
    }

    // I4：非 EMERGENCY 不能 requeue 队首
    if (idx === 0 && !command.isEmergency()) {
      return new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `I4 非 EMERGENCY 不能 requeue 队首执行中任务（target=${targetId}）`,
        affectedTasks: [targetId],
        sideEffects: { i4_blocked: true },
      });
    }

    const task = taskQueue.splice(idx, 1)[0]!;
    const oldIteration = task.iteration;

    // 重置 iteration 计数（frozen 模型可能不允许，容错）
    try {
      task.iteration = 0;
    } catch {
      // frozen 模型可能不允许，跳过
    }

    // 移到队尾
    taskQueue.push(task);

    // 记录到 history
    markHistory(task, `steer_requeue:${command.commandId}`);

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      affectedTasks: [targetId],
      affectedAgents: collectAgents([task]),
      sideEffects: {
        old_position: idx,
        new_position: taskQueue.length - 1,
        old_iteration: oldIteration,
        new_iteration: 0,
      },
      message: `任务 ${targetId} 移到队尾，iteration 重置`,
    });
  }

  // ── 4. REDIRECT ─────────────────────────────────────────────

  /**
   * REDIRECT — 重定向到其他 agent（修改 ball_holder）。
   * 必填 targetAgentId；可选 payload.capsule（推荐经 pass_ball 转交）。
   * I4 非 EMERGENCY 不能 redirect 队首；I5 EMERGENCY 可 redirect 队首。
   */
  async applyRedirect(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    const targetId = command.targetTaskId;
    const newAgent = command.targetAgentId;

    if (!newAgent) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: 'REDIRECT 必须提供 targetAgentId' });
    }

    const idx = findTaskIndex(taskQueue, targetId);
    if (idx === null) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: `目标任务不存在: ${targetId}` });
    }

    const task = taskQueue[idx]!;
    const oldAgent = task.ballHolder;

    // I4：非 EMERGENCY 不能 redirect 队首
    if (idx === 0 && !command.isEmergency()) {
      return new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `I4 非 EMERGENCY 不能 redirect 队首执行中任务（target=${targetId}）`,
        affectedTasks: [targetId],
        affectedAgents: oldAgent !== null ? [oldAgent] : [],
        sideEffects: { i4_blocked: true },
      });
    }

    const sideEffects: Record<string, unknown> = { old_agent: oldAgent, new_agent: newAgent };

    // 如果 payload 含 capsule，尝试通过 pass_ball 转交（推荐路径）
    const capsule = command.payload['capsule'];
    if (capsule instanceof HandoffCapsule && typeof task.passBall === 'function') {
      try {
        const success = task.passBall(newAgent, capsule);
        sideEffects['pass_ball_used'] = success;
        if (!success) {
          return new SteerEffect({
            commandId: command.commandId,
            applied: false,
            message: 'pass_ball 校验失败（capsule 无效或不匹配）',
            affectedTasks: [targetId],
            affectedAgents: oldAgent !== null ? [oldAgent] : [],
            sideEffects,
          });
        }
      } catch (exc) {
        sideEffects['pass_ball_error'] = String(exc);
        setBallHolder(task, newAgent);
      }
    } else {
      // 直接设置 ball_holder
      setBallHolder(task, newAgent);
    }

    if (idx === 0 && command.isEmergency()) {
      sideEffects['i5_triggered'] = true;
      sideEffects['emergency_redirect'] = true;
    }

    // 记录到 history
    markHistory(task, `steer_redirect:${command.commandId} ${oldAgent ?? '(none)'}→${newAgent}`);

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      affectedTasks: [targetId],
      affectedAgents: oldAgent !== null ? [oldAgent, newAgent] : [newAgent],
      sideEffects,
      message: `任务 ${targetId} 球权转交：${oldAgent ?? '(none)'} → ${newAgent}`,
    });
  }

  // ── 5. PAUSE ────────────────────────────────────────────────

  /** PAUSE — 暂停整个队列（停止 dispatch 新任务）。不影响当前持球者。 */
  async applyPause(command: SteerCommand): Promise<SteerEffect> {
    const prevState = this.pausedFlag;
    this.pausedFlag = true;

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      sideEffects: { prev_paused: prevState, new_paused: true },
      message: prevState ? '队列已处于暂停状态（幂等）' : '队列已暂停',
    });
  }

  // ── 6. RESUME ───────────────────────────────────────────────

  /** RESUME — 恢复队列（清除暂停标志）。 */
  async applyResume(command: SteerCommand): Promise<SteerEffect> {
    const prevState = this.pausedFlag;
    this.pausedFlag = false;

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      sideEffects: { prev_paused: prevState, new_paused: false },
      message: prevState ? '队列已恢复' : '队列未处于暂停状态（幂等）',
    });
  }

  // ── 7. CANCEL ───────────────────────────────────────────────

  /** CANCEL — 取消任务（标记 cancelled + 从队列移除）。I4/I5 同前。 */
  async applyCancel(command: SteerCommand, taskQueue: SteerTaskLike[]): Promise<SteerEffect> {
    const targetId = command.targetTaskId;
    const idx = findTaskIndex(taskQueue, targetId);
    if (idx === null) {
      return new SteerEffect({ commandId: command.commandId, applied: false, message: `目标任务不存在: ${targetId}` });
    }

    const task = taskQueue[idx]!;

    // I4：非 EMERGENCY 不能 cancel 队首
    if (idx === 0 && !command.isEmergency()) {
      return new SteerEffect({
        commandId: command.commandId,
        applied: false,
        message: `I4 非 EMERGENCY 不能 cancel 队首执行中任务（target=${targetId}）`,
        affectedTasks: [targetId],
        sideEffects: { i4_blocked: true },
      });
    }

    const sideEffects: Record<string, unknown> = { cancelled: true, removed_position: idx };
    if (idx === 0 && command.isEmergency()) {
      sideEffects['i5_triggered'] = true;
      sideEffects['emergency_cancel'] = true;
    }

    // 记录取消标记到 history（在移除前）
    markHistory(task, `steer_cancel:${command.commandId} reason=${command.reason}`);

    // 从队列移除
    taskQueue.splice(idx, 1);

    return new SteerEffect({
      commandId: command.commandId,
      applied: true,
      affectedTasks: [targetId],
      affectedAgents: collectAgents([task]),
      sideEffects,
      message: `任务 ${targetId} 已取消并移出队列`,
    });
  }

  // ── 归档（I3 trace 记录）────────────────────────────────────

  /** 归档 SteerCommand + SteerEffect 到 JSONL（I3 不变量，失败不阻断应用）。 */
  async archiveRecord(command: SteerCommand, effect: SteerEffect): Promise<void> {
    if (!this.archiveEnabled || this.archivePath === null) return;

    const record = {
      command: commandToJSON(command),
      effect: effectToJSON(effect),
    };
    const line = JSON.stringify(record);

    try {
      await appendLine(this.archivePath, line);
    } catch {
      // I3 容错：归档失败不阻断应用
    }
  }
}

/** I2 违反时抛出（对齐 Python PermissionError 语义）。 */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

// ── 辅助函数（对齐 Python 模块级函数）──────────────────────────

/** 在队列中查找目标任务的位置索引（找不到返回 null）。 */
export function findTaskIndex(taskQueue: readonly SteerTaskLike[], targetTaskId: string): number | null {
  const idx = taskQueue.findIndex((task) => task.taskId === targetTaskId);
  return idx >= 0 ? idx : null;
}

/** 从任务列表中收集 ball_holder（去重）。 */
export function collectAgents(tasks: readonly SteerTaskLike[]): string[] {
  const agents: string[] = [];
  for (const task of tasks) {
    const holder = task.ballHolder;
    if (holder !== null && !agents.includes(holder)) {
      agents.push(holder);
    }
  }
  return agents;
}

/** 在任务的 history 中记录 steer 标记（只追加记录，不推进状态机）。 */
export function markHistory(task: SteerTaskLike, action: string): void {
  try {
    task.history.push(
      new HistoryEntry({ step: task.currentStep, action, evidence: 'steer' }),
    );
  } catch {
    // 无法构造 HistoryEntry，跳过（不阻断应用）
  }
}

/**
 * I5 紧急中断 — 推进状态机到 VERDICT 阶段。
 * 调用 task.advance() 多次直到 currentStep == VERDICT 或超过 6 次（防死循环）。
 */
export function advanceToVerdict(task: SteerTaskLike): string {
  const targetStep = TeamActStep.VERDICT;
  const maxAdvances = 6; // 六步循环最多推进 6 次
  for (let i = 0; i < maxAdvances; i += 1) {
    if (task.currentStep === targetStep) break;
    try {
      task.advance('steer_emergency_interrupt', 'i5');
    } catch {
      break;
    }
  }
  return task.currentStep.valueOf();
}

/** 设置 task.ballHolder（兼容 frozen 语义：失败仅记录到调用方）。 */
export function setBallHolder(task: SteerTaskLike, newAgent: string): void {
  try {
    task.ballHolder = newAgent;
  } catch {
    // frozen 模型可能拒绝赋值，由调用方处理
  }
}

/** 追加写入一行 JSONL（append-only，I2 配套：禁止覆盖），自动创建父目录。 */
export async function appendLine(filePath: string, line: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${line}\n`, 'utf-8');
}

/** SteerCommand → 可序列化对象。 */
export function commandToJSON(command: SteerCommand): Record<string, unknown> {
  return {
    commandId: command.commandId,
    action: command.action.valueOf(),
    priority: command.priority.valueOf(),
    targetTaskId: command.targetTaskId,
    targetAgentId: command.targetAgentId,
    reason: command.reason,
    operatorId: command.operatorId,
    payload: command.payload,
    createdAt: command.createdAt.toISOString(),
    expiresAt: command.expiresAt?.toISOString() ?? null,
  };
}

/** SteerEffect → 可序列化对象。 */
export function effectToJSON(effect: SteerEffect): Record<string, unknown> {
  return {
    commandId: effect.commandId,
    applied: effect.applied,
    affectedTasks: [...effect.affectedTasks],
    affectedAgents: [...effect.affectedAgents],
    sideEffects: effect.sideEffects,
    appliedAt: effect.appliedAt.toISOString(),
    message: effect.message,
  };
}
