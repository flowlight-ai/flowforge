/**
 * @flowforge/cats-teamact — T7.17 SteerQueue 队列干预契约验证。
 *
 * 对齐 `core/teamact/steer.py`（F048 §2.3/§2.5）：
 *   - I1 SteerCommand 不可篡改（readonly + payload frozen）
 *   - I2 operator 独占（operator_id 前缀校验）
 *   - I3 trace 归档 JSONL（enabled/path 配置，失败不阻断）
 *   - I4 非 EMERGENCY 不修改队首（7 个处理器）
 *   - I5 EMERGENCY 可中断/取消/重定向队首
 *   - 容量上限 / 过期拒绝 / 7 种动作分发
 *
 * @module @flowforge/cats-teamact/tests
 */

import { describe, expect, it } from 'vitest';
import { TeamActStep } from '../src/types.js';
import { TeamActState } from '../src/state-machine.js';
import { newHandoffCapsule } from '../src/handoff.js';
import {
  advanceToVerdict,
  PermissionError,
  SteerAction,
  SteerCommand,
  SteerPriority,
  SteerQueue,
} from '../src/steer.js';

/** 构造一条 operator 指令（I2 合规）。 */
function makeCommand(overrides: Partial<ConstructorParameters<typeof SteerCommand>[0]> = {}) {
  return new SteerCommand({
    action: SteerAction.PAUSE,
    targetTaskId: 'task_1',
    reason: '需要人工介入',
    operatorId: 'operator-sherlock',
    ...overrides,
  });
}

/** 构造一个任务队列（3 个任务，队首持球中）。 */
function makeQueue() {
  return [
    new TeamActState({ taskId: 'task_1', ballHolder: 'dev-a' }),
    new TeamActState({ taskId: 'task_2', ballHolder: 'dev-b' }),
    new TeamActState({ taskId: 'task_3', ballHolder: 'dev-c' }),
  ];
}

describe('I1 SteerCommand 不可篡改', () => {
  it('字段只读：修改抛 TypeError（frozen 语义）', () => {
    const cmd = makeCommand();
    expect(() => {
      // @ts-expect-error 只读字段不可赋值（I1）
      cmd.reason = 'hacked';
    }).toThrow();
  });

  it('payload 冻结：修改抛 TypeError', () => {
    const cmd = makeCommand({ payload: { boost_level: 1 } });
    expect(() => {
      // @ts-expect-error frozen payload 不可赋值（I1）
      cmd.payload['boost_level'] = 99;
    }).toThrow();
  });

  it('自动生成 command_id（steer-{uuid12}）', () => {
    expect(makeCommand().commandId).toMatch(/^steer-[0-9a-f]{12}$/);
  });
});

describe('I2 operator 独占 steer 权限', () => {
  it('operator_id 不以 "operator" 开头 → PermissionError', () => {
    const queue = new SteerQueue();
    const cmd = makeCommand({ operatorId: 'dev-agent' });
    expect(() => queue.submit(cmd)).toThrow(PermissionError);
    expect(queue.pendingCount).toBe(0);
  });

  it('operatorOnly=false 时放行非 operator 指令', () => {
    const queue = new SteerQueue({ operatorOnly: false });
    const cmd = makeCommand({ operatorId: 'dev-agent' });
    expect(queue.submit(cmd)).toBe(cmd.commandId);
    expect(queue.pendingCount).toBe(1);
  });
});

