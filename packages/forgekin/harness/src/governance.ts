/**
 * governance — Harness 第 4 层：约束现实（F010 governance-boundary，压缩免疫）。
 *
 * 移植 `harness/governance.py`（TS 重写）：
 * 治理规则不能通过 user message prepend 注入（会被上下文压缩吞掉），
 * 必须通过 system role 注入（roleagent.md §3.3 压缩免疫层）。
 * 解决开放环境失败模式 4（治理失败：agent 绕过规则 / 压缩吞掉规则）。
 *
 * 关键不变量：
 *   1. 治理规则默认注入 SYSTEM_ROLE（压缩免疫）
 *   2. priority >= critical_priority_threshold 的规则永不可降级到 USER_MESSAGE
 *   3. 请求 USER_MESSAGE 注入 critical 规则会被拒绝并自动改为 SYSTEM_ROLE
 *
 * @module @flowforge/forgekin-harness
 */

/** 治理规则注入点 —— Built-to-Persist（SYSTEM_ROLE 压缩免疫 / USER_MESSAGE 可被吞掉）。 */
export enum InjectionPoint {
  /** 压缩免疫：治理规则必须走此路径。 */
  SYSTEM_ROLE = 'SYSTEM_ROLE',
  /** 会被上下文压缩吞掉，仅用于非关键临时提示。 */
  USER_MESSAGE = 'USER_MESSAGE',
}

/** 治理规则 —— Built-to-Persist（不可逆操作护栏）。 */
export interface GovernanceRule {
  /** 规则唯一 ID（如 GOV-001）。 */
  readonly rule_id: string;
  /** 规则内容（人类可读）。 */
  readonly content: string;
  /** 优先级（0-100，越高越关键；critical_threshold 以上不可降级）。 */
  readonly priority: number;
  /** 注入点（默认 SYSTEM_ROLE，压缩免疫）。 */
  readonly injection_point: InjectionPoint;
  /** 创建时间 ISO 8601。 */
  readonly created_at: string;
  /** 是否启用（禁用的规则不注入）。 */
  readonly enabled: boolean;
}

/** 治理规则注入器 —— Built-to-Persist（压缩免疫层）。 */
export class GovernanceInjector {
  /** 已注册的治理规则（rule_id → GovernanceRule）。 */
  readonly rules = new Map<string, GovernanceRule>();
  /** 关键规则优先级阈值（默认 90）。 */
  readonly criticalPriorityThreshold: number;
  /** SYSTEM_ROLE 注入模板。 */
  readonly systemRoleTemplate: string;
  /** USER_MESSAGE 注入模板。 */
  readonly userMessageTemplate: string;

  constructor(options: {
    criticalPriorityThreshold?: number | undefined;
    systemRoleTemplate?: string | undefined;
    userMessageTemplate?: string | undefined;
  } = {}) {
    this.criticalPriorityThreshold = options.criticalPriorityThreshold ?? 90;
    this.systemRoleTemplate =
      options.systemRoleTemplate ??
      '[GOVERNANCE RULE #{rule_id}] (priority={priority})\n{content}\n[/GOVERNANCE RULE #{rule_id}]';
    this.userMessageTemplate = options.userMessageTemplate ?? '[提示] {content}';
  }

  /** 注册治理规则。 */
  registerRule(rule: GovernanceRule): void {
    this.rules.set(rule.rule_id, rule);
  }

  /** 强制注入点策略：critical 规则永不可降级到 USER_MESSAGE。 */
  private enforceInjectionPoint(rule: GovernanceRule): InjectionPoint {
    if (
      rule.priority >= this.criticalPriorityThreshold &&
      rule.injection_point === InjectionPoint.USER_MESSAGE
    ) {
      return InjectionPoint.SYSTEM_ROLE;
    }
    return rule.injection_point;
  }

