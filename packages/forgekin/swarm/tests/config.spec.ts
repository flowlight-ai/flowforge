/**
 * agent_swarm.yaml 配置加载 — 解析 + 内置配置保真验证。
 *
 * @module @flowforge/forgekin-swarm/tests
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SwarmCoordinator } from '../src/coordinator.js';
import {
  loadAgentSwarmConfig,
  parseAgentSwarmConfig,
  toCoordinatorConfig,
} from '../src/config.js';
import { makeSwarmTask } from '../src/models.js';

const BUILTIN_YAML = join(import.meta.dirname, '..', 'config', 'agent-swarm.yaml');

describe('parseAgentSwarmConfig', () => {
  it('缺 agent_swarm 段抛错', () => {
    expect(() => parseAgentSwarmConfig({ other: {} })).toThrow('agent_swarm');
    expect(() => parseAgentSwarmConfig(null)).toThrow();
  });

  it('最小段取默认值', () => {
    const config = parseAgentSwarmConfig({ agent_swarm: {} });
    expect(config.enabled).toBe(true);
    expect(config.heartbeatTimeoutSeconds).toBe(30);
    expect(config.maxRetries).toBe(3);
    expect(config.dispatchIntervalSeconds).toBe(5);
    expect(config.traceArchivePath).toBe('data/forgemind/swarm_trace.jsonl');
    expect(config.crossVendorRequired).toEqual([]);
    expect(config.agents).toEqual({});
  });

  it('enabled 显式 false 生效', () => {
    const config = parseAgentSwarmConfig({ agent_swarm: { enabled: false } });
    expect(config.enabled).toBe(false);
  });
});

describe('内置 agent-swarm.yaml 保真（对齐 config/agent_swarm.yaml）', () => {
  it('全局参数：timeout=200/max_retries=3/interval=5/trace 路径', async () => {
    const config = await loadAgentSwarmConfig(BUILTIN_YAML);
    expect(config.enabled).toBe(true);
    expect(config.heartbeatTimeoutSeconds).toBe(200);
    expect(config.maxRetries).toBe(3);
    expect(config.dispatchIntervalSeconds).toBe(5);
    expect(config.traceArchivePath).toBe('data/forgemind/swarm_trace.jsonl');
    expect(config.crossVendorRequired).toEqual(['code_review', 'doc_review']);
  });

  it('5 Forgekin 能力画像完整', async () => {
    const config = await loadAgentSwarmConfig(BUILTIN_YAML);
    const ids = Object.keys(config.agents);
    expect(ids).toEqual(['wenxin', 'sherlock', 'luban', 'vangogh', 'davinci']);

    expect(config.agents['wenxin']!.vendor).toBe('trae');
    expect(config.agents['wenxin']!.capabilities).toContain('doc_generation');
    expect(config.agents['wenxin']!.awakeningStage).toBe('E3');

    expect(config.agents['sherlock']!.capabilities).toEqual([
      'code_generation',
      'bug_fixing',
      'refactoring',
      'test_writing',
    ]);
    expect(config.agents['sherlock']!.awakeningStage).toBe('E4');

    expect(config.agents['luban']!.capabilities).toContain('architecture_design');
    expect(config.agents['luban']!.awakeningStage).toBe('E5');

    // 梵高：唯一 claude 厂商 + cross_vendor_required 标记
    expect(config.agents['vangogh']!.vendor).toBe('claude');
    expect(config.agents['vangogh']!.capabilities).toContain('code_review');
    expect(config.agents['vangogh']!.crossVendorRequired).toBe(true);

    expect(config.agents['davinci']!.capabilities).toContain('test_execution');
  });

  it('toCoordinatorConfig 转换后 coordinator 自动注册 5 agent（forgemind: 前缀）', async () => {
    const config = await loadAgentSwarmConfig(BUILTIN_YAML);
    const coord = new SwarmCoordinator({
      config: toCoordinatorConfig(config),
      archiveFn: () => {},
    });
    expect(coord.agents.size).toBe(5);
    expect(coord.agents.has('forgemind:vangogh')).toBe(true);
    expect(coord.heartbeatTimeout).toBe(200);
    expect(coord.crossVendorRequired).toEqual(new Set(['code_review', 'doc_review']));
  });

  it('内置画像端到端：code_review 任务跨厂商落到梵高', async () => {
    const config = await loadAgentSwarmConfig(BUILTIN_YAML);
    const coord = new SwarmCoordinator({
      config: toCoordinatorConfig(config),
      archiveFn: () => {},
    });
    const task = makeSwarmTask({
      title: 'review PR',
      description: '跨厂商审查',
      requiredCapabilities: ['code_review'],
      context: { author_agent_id: 'forgemind:sherlock', author_vendor: 'trae' },
    });
    coord.submitTask(task);
    const dispatched = await coord.dispatch();
    expect(dispatched).toEqual([task.taskId]);
    expect(task.assignedAgentId).toBe('forgemind:vangogh');
  });
});