describe('SteerQueue 提交校验', () => {
  it('reason 为空 → 拒绝', () => {
    const queue = new SteerQueue();
    expect(() => queue.submit(makeCommand({ reason: '  ' }))).toThrow(RangeError);
  });

  it('maxPending 超限 → 拒绝', () => {
    const queue = new SteerQueue({ maxPending: 2 });
    queue.submit(makeCommand());
    queue.submit(makeCommand({ action: SteerAction.RESUME }));
    expect(() => queue.submit(makeCommand({ action: SteerAction.PAUSE }))).toThrow(RangeError);
  });

  it('已过期指令 → 拒绝提交', () => {
    const queue = new SteerQueue();
    const cmd = makeCommand({ expiresAt: new Date(Date.now() - 1000) });
    expect(() => queue.submit(cmd)).toThrow(RangeError);
  });

  it('apply 时二次过期校验：过期指令静默丢弃并归档', async () => {
    const queue = new SteerQueue({ traceArchive: { enabled: false } });
    // 提交时未过期（120ms 后到期），apply 时已过期 → 静默丢弃并归档
    queue.submit(makeCommand({ expiresAt: new Date(Date.now() + 120) }));
    await new Promise((resolve) => setTimeout(resolve, 160));
    const effect = await queue.applyToQueue(makeQueue());
    expect(effect.applied).toBe(false);
    expect(effect.message).toContain('过期');
    expect(queue.appliedCount).toBe(1);
  });

  it('无待应用指令 → applied=false 空效果', async () => {
    const queue = new SteerQueue();
    const effect = await queue.applyToQueue(makeQueue());
    expect(effect.applied).toBe(false);
    expect(effect.message).toBe('无待应用指令');
  });
});

describe('PAUSE / RESUME 队列级标志', () => {
  it('PAUSE 设置暂停，RESUME 清除（幂等）', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(makeCommand());
    const pause = await queue.applyToQueue(tasks);
    expect(pause.applied).toBe(true);
    expect(queue.isPaused).toBe(true);
    queue.submit(makeCommand({ action: SteerAction.PAUSE }));
    const pauseAgain = await queue.applyToQueue(tasks);
    expect(pauseAgain.message).toContain('幂等');
    queue.submit(makeCommand({ action: SteerAction.RESUME }));
    const resume = await queue.applyToQueue(tasks);
    expect(resume.applied).toBe(true);
    expect(queue.isPaused).toBe(false);
  });
});

describe('I4 非 EMERGENCY 不修改队首', () => {
  it.each([
    SteerAction.PRIORITY_BOOST,
    SteerAction.INTERRUPT,
    SteerAction.REQUEUE,
    SteerAction.REDIRECT,
    SteerAction.CANCEL,
  ])('%s 作用于队首 → 被拒（i4_blocked）', async (action) => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(
      makeCommand({
        action,
        targetTaskId: 'task_1',
        targetAgentId: action === SteerAction.REDIRECT ? 'dev-b' : undefined,
      }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(false);
    expect(effect.sideEffects['i4_blocked']).toBe(true);
    // 队首未被修改
    expect(tasks[0]!.taskId).toBe('task_1');
  });

  it('PRIORITY_BOOST 非队首任务正常前移', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(makeCommand({ action: SteerAction.PRIORITY_BOOST, targetTaskId: 'task_3', payload: { boost_level: 1 } }));
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(tasks[1]!.taskId).toBe('task_3');
    expect(effect.sideEffects['new_position']).toBe(1);
  });
});

