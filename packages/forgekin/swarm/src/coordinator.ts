/**
 * @flowforge/forgekin-swarm — SwarmCoordinator 核心类（对齐 forgemind/swarm.py）
 *
 * Swarm 协调器 — Forgekin 协同调度（I1 单一调度器）：
 *   - 任务分发（capability-based routing，I3 能力匹配）
 *   - 心跳监控（I4 超时回收，默认 30s）
 *   - 能力互补（blind_spots 自动找搭档）
 *   - 跨厂商独立（I5/I6 review 任务路由到不同厂商）
 *
 * 不变量（F049 §2.5）：
 *   - I1: 单一调度器 — 全局唯一，禁止 Forgekin 之间直接派发任务
 *   - I2: 任务不丢失 — submitTask 必立即写入 tasks + 落盘 trace
 *   - I3: 能力匹配 — dispatch 必须把任务路由给能力匹配的 agent
 *   - I4: 心跳超时回收 — 无心跳自动 reassign，最多 maxRetries 次
 *   - I5: 跨厂商独立 — crossVendorRequired 中的能力必须跨厂商
 *   - I6: no-self-review — reviewer 不能审自己的产物
 *
 * 可注入测试点：archiveFn（默认 JSONL append）/ nowFn / sleepFn。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AgentHeartbeat,
  SwarmDispatchRecord,
  SwarmTask,
  SwarmTaskStatus,
  makeAgentHeartbeat,
  makeSwarmDispatchRecord,
  priorityWeight,
} from './models.js';

/** trace 归档函数（I2 落盘）；抛错不阻断主流程 */
export type ArchiveFn = (record: SwarmDispatchRecord) => void;
/** 当前时间函数（UTC ISO），测试注入控制超时判定 */
export type NowFn = () => string;
/** 睡眠函数，测试注入免真实等待 */
export type SleepFn = (ms: number) => Promise<void>;

/** 已注册 agent 画像 */
export interface SwarmAgentInfo {
  agentId: string;
  capabilities: string[];
  vendor: string;
  registeredAt: string;
}

/** listAgents 返回的画像摘要 */
export interface SwarmAgentSummary {
  agentId: string;
  capabilities: string[];
  vendor: string;
  workload: number;
  lastHeartbeat: string | null;
  lastStatus: string;
}

export interface SwarmCoordinatorConfig {
  /** 可选配置字典（snake_case 键，对齐 Python config） */
  readonly [key: string]: unknown;
}

export interface SwarmCoordinatorOptions {
  /** 可选配置字典（铁律 3：依赖通过构造函数注入） */
  readonly config?: SwarmCoordinatorConfig | undefined;
  /** trace 归档函数注入（默认 JSONL append 到 traceArchivePath） */
  readonly archiveFn?: ArchiveFn | undefined;
  /** 当前时间注入（测试用） */
  readonly nowFn?: NowFn | undefined;
  /** 睡眠注入（测试用） */
  readonly sleepFn?: SleepFn | undefined;
}

/** 默认 trace 归档：JSONL append-only（禁止覆盖，I2 不变量），父目录自动创建 */
export function defaultArchiveFn(traceArchivePath: string): ArchiveFn {
  return (record) => {
    mkdirSync(dirname(traceArchivePath), { recursive: true });
    const line = JSON.stringify({
      record_id: record.recordId,
      task_id: record.taskId,
      agent_id: record.agentId,
      action: record.action,
      dispatched_at: record.dispatchedAt,
      reassigned_from: record.reassignedFrom,
      reason: record.reason,
    });
    appendFileSync(traceArchivePath, `${line}\n`, 'utf8');
  };
}

export class SwarmCoordinator {
  static readonly HEARTBEAT_TIMEOUT_SECONDS = 30.0; // I4 心跳超时
  static readonly MAX_RETRIES = 3; // 最大重试次数（I4）

