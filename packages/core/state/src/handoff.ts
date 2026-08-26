/**
 * handoff — Agent Handoff 任务交接（TS 重写自 `core/handoff.py`，F27）。
 *
 * 对齐 OpenAI Agents SDK handoff 模式：agent 可将任务委派给专业 agent。
 * 依赖通过 `AgentRegistryLike` 接口注入（Cordis 装配）。
 *
 * @module @flowforge/core-state
 */

/** 目标 agent 最小接口（执行输入返回输出）。 */
export interface HandoffAgent {
  execute(input: {
    params: Record<string, unknown>;
    state?: unknown;
  }): Promise<{ result: Record<string, unknown>; error?: string }>;
}

/** agent 注册表最小接口（get/list）。 */
export interface AgentRegistryLike {
  get(name: string): HandoffAgent | undefined;
  list(): string[];
}

/** 交接执行输出。 */
export interface HandoffOutput {
  result: Record<string, unknown>;
  error?: string;
}

/** 交接配置：从源 agent 委派到目标 agent。 */
export interface Handoff {
  /** 目标 agent 名称。 */
  target: string;
  /** 何时应使用此交接的描述。 */
  condition: string;
  /** 可选的交接目的长描述。 */
  description?: string;
  /** 任意元数据。 */
  metadata?: Record<string, unknown>;
}

/** 管理 agent 间交接路由。 */
export class HandoffManager {
  private readonly registry: AgentRegistryLike;
  private readonly handoffs = new Map<string, Handoff[]>();

  constructor(agentRegistry: AgentRegistryLike) {
    this.registry = agentRegistry;
  }

  /** 注册某源 agent 的交接配置（按 target 去重合并）。 */
  registerHandoffs(agentName: string, handoffs: Handoff[]): void {
    const existing = this.handoffs.get(agentName) ?? [];
    const existingTargets = new Set(existing.map((h) => h.target));
    for (const h of handoffs) {
      if (!existingTargets.has(h.target)) {
        existing.push(h);
        existingTargets.add(h.target);
      }
    }
    this.handoffs.set(agentName, existing);
  }

  /** 获取某源 agent 已注册的交接配置（无则空数组）。 */
  getHandoffs(agentName: string): Handoff[] {
    return [...(this.handoffs.get(agentName) ?? [])];
  }

  /**
   * 执行一次交接：校验配置与目标存在 → 构造输入 → 执行目标 agent。
   *
   * @throws 未配置交接 / 目标 agent 不存在时抛错。
   */
  async executeHandoff(
    sourceAgent: string,
    targetAgent: string,
    task: string,
    context: Record<string, unknown> = {},
  ): Promise<HandoffOutput> {
    // 校验交接已配置
    const validTargets = new Set(
      this.getHandoffs(sourceAgent).map((h) => h.target),
    );
    if (!validTargets.has(targetAgent)) {
      throw new Error(
        `No handoff configured from '${sourceAgent}' to '${targetAgent}'. ` +
          `Available targets: ${[...validTargets].sort().join(', ')}`,
      );
    }

    // 校验目标 agent 存在
    const agent = this.registry.get(targetAgent);
    if (agent === undefined) {
      throw new Error(
        `Target agent '${targetAgent}' not found in registry. ` +
          `Registered agents: ${this.registry.list().join(', ')}`,
      );
    }

    // 构造输入并执行
    const params = { task, ...context };
    try {
      return await agent.execute({
        params,
        state: context['state'],
      });
    } catch (e) {
      return {
        result: {
          error: e instanceof Error ? e.message : String(e),
          handoff_from: sourceAgent,
        },
      };
    }
  }

  /**
   * 生成告知 LLM 可用交接的提示词（注入系统提示）。
   * 无交接配置时返回空字符串。
   */
  getHandoffPrompt(agentName: string): string {
    const handoffs = this.getHandoffs(agentName);
    if (handoffs.length === 0) {
      return '';
    }
    const lines = [
      'You can delegate tasks to the following specialized agents:',
      '',
    ];
    for (const h of handoffs) {
      let line = `- ${h.target}: ${h.condition}`;
      if (h.description) {
        line += ` (${h.description})`;
      }
      lines.push(line);
    }
    lines.push(
      '',
      'To delegate a task, indicate which agent should handle it ' +
        'and provide the task description.',
    );
    return lines.join('\n');
  }
}
