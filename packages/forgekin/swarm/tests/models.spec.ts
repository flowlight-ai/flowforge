/**
 * swarm models — 枚举 / 工厂默认值验证（对齐 forgemind/swarm.py 模型层）。
 *
 * @module @flowforge/forgekin-swarm/tests
 */

import { describe, expect, it } from 'vitest';
import {
  AgentHeartbeat,
  SwarmDispatchRecord,
  SwarmTask,
  SwarmTaskStatus,
  makeAgentHeartbeat,
  makeSwarmDispatchRecord,
  makeSwarmTask,
  priorityWeight,
} from '../src/models.js';

describe('priorityWeight', () => {
  it('四级优先级权重 low=1/normal=2/high=3/critical=4', () => {
    expect(priorityWeight('low')).toBe(1);
    expect(priorityWeight('normal')).toBe(2);
    expect(priorityWeight('high')).toBe(3);
    expect(priorityWeight('critical')).toBe(4);
  });

  it('非法值按 normal 处理（对齐 Python ValueError 兜底）', () => {
    expect(priorityWeight('bogus')).toBe(2);
    expect(priorityWeight('')).toBe(2);
  });
});

describe('makeSwarmTask', () => {
  it('默认值：task_id/status/priority/created_at/max_retries', () => {
    const task = makeSwarmTask({
      title: 't',
      description: 'd',
      requiredCapabilities: ['code_generation'],
    });
    expect(task.taskId).toMatch(/^swarm-[0-9a-f]{12}$/);
    expect(task.status).toBe(SwarmTaskStatus.PENDING);
    expect(task.priority).toBe('normal');
    expect(task.preferredAgentId).toBeNull();
    expect(task.assignedAgentId).toBeNull();
    expect(task.context).toEqual({});
    expect(task.result).toEqual({});
    expect(task.failureReason).toBe('');
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(3);
    expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(task.assignedAt).toBeNull();
    expect(task.heartbeatAt).toBeNull();
    // task_id 唯一
    const task2 = makeSwarmTask({
      title: 't',
      description: 'd',
      requiredCapabilities: ['code_generation'],
    });
    expect(task2.taskId).not.toBe(task.taskId);
  });

  it('入参覆盖 + requiredCapabilities 拷贝隔离', () => {
    const caps = ['doc_generation'];
    const task: SwarmTask = makeSwarmTask({
      title: '写文档',
      description: 'desc',
      requiredCapabilities: caps,
      taskId: 'swarm-fixed',
      priority: 'critical',
      context: { author_agent_id: 'forgemind:sherlock' },
      maxRetries: 5,
    });
    expect(task.taskId).toBe('swarm-fixed');
    expect(task.priority).toBe('critical');
    expect(task.maxRetries).toBe(5);
    expect(task.context['author_agent_id']).toBe('forgemind:sherlock');
    caps.push('mutated');
    expect(task.requiredCapabilities).toEqual(['doc_generation']);
  });
});

describe('makeAgentHeartbeat', () => {
  it('默认值：task_id=null/status=idle/progress=0/timestamp=now', () => {
    const hb: AgentHeartbeat = makeAgentHeartbeat({ agentId: 'forgemind:wenxin' });
    expect(hb.agentId).toBe('forgemind:wenxin');
    expect(hb.taskId).toBeNull();
    expect(hb.status).toBe('idle');
    expect(hb.progress).toBe(0.0);
    expect(hb.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('makeSwarmDispatchRecord', () => {
  it('默认值：record_id/dispatched_at/reassigned_from/reason', () => {
    const rec: SwarmDispatchRecord = makeSwarmDispatchRecord({
      taskId: 'swarm-x',
      agentId: '',
      action: 'submit',
    });
    expect(rec.recordId).toMatch(/^swarm-rec-[0-9a-f]{8}$/);
    expect(rec.dispatchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.reassignedFrom).toBeNull();
    expect(rec.reason).toBe('');
  });
});
