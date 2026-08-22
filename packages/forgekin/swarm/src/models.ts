/**
 * @flowforge/forgekin-swarm — 数据模型（对齐 forgemind/swarm.py 枚举 + Pydantic 模型）
 *
 * F049 agent-swarm 协议层模型：
 *   - SwarmTaskStatus：7 状态枚举（pending/assigned/running/completed/failed/reassigned/cancelled）
 *   - SwarmPriority：4 级优先级（low/normal/high/critical，dispatch 按权重倒序）
 *   - SwarmTask：submit_task 载荷（task_id 默认 swarm-{uuid12}）
 *   - AgentHeartbeat：I4 心跳载荷
 *   - SwarmDispatchRecord：I2 trace 记录（落盘 swarm_trace.jsonl）
 *
 * 时间戳统一使用 ISO-8601 UTC 字符串（Python datetime → TS Date.toISOString）。
 */
import { randomUUID } from 'node:crypto';

/** 工厂入参辅助类型：全部可选且显式允许 undefined（exactOptionalPropertyTypes） */
type PartialWithUndefined<T> = { [K in keyof T]?: T[K] | undefined };

// ──────────────────────────────────────────────────────────────────
// 枚举定义
// ──────────────────────────────────────────────────────────────────

/** Swarm 任务状态（F049 §2.4 关键接口的 7 状态枚举） */
export const SwarmTaskStatus = {
  /** 待分配（已提交，等待 dispatch） */
  PENDING: 'pending',
  /** 已分配（dispatch 已选定 agent，等待 agent 开始执行） */
  ASSIGNED: 'assigned',
  /** 执行中（agent 已通过 heartbeat 上报进度） */
  RUNNING: 'running',
  /** 已完成（agent 上报完成，result 已填） */
  COMPLETED: 'completed',
  /** 失败（reassign 超过 maxRetries 或 agent 上报失败） */
  FAILED: 'failed',
  /** 被重新分配（心跳超时，retryCount += 1 后重新入队） */
  REASSIGNED: 'reassigned',
  /** 已取消（operator 通过 SteerCommand CANCEL 取消） */
  CANCELLED: 'cancelled',
} as const;

export type SwarmTaskStatus = (typeof SwarmTaskStatus)[keyof typeof SwarmTaskStatus];

/** Swarm 任务优先级（用于 dispatch 排序） */
export const SwarmPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type SwarmPriority = (typeof SwarmPriority)[keyof typeof SwarmPriority];

/** 优先级权重（数值越大越优先分发）；非法值按 normal 处理（对齐 Python ValueError 兜底） */
export function priorityWeight(priority: string): number {
  switch (priority) {
    case SwarmPriority.LOW:
      return 1;
    case SwarmPriority.NORMAL:
      return 2;
    case SwarmPriority.HIGH:
      return 3;
    case SwarmPriority.CRITICAL:
      return 4;
    default:
      return 2;
  }
}

// ──────────────────────────────────────────────────────────────────
// 数据模型
// ──────────────────────────────────────────────────────────────────

/** Swarm 任务 — submitTask 的载荷（对齐 Pydantic SwarmTask，可变接口） */
export interface SwarmTask {
  /** 任务唯一标识（swarm-{uuid12}，自动生成） */
  taskId: string;
  /** 任务标题（operator 可读） */
  title: string;
  /** 任务描述（含目标、上下文、约束） */
  description: string;
  /** 需要的能力清单（I3 能力匹配依据） */
  requiredCapabilities: string[];
  /** 优先分配的 agent（可选，dispatch 时优先考虑） */
  preferredAgentId: string | null;
  /** 实际分配到的 agent（dispatch 后填入） */
  assignedAgentId: string | null;
  /** 任务状态 */
  status: SwarmTaskStatus;
  /** 优先级（low/normal/high/critical，默认 normal） */
  priority: string;
  /** 附加上下文（含 authorAgentId / authorVendor 等 I5/I6 校验字段） */
  context: Record<string, unknown>;
  /** 创建时间（UTC ISO） */
  createdAt: string;
  /** 分配时间（dispatch 时填入） */
  assignedAt: string | null;
  /** 开始执行时间（首次 heartbeat 时填入） */
  startedAt: string | null;
  /** 完成时间（agent 上报完成时填入） */
  completedAt: string | null;
  /** 最近一次心跳时间（heartbeat 时更新） */
  heartbeatAt: string | null;
  /** 任务结果（agent 上报完成时填入） */
  result: Record<string, unknown>;
  /** 失败原因（FAILED 时填入） */
  failureReason: string;
  /** 已重试次数（reassign 时 +1） */
  retryCount: number;
  /** 最大重试次数（默认 3，I4 不变量） */
  maxRetries: number;
}