describe('I5 EMERGENCY 可作用于队首', () => {
  it('EMERGENCY INTERRUPT 队首 → 推进到 VERDICT（advance_to_verdict）', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(
      makeCommand({ action: SteerAction.INTERRUPT, targetTaskId: 'task_1', priority: SteerPriority.EMERGENCY }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(effect.sideEffects['i5_triggered']).toBe(true);
    expect(effect.sideEffects['emergency_interruption']).toBe(true);
    expect(tasks[0]!.currentStep).toBe(TeamActStep.VERDICT);
  });

  it('emergencyCanInterruptAtomic=false 时 EMERGENCY 中断被禁用', async () => {
    const queue = new SteerQueue({ emergencyCanInterruptAtomic: false });
    const tasks = makeQueue();
    queue.submit(
      makeCommand({ action: SteerAction.INTERRUPT, targetTaskId: 'task_1', priority: SteerPriority.EMERGENCY }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(false);
    expect(effect.sideEffects['i5_disabled']).toBe(true);
  });

  it('EMERGENCY CANCEL 队首 → 移除队列', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(
      makeCommand({ action: SteerAction.CANCEL, targetTaskId: 'task_1', priority: SteerPriority.EMERGENCY }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(effect.sideEffects['emergency_cancel']).toBe(true);
    expect(tasks.map((t) => t.taskId)).toEqual(['task_2', 'task_3']);
  });
});

describe('REQUEUE / REDIRECT', () => {
  it('REQUEUE 非队首 → 移到队尾并重置 iteration', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    tasks[1]!.iteration = 5;
    queue.submit(makeCommand({ action: SteerAction.REQUEUE, targetTaskId: 'task_2' }));
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(tasks[2]!.taskId).toBe('task_2');
    expect(tasks[2]!.iteration).toBe(0);
    expect(effect.sideEffects['old_iteration']).toBe(5);
  });

  it('REDIRECT 非队首 → 修改 ball_holder', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    queue.submit(
      makeCommand({ action: SteerAction.REDIRECT, targetTaskId: 'task_2', targetAgentId: 'dev-x' }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(tasks[1]!.ballHolder).toBe('dev-x');
    expect(effect.affectedAgents).toContain('dev-x');
  });

  it('REDIRECT 缺 targetAgentId → 拒绝', async () => {
    const queue = new SteerQueue();
    queue.submit(makeCommand({ action: SteerAction.REDIRECT, targetTaskId: 'task_2' }));
    const effect = await queue.applyToQueue(makeQueue());
    expect(effect.applied).toBe(false);
    expect(effect.message).toContain('targetAgentId');
  });

  it('REDIRECT 带 capsule 走 pass_ball 路径', async () => {
    const queue = new SteerQueue();
    const tasks = makeQueue();
    const capsule = newHandoffCapsule({
      fromAgent: 'dev-b',
      toAgent: 'dev-x',
      taskSummary: '交接',
      nextStep: '继续',
    });
    queue.submit(
      makeCommand({
        action: SteerAction.REDIRECT,
        targetTaskId: 'task_2',
        targetAgentId: 'dev-x',
        payload: { capsule },
      }),
    );
    const effect = await queue.applyToQueue(tasks);
    expect(effect.applied).toBe(true);
    expect(effect.sideEffects['pass_ball_used']).toBe(true);
    expect(tasks[1]!.ballHolder).toBe('dev-x');
    expect(tasks[1]!.capsules.length).toBe(1);
  });
});

describe('目标任务不存在', () => {
  it('apply 时 target 不存在 → applied=false', async () => {
    const queue = new SteerQueue();
    queue.submit(makeCommand({ action: SteerAction.CANCEL, targetTaskId: 'ghost' }));
    const effect = await queue.applyToQueue(makeQueue());
    expect(effect.applied).toBe(false);
    expect(effect.message).toContain('目标任务不存在');
  });
});

describe('I3 trace 归档', () => {
  it('归档启用时每次应用落盘 JSONL（append-only）', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'steer-'));
    const archivePath = pathMod.join(dir, 'steer_trace.jsonl');
    const queue = new SteerQueue({ traceArchive: { enabled: true, path: archivePath } });
    queue.submit(makeCommand());
    await queue.applyToQueue(makeQueue());
    queue.submit(makeCommand({ action: SteerAction.RESUME }));
    await queue.applyToQueue(makeQueue());
    const lines = (await fs.readFile(archivePath, 'utf-8')).trim().split('\n');
    expect(lines.length).toBe(2);
    const record = JSON.parse(lines[0]!) as { command: { action: string }; effect: { applied: boolean } };
    expect(record.command.action).toBe('pause');
    expect(record.effect.applied).toBe(true);
  });

  it('归档禁用 → 零落盘', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'steer-'));
    const archivePath = pathMod.join(dir, 'none.jsonl');
    const queue = new SteerQueue({ traceArchive: { enabled: false, path: archivePath } });
    queue.submit(makeCommand());
    await queue.applyToQueue(makeQueue());
    await expect(fs.readFile(archivePath, 'utf-8')).rejects.toThrow();
  });
});

describe('advanceToVerdict 辅助', () => {
  it('从 STATE 推进到 VERDICT', () => {
    const state = new TeamActState({ taskId: 't', ballHolder: 'dev' });
    const step = advanceToVerdict(state);
    expect(step).toBe('verdict');
    expect(state.currentStep).toBe(TeamActStep.VERDICT);
  });

  it('已在 VERDICT 不再推进', () => {
    const state = new TeamActState({ taskId: 't', currentStep: TeamActStep.VERDICT });
    expect(advanceToVerdict(state)).toBe('verdict');
    expect(state.history.length).toBe(0);
  });
});
