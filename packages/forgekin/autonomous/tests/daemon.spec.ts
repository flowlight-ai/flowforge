/**
 * daemon — F052 自主运行守护进程验证（真实临时文件系统 + 注入睡眠）。
 *
 * 覆盖：executeTask 成功/无效产出/异常/未注册 / persistTaskOutput
 * 三类型落盘 / buildTaskPrompt 真实上下文 / isTaskInProgress /
 * runForever 端到端（扫描→分发→执行→落盘）。
 *
 * @module @flowforge/forgekin-autonomous/tests
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SwarmCoordinator, SwarmTaskStatus, makeSwarmTask } from '@flowforge/forgekin-swarm';
import { AutonomousDaemon, AutonomousForgekin, SleepFn } from '../src/daemon.js';

/** 即时睡眠（setTimeout(0) 让步，避免微任务风暴饿死事件循环） */
const instantSleep: SleepFn = () => new Promise((resolve) => setTimeout(resolve, 0));

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autonomous-daemon-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function makeCoordinator(): SwarmCoordinator {
  return new SwarmCoordinator({ archiveFn: () => {}, sleepFn: instantSleep });
}

function makeDaemon(options: {
  forgekins?: Record<string, AutonomousForgekin>;
  maxTasksPerScan?: number;
} = {}): { daemon: AutonomousDaemon; coordinator: SwarmCoordinator } {
  const coordinator = makeCoordinator();
  const daemon = new AutonomousDaemon({
    coordinator,
    projectRoot: root,
    forgekins: options.forgekins,
    config: {
      scan_interval_seconds: 0.005,
      consumer_interval_seconds: 0.001,
      keepalive_interval_seconds: 0.001,
      max_tasks_per_scan: options.maxTasksPerScan ?? 5,
    },
    scannerConfig: { sourceDirName: 'src', coreModules: [] },
    sleepFn: instantSleep,
  });
  return { daemon, coordinator };
}

/** 构造已提交 + 已分配的 SwarmTask */
function submitAssigned(
  coordinator: SwarmCoordinator,
  init: { title: string; caps: string[]; context?: Record<string, unknown> },
  agentId = 'forgemind:wenxin',
) {
  const task = makeSwarmTask({
    title: init.title,
    description: '测试任务描述',
    requiredCapabilities: init.caps,
    context: init.context ?? {},
  });
  coordinator.submitTask(task);
  task.assignedAgentId = agentId;
  task.status = SwarmTaskStatus.ASSIGNED;
  return task;
}

const VALID_DOC = '自动生成的规格文档内容，包含概述与使用说明。';

describe('executeTask', () => {
  it('Bug 4：未注册灵智体 → failTask 不悬挂', async () => {
    const { daemon, coordinator } = makeDaemon();
    const task = submitAssigned(coordinator, { title: 'doc', caps: ['doc_generation'] });
    await daemon.executeTask(task);
    expect(coordinator.tasks.get(task.taskId)?.status).toBe(SwarmTaskStatus.FAILED);
    expect(coordinator.tasks.get(task.taskId)?.failureReason).toContain('未注册');
  });

  it('doc_generation 成功：落盘 + front-matter + COMPLETED + 产出记录', async () => {
    const chatCalls: number[][] = [];
    const forgekin: AutonomousForgekin = {
      async chat(messages) {
        chatCalls.push([messages.length]);
        return { content: VALID_DOC, model: 'test-model' };
      },
    };
    const { daemon, coordinator } = makeDaemon({ forgekins: { 'forgemind:wenxin': forgekin } });
    const task = submitAssigned(coordinator, {
      title: '补充缺失文档: docs/spec.md',
      caps: ['doc_generation'],
      context: { doc_path: 'docs/spec.md' },
    });
    await daemon.executeTask(task);

    expect(chatCalls.length).toBe(1);
    expect(coordinator.tasks.get(task.taskId)?.status).toBe(SwarmTaskStatus.COMPLETED);

    const written = readFileSync(path.join(root, 'docs/spec.md'), 'utf-8');
    expect(written.startsWith('---\n')).toBe(true);
    expect(written).toContain('type: autonomous_generated');
    expect(written).toContain('model: test-model');
    expect(written).toContain(VALID_DOC);

    const outputs = daemon.getCompletedOutputs();
    expect(outputs.length).toBe(1);
    expect(outputs[0]?.output_path).toBe('docs/spec.md');
    expect(outputs[0]?.model).toBe('test-model');
  });

  it('code_generation 成功：写入 patches 审阅目录', async () => {
    write('src/a.py', '# TODO: implement\ndef f(): pass\n');
    const forgekin: AutonomousForgekin = {
      async chat() {
        return { content: 'def f():\n    return 42  # 已实现的完整代码', model: 'test-model' };
      },
    };
    const { daemon, coordinator } = makeDaemon({ forgekins: { 'forgemind:wenxin': forgekin } });
    const task = submitAssigned(coordinator, {
      title: '修复代码 TODO: src/a.py',
      caps: ['code_generation'],
      context: { file: 'src/a.py' },
    });
    await daemon.executeTask(task);

    expect(coordinator.tasks.get(task.taskId)?.status).toBe(SwarmTaskStatus.COMPLETED);
    const patchPath = path.join(
      root, 'flowforge', '.autonomous', 'patches', `${task.taskId.slice(0, 12)}_a.md`,
    );
    expect(existsSync(patchPath)).toBe(true);
    const patch = readFileSync(patchPath, 'utf-8');
    expect(patch).toContain('# 自主任务产出审阅');
    expect(patch).toContain('src/a.py');
    expect(patch).toContain('已实现的完整代码');
  });

  it('Bug 2：无效产出标记 → failTask invalid_output', async () => {
    const forgekin: AutonomousForgekin = {
      async chat() {
        return { content: '[CLI 错误] 调用失败，请稍后重试。', model: 'x' };
      },
    };
    const { daemon, coordinator } = makeDaemon({ forgekins: { 'forgemind:wenxin': forgekin } });
    const task = submitAssigned(coordinator, { title: 't', caps: ['doc_generation'] });
    await daemon.executeTask(task);
    expect(coordinator.tasks.get(task.taskId)?.status).toBe(SwarmTaskStatus.FAILED);
    expect(coordinator.tasks.get(task.taskId)?.failureReason).toBe('invalid_output');
  });

  it('Bug 5：usage.error → failTask invalid_output 并携带原因', async () => {
    const forgekin: AutonomousForgekin = {
      async chat() {
        return { content: VALID_DOC, model: 'x', usage: { error: 'timeout' } };
      },
    };
    const { daemon, coordinator } = makeDaemon({ forgekins: { 'forgemind:wenxin': forgekin } });
    const task = submitAssigned(coordinator, { title: 't', caps: ['doc_generation'] });
    await daemon.executeTask(task);
    expect(coordinator.tasks.get(task.taskId)?.failureReason).toBe('invalid_output: timeout');
  });

  it('chat 抛异常 → failTask execution_exception', async () => {
    const forgekin: AutonomousForgekin = {
      async chat() {
        throw new Error('llm down');
      },
    };
    const { daemon, coordinator } = makeDaemon({ forgekins: { 'forgemind:wenxin': forgekin } });
    const task = submitAssigned(coordinator, { title: 't', caps: ['doc_generation'] });
    await daemon.executeTask(task);
    expect(coordinator.tasks.get(task.taskId)?.status).toBe(SwarmTaskStatus.FAILED);
    expect(coordinator.tasks.get(task.taskId)?.failureReason).toBe('execution_exception: llm down');
  });
});