  /**
   * 注入治理规则到 SYSTEM_ROLE（压缩免疫）——注入主路径。
   * 无论规则配置为何种 injection_point，此方法都会注入到 SYSTEM_ROLE。
   */
  async injectToSystemRole(
    rule?: GovernanceRule | undefined,
    ruleId?: string | undefined,
  ): Promise<string> {
    const target = this.resolveRule(rule, ruleId);
    return this.systemRoleTemplate
      .replaceAll('{rule_id}', target.rule_id)
      .replaceAll('{priority}', String(target.priority))
      .replaceAll('{content}', target.content);
  }

  /**
   * 注入治理规则到 USER_MESSAGE（可被压缩吞掉）。
   * critical 规则不允许走此路径，会被强制改为 SYSTEM_ROLE。
   */
  async injectToUserMessage(
    rule?: GovernanceRule | undefined,
    ruleId?: string | undefined,
  ): Promise<string> {
    const target = this.resolveRule(rule, ruleId);
    const actualPoint = this.enforceInjectionPoint(target);
    if (actualPoint === InjectionPoint.SYSTEM_ROLE) {
      // critical 规则被强制改为 SYSTEM_ROLE
      return this.injectToSystemRole(target);
    }
    return this.userMessageTemplate
      .replaceAll('{rule_id}', target.rule_id)
      .replaceAll('{priority}', String(target.priority))
      .replaceAll('{content}', target.content);
  }

  /** 批量注入治理规则到 SYSTEM_ROLE（按优先级降序拼接）。 */
  async injectToSystemRoleBatch(ruleIds?: readonly string[] | undefined): Promise<string> {
    let rules: GovernanceRule[];
    if (ruleIds === undefined) {
      rules = [...this.rules.values()].filter((r) => r.enabled);
    } else {
      rules = ruleIds
        .map((rid) => this.rules.get(rid))
        .filter((r): r is GovernanceRule => r !== undefined && r.enabled);
    }
    rules.sort((a, b) => b.priority - a.priority);
    const parts: string[] = [];
    for (const r of rules) {
      parts.push(await this.injectToSystemRole(r));
    }
    return parts.join('\n\n');
  }

  /** 解析规则参数（rule 与 rule_id 二选一）。 */
  private resolveRule(
    rule: GovernanceRule | undefined,
    ruleId: string | undefined,
  ): GovernanceRule {
    if (rule !== undefined) {
      return rule;
    }
    if (ruleId === undefined) {
      throw new Error("either 'rule' or 'ruleId' must be provided");
    }
    const registered = this.rules.get(ruleId);
    if (registered === undefined) {
      throw new Error(`governance rule '${ruleId}' not registered`);
    }
    return registered;
  }
}

/** 内置默认治理规则集（对齐 harness.yaml governance.load_default_rules）。 */
export const DEFAULT_GOVERNANCE_RULES: readonly GovernanceRule[] = [
  {
    rule_id: 'GOV-001',
    content: '所有工具调用必须经过 ToolMediator 中介；未授权工具一律拒绝。',
    priority: 95,
    injection_point: InjectionPoint.SYSTEM_ROLE,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  },
  {
    rule_id: 'GOV-002',
    content: '声称完成任务时必须附上可验证证据（commit/test/trace/screenshot/log）。',
    priority: 90,
    injection_point: InjectionPoint.SYSTEM_ROLE,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  },
  {
    rule_id: 'GOV-003',
    content: '危险操作（safety_level=dangerous 或不可逆操作）必须显式确认后执行。',
    priority: 85,
    injection_point: InjectionPoint.SYSTEM_ROLE,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  },
  {
    rule_id: 'GOV-004',
    content: '状态读写必须通过 DurableStateSurface，禁止绕过持久层直接修改现实。',
    priority: 80,
    injection_point: InjectionPoint.SYSTEM_ROLE,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  },
  {
    rule_id: 'GOV-005',
    content: '遇到魔法词（!HALT / !PAUSE 等）必须立即执行对应动作并停止当前循环。',
    priority: 75,
    injection_point: InjectionPoint.SYSTEM_ROLE,
    created_at: '2025-01-01T00:00:00.000Z',
    enabled: true,
  },
];