  readonly heartbeatTimeout: number;
  readonly maxRetries: number;
  readonly dispatchInterval: number;
  readonly crossVendorRequired: Set<string>;
  readonly traceArchivePath: string;

  /** agent_id -> 画像 */
  readonly agents = new Map<string, SwarmAgentInfo>();
  /** task_id -> SwarmTask */
  readonly tasks = new Map<string, SwarmTask>();
  /** agent_id -> latest heartbeat */
  readonly heartbeats = new Map<string, AgentHeartbeat>();

  readonly archiveFn: ArchiveFn;
  readonly nowFn: NowFn;
  readonly sleepFn: SleepFn;

  /** runContinuously 运行标志 */
  running = false;

  constructor(options: SwarmCoordinatorOptions = {}) {
    const config = options.config ?? {};
    this.nowFn = options.nowFn ?? (() => new Date().toISOString());
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    // 允许通过 config 覆盖默认值（铁律 5：不硬编码）
    this.heartbeatTimeout = Number(
      config['heartbeat_timeout_seconds'] ?? SwarmCoordinator.HEARTBEAT_TIMEOUT_SECONDS,
    );
    this.maxRetries = Number(config['max_retries'] ?? SwarmCoordinator.MAX_RETRIES);
    this.dispatchInterval = Number(config['dispatch_interval_seconds'] ?? 5.0);
    this.crossVendorRequired = new Set(
      (config['cross_vendor_required'] as string[] | undefined) ?? ['code_review', 'doc_review'],
    );
    // 相对路径（红线 11：不硬编码绝对路径，由调用方拼接 data_dir）
    this.traceArchivePath = String(
      config['trace_archive_path'] ?? 'data/forgemind/swarm_trace.jsonl',
    );
    this.archiveFn = options.archiveFn ?? defaultArchiveFn(this.traceArchivePath);

    // 若 config 含 agents 画像，自动注册（便利方法）
    const agentsConfig = config['agents'];
    if (agentsConfig && typeof agentsConfig === 'object') {
      for (const [agentId, agentInfo] of Object.entries(agentsConfig as Record<string, unknown>)) {
        // 兼容 forgekin_id 前缀（agent_swarm.yaml 中是短名，运行时可能是 forgemind:xxx）
        const fullId = agentId.includes(':') ? agentId : `forgemind:${agentId}`;
        const info = (agentInfo ?? {}) as Record<string, unknown>;
        const caps = info['capabilities'];
        this.registerAgent(
          fullId,
          Array.isArray(caps) ? caps.map(String) : [],
          typeof info['vendor'] === 'string' ? info['vendor'] : 'unknown',
        );
      }
    }
  }

  // ── Agent 注册 ──────────────────────────────────────────────

  /**
   * 注册 agent 到 swarm（含能力画像 + 厂商标识）。
   * 重复注册同一 agentId 将覆盖原有画像（支持热更新能力）；
   * capabilities 为空列表时记 warning 但不拒绝（agent 仅作 idle 接收方）。
   */
  registerAgent(agentId: string, capabilities: string[], vendor = 'unknown'): void {
    if (!agentId) {
      throw new Error('agent_id 不能为空');
    }
    this.agents.set(agentId, {
      agentId,
      capabilities: [...capabilities],
      vendor,
      registeredAt: this.nowFn(),
    });
    // 初始化 idle 心跳（避免 checkTimeouts 误判未注册 agent）
    if (!this.heartbeats.has(agentId)) {
      this.heartbeats.set(agentId, makeAgentHeartbeat({ agentId, status: 'idle' }));
    }
  }

  // ── 任务提交（I2 提交必有 trace）────────────────────────────