describe('persistTaskOutput', () => {
  it('已有 front-matter 的文档内容不被二次包裹', () => {
    const { daemon, coordinator } = makeDaemon();
    const task = submitAssigned(coordinator, {
      title: 't',
      caps: ['doc_generation'],
      context: { doc_path: 'docs/spec.md' },
    });
    const content = '---\nstatus: ok\n---\nbody text';
    const rel = daemon.persistTaskOutput(task, content, 'm');
    expect(rel).toBe('docs/spec.md');
    expect(readFileSync(path.join(root, 'docs/spec.md'), 'utf-8')).toBe(content);
  });

  it('未知能力类型落盘到 outputs 目录；空内容返回 null', () => {
    const { daemon, coordinator } = makeDaemon();
    const task = submitAssigned(coordinator, { title: 't', caps: ['analysis'] });
    const rel = daemon.persistTaskOutput(task, '分析报告内容，足够长度。', 'm');
    expect(rel).not.toBeNull();
    expect(rel).toContain('outputs');
    expect(existsSync(path.join(root, rel as string))).toBe(true);
    expect(daemon.persistTaskOutput(task, '', 'm')).toBeNull();
  });
});

describe('buildTaskPrompt', () => {
  it('注入目标文件真实内容 + 任务信息', () => {
    write('src/a.py', '# TODO: implement\ndef f(): pass\n');
    const { daemon } = makeDaemon();
    const task = makeSwarmTask({
      title: '修复代码 TODO: src/a.py',
      description: '实现缺失逻辑',
      requiredCapabilities: ['code_generation'],
      context: { file: 'src/a.py' },
    });
    const prompt = daemon.buildTaskPrompt(task);
    expect(prompt).toContain('修复代码 TODO: src/a.py');
    expect(prompt).toContain('# TODO: implement');
    expect(prompt).toContain('禁止生成假设性代码');
  });
});

describe('isTaskInProgress', () => {
  it('未提交过的标题返回 false', () => {
    const { daemon } = makeDaemon();
    expect(daemon.isTaskInProgress('不存在的任务')).toBe(false);
  });
});

describe('runForever 端到端', () => {
  it('扫描→分发→执行→落盘完整链路（限量生效）', async () => {
    write('src/empty.py', 'x = 1\n');
    const forgekin: AutonomousForgekin = {
      async chat() {
        return { content: VALID_DOC, model: 'test-model' };
      },
    };
    const coordinator = makeCoordinator();
    coordinator.registerAgent('forgemind:wenxin', ['doc_generation'], 'trae');
    const daemon = new AutonomousDaemon({
      coordinator,
      projectRoot: root,
      forgekins: { 'forgemind:wenxin': forgekin },
      config: {
        scan_interval_seconds: 0.005,
        consumer_interval_seconds: 0.001,
        keepalive_interval_seconds: 0.001,
        max_tasks_per_scan: 1, // 限量：每轮只提交 1 个（spec.md 优先）
      },
      scannerConfig: { sourceDirName: 'src', coreModules: [] },
      sleepFn: instantSleep,
    });

    const runPromise = daemon.runForever();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(path.join(root, 'docs/spec.md'))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    daemon.stop();
    await runPromise;

    expect(existsSync(path.join(root, 'docs/spec.md'))).toBe(true);
    expect(existsSync(path.join(root, 'docs/arch.md'))).toBe(false); // 限量未提交
    expect(daemon.getCompletedOutputs().length).toBe(1);
    const status = daemon.getStatus();
    expect(status['completed']).toBe(1);
    expect(status['registered_forgekins']).toEqual(['forgemind:wenxin']);
    const log = daemon.getActivityLog();
    expect(log.some((entry) => entry.event_type === 'daemon_started')).toBe(true);
    expect(log.some((entry) => entry.event_type === 'task_completed')).toBe(true);
  });
});
