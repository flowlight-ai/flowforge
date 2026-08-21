/**
 * @flowforge/forgekin-swarm — agent_swarm.yaml 配置加载（对齐 config/agent_swarm.yaml）
 *
 * 解析 YAML 顶层 `agent_swarm` 段为 AgentSwarmConfig（camelCase），
 * 并可转换为 SwarmCoordinator 构造所需的 snake_case 配置字典。
 * 包内自带 5 Forgekin 能力画像：config/agent-swarm.yaml。
 */
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { SwarmCoordinatorConfig } from './coordinator.js';

/** 单个 agent 能力画像（agent_swarm.agents.<id> 段） */
export interface AgentProfileConfig {
  /** LLM 厂商标识（如 "trae" / "claude"），I5 跨厂商过滤依据 */
  vendor: string;
  /** 能力清单（如 ["doc_generation", "doc_review"]） */
  capabilities: string[];
  /** 觉醒阶（E1-E5，信息字段） */
  awakeningStage: string;
  /** 标记：本 agent 的 review 任务必须跨厂商（信息字段） */
  crossVendorRequired: boolean;
}

/** agent_swarm 段解析结果 */
export interface AgentSwarmConfig {
  /** 全局开关 */
  enabled: boolean;
  /** I4 心跳超时阈值（秒） */
  heartbeatTimeoutSeconds: number;
  /** I4 最大重试次数 */
  maxRetries: number;
  /** 调度循环间隔（秒） */
  dispatchIntervalSeconds: number;
  /** I2 trace 归档路径（相对路径，由调用方拼接 data_dir） */
  traceArchivePath: string;
  /** I5 跨厂商能力清单 */
  crossVendorRequired: string[];
  /** 5 Forgekin 能力画像（key 为短名，如 "wenxin"） */
  agents: Record<string, AgentProfileConfig>;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`agent_swarm config: ${where} 必须是映射`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, where: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`agent_swarm config: ${where} 必须是列表`);
  }
  return value.map((v) => String(v));
}

/** 解析 YAML 文档对象中的 agent_swarm 段（缺段或类型错误抛错） */
export function parseAgentSwarmConfig(doc: unknown): AgentSwarmConfig {
  const root = asRecord(doc, '根节点');
  const section = root['agent_swarm'];
  const swarm = asRecord(section, 'agent_swarm 段');

  const traceArchive = asRecord(swarm['trace_archive'] ?? {}, 'trace_archive 段');

  const agents: Record<string, AgentProfileConfig> = {};
  const agentsSection = swarm['agents'];
  if (agentsSection !== undefined && agentsSection !== null) {
    const agentsRecord = asRecord(agentsSection, 'agents 段');
    for (const [agentId, raw] of Object.entries(agentsRecord)) {
      const profile = asRecord(raw, `agents.${agentId}`);
      agents[agentId] = {
        vendor: typeof profile['vendor'] === 'string' ? profile['vendor'] : 'unknown',
        capabilities: asStringArray(profile['capabilities'], `agents.${agentId}.capabilities`),
        awakeningStage:
          typeof profile['awakening_stage'] === 'string' ? profile['awakening_stage'] : '',
        crossVendorRequired: profile['cross_vendor_required'] === true,
      };
    }
  }

  return {
    enabled: swarm['enabled'] !== false,
    heartbeatTimeoutSeconds: Number(swarm['heartbeat_timeout_seconds'] ?? 30),
    maxRetries: Number(swarm['max_retries'] ?? 3),
    dispatchIntervalSeconds: Number(swarm['dispatch_interval_seconds'] ?? 5),
    traceArchivePath:
      typeof traceArchive['path'] === 'string'
        ? traceArchive['path']
        : 'data/forgemind/swarm_trace.jsonl',
    crossVendorRequired: asStringArray(swarm['cross_vendor_required'], 'cross_vendor_required'),
    agents,
  };
}

/** 从 YAML 文件加载 agent_swarm 配置（对齐 Python 通过 DI 注入读取 config/agent_swarm.yaml） */
export async function loadAgentSwarmConfig(yamlPath: string): Promise<AgentSwarmConfig> {
  const text = await readFile(yamlPath, 'utf8');
  return parseAgentSwarmConfig(parse(text));
}

/**
 * 转换为 SwarmCoordinator 构造配置（snake_case 键，对齐 Python config 字段）：
 *   heartbeat_timeout_seconds / max_retries / dispatch_interval_seconds /
 *   cross_vendor_required / trace_archive_path / agents
 */
export function toCoordinatorConfig(config: AgentSwarmConfig): SwarmCoordinatorConfig {
  const agents: Record<string, unknown> = {};
  for (const [agentId, profile] of Object.entries(config.agents)) {
    agents[agentId] = {
      vendor: profile.vendor,
      capabilities: profile.capabilities,
      awakening_stage: profile.awakeningStage,
      cross_vendor_required: profile.crossVendorRequired,
    };
  }
  return {
    heartbeat_timeout_seconds: config.heartbeatTimeoutSeconds,
    max_retries: config.maxRetries,
    dispatch_interval_seconds: config.dispatchIntervalSeconds,
    cross_vendor_required: config.crossVendorRequired,
    trace_archive_path: config.traceArchivePath,
    agents,
  };
}