  /**
   * 提交任务到 swarm（I2 提交必有 trace）。
   * I2: 同步写入 tasks 字典（强保证）+ 落盘 trace（弱保证，archive 失败不阻断 submit）。
   */
  submitTask(task: SwarmTask): string {
    if (!task.title || !task.description) {
      throw new Error('SwarmTask.title / description 不能为空');
    }
    if (task.requiredCapabilities.length === 0) {
      throw new Error('SwarmTask.required_capabilities 不能为空');
    }

    // I2: 同步写入 tasks 字典（任务不丢失）
    this.tasks.set(task.taskId, task);

    // I2: 落盘 trace（submit 动作）
    this.archiveSafe(
      makeSwarmDispatchRecord({
        taskId: task.taskId,
        agentId: '', // submit 时还未分配
        action: 'submit',
        reason: `required_capabilities=${JSON.stringify(task.requiredCapabilities)}`,
      }),
    );
    return task.taskId;
  }

  // ── 任务分发（I3 capability-based routing）─────────────────

  /**
   * 分发待处理任务（capability-based routing，I3 能力匹配）。
   * 流程：收集 PENDING/REASSIGNED → priority 倒序 → findCapableAgent；
   * 无匹配则 tryFindComplements 推荐搭档（任务保持 PENDING）。
   * 返回分配成功的 taskId 列表。
   */
  async dispatch(): Promise<string[]> {
    // 收集待分发任务（PENDING + REASSIGNED 都可重新分配）
    const pendingTasks = [...this.tasks.values()].filter(
      (t) => t.status === SwarmTaskStatus.PENDING || t.status === SwarmTaskStatus.REASSIGNED,
    );
    if (pendingTasks.length === 0) {
      return [];
    }

    // 按 priority 倒序排序（critical 优先）
    pendingTasks.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));

    const dispatchedIds: string[] = [];
    for (const task of pendingTasks) {
      const agentId = this.findCapableAgent(task);
      if (agentId === null) {
        // 未找到完全匹配的 agent，尝试能力互补推荐
        const complement = this.tryFindComplements(task);
        if (Object.keys(complement).length > 0) {
          task.context['complement_agents'] = complement;
        }
        continue;
      }

      // 找到 agent，更新任务状态
      const oldAgentId = task.assignedAgentId;
      task.assignedAgentId = agentId;
      task.status = SwarmTaskStatus.ASSIGNED;
      task.assignedAt = this.nowFn();
      // REASSIGNED → ASSIGNED 时保留 retryCount（不重置）
      // 重置 heartbeatAt 等待新 agent 上报
      task.heartbeatAt = null;
      task.startedAt = null;

      // I2: 落盘 dispatch trace
      this.archiveSafe(
        makeSwarmDispatchRecord({
          taskId: task.taskId,
          agentId,
          action: 'dispatch',
          reassignedFrom: oldAgentId,
          reason: `capabilities_match (priority=${task.priority})`,
        }),
      );
      dispatchedIds.push(task.taskId);
    }

    return dispatchedIds;
  }

  // ── 心跳上报（I4 心跳监控）──────────────────────────────────

  /**
   * agent 发送心跳（I4 心跳上报）。
   * 未注册的 agent 自动注册（vendor=unknown）；progress 截断 [0,1]；
   * task 存在时 ASSIGNED→RUNNING（startedAt）+ heartbeatAt；
   * progress>=1.0 且 RUNNING → COMPLETED + complete trace。
   */
  async heartbeat(
    agentId: string,
    taskId: string | null = null,
    progress = 0.0,
    status = 'busy',
  ): Promise<void> {
    if (!agentId) {
      throw new Error('agent_id 不能为空');
    }

    // 自动注册未注册 agent（容错）
    if (!this.agents.has(agentId)) {
      this.registerAgent(agentId, [], 'unknown');
    }

    // 截断 progress 到 [0.0, 1.0]
    progress = Math.max(0.0, Math.min(1.0, progress));

    const now = this.nowFn();
    this.heartbeats.set(agentId, { agentId, taskId, timestamp: now, status, progress });

    // 若 taskId 不为 null，更新对应 task 的心跳字段
    if (taskId !== null && this.tasks.has(taskId)) {
      const task = this.tasks.get(taskId)!;
      // 首次心跳时将状态从 ASSIGNED 推进到 RUNNING
      if (task.status === SwarmTaskStatus.ASSIGNED) {
        task.status = SwarmTaskStatus.RUNNING;
        task.startedAt = now;
      }
      task.heartbeatAt = now;

      // 进度达 1.0 视为完成
      if (progress >= 1.0 && task.status === SwarmTaskStatus.RUNNING) {
        task.status = SwarmTaskStatus.COMPLETED;
        task.completedAt = now;
        if (Object.keys(task.result).length === 0) {
          task.result = { progress };
        }
        // I2: 落盘 complete trace
        this.archiveSafe(
          makeSwarmDispatchRecord({
            taskId,
            agentId,
            action: 'complete',
            reason: `progress=${progress}`,
          }),
        );
      }
    }
  }

  // ── 超时检测（I4 心跳超时回收）──────────────────────────────

  /**
   * 检查超时任务并 reassign（I4 心跳超时回收）。
   * 判定：ASSIGNED/RUNNING 且有 assignedAgentId；
   * heartbeatAt < now-timeout 或（无 heartbeatAt 且 assignedAt < now-timeout）。
   * retryCount+1；> maxRetries → FAILED（max_retries_exceeded）；否则 REASSIGNED。
   * 返回被 reassign 的 taskId 列表。
   */
  async checkTimeouts(): Promise<string[]> {
    const nowMs = Date.parse(this.nowFn());
    const timeoutMs = this.heartbeatTimeout * 1000;

    const reassignedIds: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== SwarmTaskStatus.ASSIGNED && task.status !== SwarmTaskStatus.RUNNING) {
        continue;
      }
      if (task.assignedAgentId === null) {
        continue;
      }

      // 判定超时
      let isTimeout = false;
      let timeoutReason = '';

      if (task.heartbeatAt !== null) {
        if (Date.parse(task.heartbeatAt) < nowMs - timeoutMs) {
          isTimeout = true;
          timeoutReason = `heartbeat_timeout (last=${task.heartbeatAt}, threshold=${this.heartbeatTimeout}s)`;
        }
      } else {
        // 从未心跳，检查 assignedAt
        if (task.assignedAt !== null && Date.parse(task.assignedAt) < nowMs - timeoutMs) {
          isTimeout = true;
          timeoutReason = `no_heartbeat_since_assigned (assigned=${task.assignedAt}, threshold=${this.heartbeatTimeout}s)`;
        }
      }

      if (!isTimeout) {
        continue;
      }

      const oldAgentId = task.assignedAgentId;
      task.retryCount += 1;

      // I4: 超过 maxRetries 则 FAILED
      if (task.retryCount > this.maxRetries) {
        task.status = SwarmTaskStatus.FAILED;
        task.failureReason =
          `max_retries_exceeded (${task.retryCount - 1} 次 reassign 后仍超时; ` +
          `最后原因: ${timeoutReason})`;
        task.assignedAgentId = null;
        // I2: 落盘 fail trace
        this.archiveSafe(
          makeSwarmDispatchRecord({
            taskId: task.taskId,
            agentId: oldAgentId,
            action: 'fail',
            reason: task.failureReason,
          }),
        );
      } else {
        // I4: 未超 maxRetries，reassign
        task.status = SwarmTaskStatus.REASSIGNED;
        task.assignedAgentId = null;
        task.heartbeatAt = null;
        // I2: 落盘 reassign trace
        this.archiveSafe(
          makeSwarmDispatchRecord({
            taskId: task.taskId,
            agentId: oldAgentId,
            action: 'reassign',
            reassignedFrom: oldAgentId,
            reason: timeoutReason,
          }),
        );
        reassignedIds.push(task.taskId);
      }
    }

    return reassignedIds;
  }

  // ── Agent 查找（I3+I5+I6 4 步过滤）────────────────────────

  /**
   * 根据任务需求找到最合适的 agent（I3+I5+I6）。
   * 4 步过滤：Step1 能力包含 → Step2 I5 跨厂商 → Step3 I6 no-self-review
   * → preferredAgentId 优先 → Step4 load balancing（workload 最小 + 字典序）。
   */
  findCapableAgent(task: SwarmTask): string | null {
    if (this.agents.size === 0) {
      return null;
    }

    const requiredCaps = new Set(task.requiredCapabilities);
    if (requiredCaps.size === 0) {
      return null;
    }

    // task.context 中的 author 信息（I5/I6 校验依据）
    const authorAgentId = task.context['author_agent_id'];
    const authorVendor = task.context['author_vendor'];

    // 判断是否含跨厂商要求的能力
    const needsCrossVendor = [...requiredCaps].some((c) => this.crossVendorRequired.has(c));

    // Step 1: 能力包含过滤
    let candidates: string[] = [];
    for (const [agentId, info] of this.agents) {
      const agentCaps = new Set(info.capabilities);
      if ([...requiredCaps].every((c) => agentCaps.has(c))) {
        candidates.push(agentId);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Step 2: I5 跨厂商过滤
    if (needsCrossVendor && typeof authorVendor === 'string' && authorVendor.length > 0) {
      const filtered = candidates.filter((aid) => this.agents.get(aid)!.vendor !== authorVendor);
      if (filtered.length === 0) {
        return null;
      }
      candidates = filtered;
    }

    // Step 3: I6 no-self-review 过滤
    if (typeof authorAgentId === 'string' && authorAgentId.length > 0) {
      const filtered = candidates.filter((aid) => aid !== authorAgentId);
      if (filtered.length === 0) {
        return null;
      }
      candidates = filtered;
    }

    // preferredAgentId 优先（若在候选集中）
    if (task.preferredAgentId && candidates.includes(task.preferredAgentId)) {
      return task.preferredAgentId;
    }

    // Step 4: load balancing — 选 workload 最小的（同 workload 按字典序）
    const workload = this.getAgentWorkload();
    candidates.sort((a, b) => (workload[a] ?? 0) - (workload[b] ?? 0) || a.localeCompare(b));
    return candidates[0] ?? null;
  }

  /**
   * 为 agent 找搭档补齐能力缺口。
   * 排除自身 + 能力含 missingCapability +（missing 在 crossVendorRequired 时跨厂商过滤）
   * + load balancing。
   */
  findComplementAgent(agentId: string, missingCapability: string): string | null {
    if (this.agents.size === 0 || !missingCapability) {
      return null;
    }

    // 找出能力含 missingCapability 的 agent（排除自身）
    let candidates: string[] = [];
    for (const [aid, info] of this.agents) {
      if (aid !== agentId && info.capabilities.includes(missingCapability)) {
        candidates.push(aid);
      }
    }
    if (candidates.length === 0) {
      return null;
    }

    // I5 跨厂商过滤（若 missingCapability 在 crossVendorRequired 中）
    if (this.crossVendorRequired.has(missingCapability)) {
      const authorVendor = this.agents.get(agentId)?.vendor;
      if (authorVendor) {
        const filtered = candidates.filter((aid) => this.agents.get(aid)!.vendor !== authorVendor);
        if (filtered.length === 0) {
          return null;
        }
        candidates = filtered;
      }
    }

    // load balancing
    const workload = this.getAgentWorkload();
    candidates.sort((a, b) => (workload[a] ?? 0) - (workload[b] ?? 0) || a.localeCompare(b));
    return candidates[0] ?? null;
  }

  /**
   * 为 blind_spots 任务推荐搭档字典（findCapableAgent 已返回 null 时调用）。
   * primary = preferredAgentId 或覆盖最多能力的 agent；
   * 对其未覆盖能力逐个 findComplementAgent。
   * 返回 {missing_capability: complement_agent_id}。
   */
  tryFindComplements(task: SwarmTask): Record<string, string> {
    if (this.agents.size === 0) {
      return {};
    }

    const requiredCaps = new Set(task.requiredCapabilities);
    if (requiredCaps.size === 0) {
      return {};
    }

    // 选"覆盖最多 requiredCapabilities"的 agent 作为主 agent
    // （preferredAgentId 优先，否则按覆盖度排序）
    let primaryAgent: string;
    if (task.preferredAgentId && this.agents.has(task.preferredAgentId)) {
      primaryAgent = task.preferredAgentId;
    } else {
      let bestAgent = '';
      let bestCoverage = -1;
      for (const [aid, info] of this.agents) {
        const coverage = [...requiredCaps].filter((c) => info.capabilities.includes(c)).length;
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestAgent = aid;
        }
      }
      primaryAgent = bestAgent;
    }

    if (!primaryAgent) {
      return {};
    }

    // 找出主 agent 未覆盖的能力，对每个能力找搭档
    const primaryCaps = new Set(this.agents.get(primaryAgent)!.capabilities);
    const missingCaps = [...requiredCaps].filter((c) => !primaryCaps.has(c));
    if (missingCaps.length === 0) {
      // 主 agent 已覆盖全部能力（理论不应到这里，因为 findCapableAgent 已返回 null）
      return {};
    }

    const complements: Record<string, string> = {};
    for (const missingCap of missingCaps) {
      const complement = this.findComplementAgent(primaryAgent, missingCap);
      if (complement) {
        complements[missingCap] = complement;
      }
    }

    return complements;
  }

  // ── 状态查询 ────────────────────────────────────────────────

  /** 查询任务状态（任务不存在返回 null） */
  getTaskStatus(taskId: string): SwarmTaskStatus | null {
    const task = this.tasks.get(taskId);
    return task ? task.status : null;
  }

  /** 查询任务完整对象（含 result / context 等） */
  getTask(taskId: string): SwarmTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * 获取各 agent 当前任务数（用于 load balancing）。
   * 仅统计 ASSIGNED/RUNNING 状态的任务；所有注册 agent 初始 0。
   */
  getAgentWorkload(): Record<string, number> {
    const workload: Record<string, number> = {};
    for (const aid of this.agents.keys()) {
      workload[aid] = 0;
    }
    for (const task of this.tasks.values()) {
      if (task.status === SwarmTaskStatus.ASSIGNED || task.status === SwarmTaskStatus.RUNNING) {
        if (task.assignedAgentId && task.assignedAgentId in workload) {
          workload[task.assignedAgentId] = (workload[task.assignedAgentId] ?? 0) + 1;
        }
      }
    }
    return workload;
  }

  /** 列出任务（可选按状态过滤，按 createdAt 升序） */
  listTasks(status?: SwarmTaskStatus): SwarmTask[] {
    let tasks = [...this.tasks.values()];
    if (status !== undefined) {
      tasks = tasks.filter((t) => t.status === status);
    }
    tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return tasks;
  }

  /** 列出所有已注册 agent 的画像（含 workload / 最近心跳） */
  listAgents(): SwarmAgentSummary[] {
    const workload = this.getAgentWorkload();
    const result: SwarmAgentSummary[] = [];
    for (const [agentId, info] of this.agents) {
      const heartbeat = this.heartbeats.get(agentId);
      result.push({
        agentId,
        capabilities: [...info.capabilities],
        vendor: info.vendor,
        workload: workload[agentId] ?? 0,
        lastHeartbeat: heartbeat ? heartbeat.timestamp : null,
        lastStatus: heartbeat ? heartbeat.status : 'unknown',
      });
    }
    return result;
  }

  /**
   * 取消任务（operator 通过 SteerCommand CANCEL 触发）。
   * 任务不存在或已是终态（COMPLETED/FAILED/CANCELLED）返回 false。
   */
  cancelTask(taskId: string, reason = ''): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    if (
      task.status === SwarmTaskStatus.COMPLETED ||
      task.status === SwarmTaskStatus.FAILED ||
      task.status === SwarmTaskStatus.CANCELLED
    ) {
      return false;
    }

    const oldAgentId = task.assignedAgentId;
    task.status = SwarmTaskStatus.CANCELLED;
    task.assignedAgentId = null;
    task.failureReason = reason || 'cancelled_by_operator';

    // I2: 落盘 cancel trace
    this.archiveSafe(
      makeSwarmDispatchRecord({
        taskId,
        agentId: oldAgentId ?? '',
        action: 'cancel',
        reason: task.failureReason,
      }),
    );
    return true;
  }

  /**
   * 主动标记任务失败（任务必须有终态，避免悬挂等待超时回收）。
   * 任务不存在或已是终态返回 false。
   */
  failTask(taskId: string, reason = ''): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    if (
      task.status === SwarmTaskStatus.COMPLETED ||
      task.status === SwarmTaskStatus.FAILED ||
      task.status === SwarmTaskStatus.CANCELLED
    ) {
      return false;
    }

    const oldAgentId = task.assignedAgentId;
    task.status = SwarmTaskStatus.FAILED;
    task.failureReason = reason || 'task_failed';

    // I2: 落盘 fail trace
    this.archiveSafe(
      makeSwarmDispatchRecord({
        taskId,
        agentId: oldAgentId ?? '',
        action: 'fail',
        reason: task.failureReason,
      }),
    );
    return true;
  }

  // ── 持续调度循环（永不停止）────────────────────────────────

  /**
   * 持续运行调度循环（永不停止）。
   * 每 interval 秒触发一次 dispatch + checkTimeouts；异常不退出循环；
   * interval 等于默认 5.0 时使用 config 的 dispatch_interval_seconds。
   * 通过 stop() 软停止。
   */
  async runContinuously(interval = 5.0): Promise<void> {
    const actualInterval = interval !== 5.0 ? interval : this.dispatchInterval;
    this.running = true;

    try {
      while (this.running) {
        try {
          // 1. 分发待处理任务 2. 检查超时任务
          await this.dispatch();
          await this.checkTimeouts();
        } catch {
          // 循环不退出，继续下一轮
        }
        // 等待下一轮
        await this.sleepFn(actualInterval * 1000);
      }
    } finally {
      this.running = false;
    }
  }

  /** 停止调度循环（软停止：设置 running=false，下一轮 sleep 后退出） */
  stop(): void {
    this.running = false;
  }

  // ── 归档（I2 trace 落盘）────────────────────────────────────

  /** archive 失败不阻断主流程（I2 弱保证：内存写入是强保证，归档是弱保证） */
  private archiveSafe(record: SwarmDispatchRecord): void {
    try {
      this.archiveFn(record);
    } catch {
      // 归档失败仅降级（对齐 Python logger.error 不阻断）
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// 工厂函数（I1 单一调度器 — 推荐通过 DI 注入）
// ──────────────────────────────────────────────────────────────────

let swarmCoordinatorSingleton: SwarmCoordinator | null = null;

/**
 * 创建或获取 SwarmCoordinator 单例（I1 单一调度器）。
 * config 仅首次创建时生效；forceNew 强制创建新实例（仅用于测试）。
 */
export async function createSwarmCoordinator(
  options: SwarmCoordinatorOptions = {},
  forceNew = false,
): Promise<SwarmCoordinator> {
  if (swarmCoordinatorSingleton === null || forceNew) {
    swarmCoordinatorSingleton = new SwarmCoordinator(options);
  }
  return swarmCoordinatorSingleton;
}

/** 重置单例（仅用于测试；生产环境禁止调用，会破坏 I1 单一调度器不变量） */
export function resetSwarmCoordinatorSingleton(): void {
  swarmCoordinatorSingleton = null;
}