/** Agent 心跳 — heartbeat 方法的载荷（I4 心跳超时回收依据） */
export interface AgentHeartbeat {
  /** 发送心跳的 agent ID */
  agentId: string;
  /** 当前正在执行的任务 ID（idle 时为 null） */
  taskId: string | null;
  /** 心跳时间戳（UTC ISO） */
  timestamp: string;
  /** agent 状态（idle/busy/error） */
  status: string;
  /** 任务进度（0.0-1.0，agent 自评） */
  progress: number;
}

/** Swarm 调度记录 — I2 trace 记录（落盘到 swarm_trace.jsonl） */
export interface SwarmDispatchRecord {
  /** 记录唯一标识（swarm-rec-{uuid8}） */
  recordId: string;
  /** 对应的任务 ID */
  taskId: string;
  /** 分配到的 agent ID（reassign 时为新 agent；submit 时为 ""） */
  agentId: string;
  /** 调度动作（submit / dispatch / reassign / complete / fail / cancel） */
  action: string;
  /** 调度时间（UTC ISO） */
  dispatchedAt: string;
  /** reassign 时的原 agent ID（仅 reassign 动作） */
  reassignedFrom: string | null;
  /** 调度原因（如 "heartbeat_timeout" / "agent_completed"） */
  reason: string;
}

// ──────────────────────────────────────────────────────────────────
// 工厂函数
// ──────────────────────────────────────────────────────────────────

export type SwarmTaskInit = Pick<SwarmTask, 'title' | 'description' | 'requiredCapabilities'> &
  PartialWithUndefined<Omit<SwarmTask, 'title' | 'description' | 'requiredCapabilities'>>;

/** 创建 SwarmTask（对齐 Pydantic default_factory：task_id swarm-{uuid12} + created_at now） */
export function makeSwarmTask(init: SwarmTaskInit): SwarmTask {
  return {
    taskId: init.taskId ?? `swarm-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    title: init.title,
    description: init.description,
    requiredCapabilities: [...init.requiredCapabilities],
    preferredAgentId: init.preferredAgentId ?? null,
    assignedAgentId: init.assignedAgentId ?? null,
    status: init.status ?? SwarmTaskStatus.PENDING,
    priority: init.priority ?? 'normal',
    context: init.context ?? {},
    createdAt: init.createdAt ?? new Date().toISOString(),
    assignedAt: init.assignedAt ?? null,
    startedAt: init.startedAt ?? null,
    completedAt: init.completedAt ?? null,
    heartbeatAt: init.heartbeatAt ?? null,
    result: init.result ?? {},
    failureReason: init.failureReason ?? '',
    retryCount: init.retryCount ?? 0,
    maxRetries: init.maxRetries ?? 3,
  };
}

export type AgentHeartbeatInit = Pick<AgentHeartbeat, 'agentId'> &
  PartialWithUndefined<Omit<AgentHeartbeat, 'agentId'>>;

/** 创建 AgentHeartbeat（timestamp 默认 now） */
export function makeAgentHeartbeat(init: AgentHeartbeatInit): AgentHeartbeat {
  return {
    agentId: init.agentId,
    taskId: init.taskId ?? null,
    timestamp: init.timestamp ?? new Date().toISOString(),
    status: init.status ?? 'idle',
    progress: init.progress ?? 0.0,
  };
}

export type SwarmDispatchRecordInit = Pick<SwarmDispatchRecord, 'taskId' | 'agentId' | 'action'> &
  PartialWithUndefined<Omit<SwarmDispatchRecord, 'taskId' | 'agentId' | 'action'>>;

/** 创建 SwarmDispatchRecord（record_id swarm-rec-{uuid8} + dispatched_at now） */
export function makeSwarmDispatchRecord(init: SwarmDispatchRecordInit): SwarmDispatchRecord {
  return {
    recordId: init.recordId ?? `swarm-rec-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    taskId: init.taskId,
    agentId: init.agentId,
    action: init.action,
    dispatchedAt: init.dispatchedAt ?? new Date().toISOString(),
    reassignedFrom: init.reassignedFrom ?? null,
    reason: init.reason ?? '',
  };
}
