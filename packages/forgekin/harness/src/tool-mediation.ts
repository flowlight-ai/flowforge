/**
 * tool-mediation — Harness 第 2 层：改变现实。
 *
 * 移植 `harness/tool_mediation.py`（TS 重写）：
 * agent 不直接调用工具，而是通过 ToolMediator 中介——
 * 白名单校验、危险等级评估、副作用记录、别名兜底。
 * 解决开放环境失败模式 2（行动失败：agent 调用工具但实际没改变现实）。
 *
 * - SafetyLevel：只读 / 常规 / 危险 三级
 * - ToolDescriptor：工具元信息（安全等级 + 副作用 + 可逆性）
 * - ToolMediator：白名单 + 别名兜底（Build-to-Delete）+ 审计 trail
 *
 * # Built-to-Persist: 不可逆操作护栏是复利型基础设施
 * # Build-to-Delete: 别名兜底逻辑应随模型能力提升退役
 *
 * @module @flowforge/forgekin-harness
 */

import { randomUUID } from 'node:crypto';

/** 工具安全等级。 */
export enum SafetyLevel {
  /** 只读操作，无副作用。 */
  READONLY = 'readonly',
  /** 有副作用但可逆。 */
  NORMAL = 'normal',
  /** 不可逆或高风险操作（如 shell_exec / db_drop）。 */
  DANGEROUS = 'dangerous',
}

/** 工具中介结果状态。 */
export enum MediationOutcome {
  /** 直接放行。 */
  ALLOWED = 'allowed',
  /** 别名兜底放行（Build to Delete）。 */
  ALIAS_FALLBACK = 'alias_fallback',
  /** 未在白名单。 */
  REJECTED_NOT_AUTHORIZED = 'rejected_not_authorized',
  /** 危险工具未确认。 */
  REJECTED_DANGEROUS = 'rejected_dangerous',
  /** 不可逆操作未授权。 */
  REJECTED_NOT_REVERSIBLE = 'rejected_not_reversible',
}

/** 工具描述符 —— Built-to-Persist（ToolMediator 基于这些字段做中介决策）。 */
export interface ToolDescriptor {
  /** 工具唯一名称（如 file_read / shell_exec）。 */
  readonly tool_name: string;
  /** 安全等级（默认 normal）。 */
  readonly safety_level?: SafetyLevel | undefined;
  /** 副作用列表（如 ["filesystem", "network"]）。 */
  readonly side_effects?: readonly string[] | undefined;
  /** 是否可逆（不可逆操作需更高级别授权，默认 true）。 */
  readonly reversible?: boolean | undefined;
  /** 工具描述（人类可读）。 */
  readonly description?: string | undefined;
}

/** 工具中介结果 —— Built-to-Persist（审计 trail 记录）。 */
export interface MediationResult {
  /** 中介记录唯一 ID（`med-` + uuid4 前 12 位）。 */
  readonly mediation_id: string;
  /** agent 请求调用的工具名。 */
  readonly requested_tool: string;
  /** 实际放行的工具名（别名兜底后）。 */
  readonly canonical_tool: string | undefined;
  /** 调用参数（脱敏后）。 */
  readonly args: Readonly<Record<string, unknown>>;
  /** 中介结果状态。 */
  readonly outcome: MediationOutcome;
  /** 关联的工具描述符（若存在）。 */
  readonly descriptor: ToolDescriptor | undefined;
  /** 决策原因（人类可读）。 */
  readonly reason: string;
  /** 中介时间 ISO 8601。 */
  readonly timestamp: string;
}

/** 工具中介器 —— Built-to-Persist（不可逆操作护栏）。 */
export class ToolMediator {
  readonly dangerousRequiresConfirm: boolean;

  /** 工具白名单（tool_name → ToolDescriptor）。 */
  readonly whitelist = new Map<string, ToolDescriptor>();
  /** 工具别名映射（alias → canonical tool_name，Build to Delete）。 */
  readonly aliases = new Map<string, string>();
  /** 中介审计记录列表。 */
  readonly auditTrail: MediationResult[] = [];

  constructor(options: {
    whitelist?: readonly ToolDescriptor[] | undefined;
    aliases?: Readonly<Record<string, string>> | undefined;
    dangerousRequiresConfirm?: boolean | undefined;
  } = {}) {
    this.dangerousRequiresConfirm = options.dangerousRequiresConfirm ?? true;
    for (const desc of options.whitelist ?? []) {
      this.registerTool(desc);
    }
    for (const [alias, canonical] of Object.entries(options.aliases ?? {})) {
      this.registerAlias(alias, canonical);
    }
  }

  /** 注册工具到白名单。 */
  registerTool(descriptor: ToolDescriptor): void {
    this.whitelist.set(descriptor.tool_name, {
      tool_name: descriptor.tool_name,
      safety_level: descriptor.safety_level ?? SafetyLevel.NORMAL,
      side_effects: [...(descriptor.side_effects ?? [])],
      reversible: descriptor.reversible ?? true,
      description: descriptor.description ?? '',
    });
  }

  /** 注册工具别名（Build to Delete 路径）。 */
  registerAlias(alias: string, canonical: string): void {
    this.aliases.set(alias, canonical);
  }

  /** 解析别名到标准工具名；无匹配时返回 undefined。 */
  private resolveAlias(requested: string): string | undefined {
    return this.aliases.get(requested);
  }

  /** 中介一次工具调用（白名单 → 别名兜底 → 拒绝）。 */
  async mediate(
    toolName: string,
    args?: Readonly<Record<string, unknown>> | undefined,
    confirmedDangerous = false,
  ): Promise<MediationResult> {
    const sanitizedArgs = ToolMediator.sanitizeArgs(args ?? {});

    // 1. 白名单直接命中
    let descriptor = this.whitelist.get(toolName);
    let canonical = toolName;
    let usedAlias = false;

    // 2. 别名兜底（Build to Delete 路径）
    if (!descriptor) {
      const aliasTarget = this.resolveAlias(toolName);
      if (aliasTarget !== undefined) {
        descriptor = this.whitelist.get(aliasTarget);
        canonical = aliasTarget;
        usedAlias = true;
      }
    }

    // 3. 都未命中 → 拒绝
    if (!descriptor) {
      return this.record({
        requested_tool: toolName,
        canonical_tool: undefined,
        args: sanitizedArgs,
        outcome: MediationOutcome.REJECTED_NOT_AUTHORIZED,
        descriptor: undefined,
        reason: `tool '${toolName}' not in whitelist and no alias available; rejected by ToolMediator`,
      });
    }

    // 评估安全等级
    let outcome = MediationOutcome.ALLOWED;
    let reason = 'tool authorized; safety level acceptable';

    if (descriptor.safety_level === SafetyLevel.DANGEROUS) {
      if (this.dangerousRequiresConfirm && !confirmedDangerous) {
        outcome = MediationOutcome.REJECTED_DANGEROUS;
        reason =
          `tool '${canonical}' is dangerous ` +
          `(safety_level=${descriptor.safety_level}, ` +
          `side_effects=${JSON.stringify(descriptor.side_effects)}); ` +
          `requires confirmedDangerous=true`;
      }
    } else if (!descriptor.reversible && !confirmedDangerous) {
      outcome = MediationOutcome.REJECTED_NOT_REVERSIBLE;
      reason =
        `tool '${canonical}' is not reversible; ` +
        `requires confirmedDangerous=true`;
    }

    if (usedAlias && outcome === MediationOutcome.ALLOWED) {
      // 别名兜底放行，标记为 alias_fallback（Build to Delete 标记）
      outcome = MediationOutcome.ALIAS_FALLBACK;
      reason =
        `tool '${toolName}' resolved via alias to '${canonical}'; ` +
        `alias fallback path is Build-to-Delete`;
    }

    return this.record({
      requested_tool: toolName,
      canonical_tool: canonical,
      args: sanitizedArgs,
      outcome,
      descriptor,
      reason,
    });
  }

  private record(result: Omit<MediationResult, 'mediation_id' | 'timestamp'>): MediationResult {
    const full: MediationResult = {
      ...result,
      mediation_id: `med-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditTrail.push(full);
    return full;
  }

  /** 脱敏调用参数（截断超长值，避免审计 trail 膨胀）。 */
  static sanitizeArgs(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length > 200) {
        sanitized[k] = `${v.slice(0, 200)}...(truncated)`;
      } else if (typeof v === 'object' && v !== null) {
        const s = JSON.stringify(v);
        if (s.length > 200) {
          sanitized[k] = `${s.slice(0, 200)}...(truncated)`;
        } else {
          sanitized[k] = v;
        }
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /** 获取审计 trail（可按工具名过滤）。 */
  getAuditTrail(toolName?: string | undefined): MediationResult[] {
    if (toolName === undefined) {
      return [...this.auditTrail];
    }
    return this.auditTrail.filter(
      (r) => r.requested_tool === toolName || r.canonical_tool === toolName,
    );
  }
}

/** 内置工具白名单（对齐 harness.yaml tool_whitelist 5 工具）。 */
export const DEFAULT_TOOL_WHITELIST: readonly ToolDescriptor[] = [
  { tool_name: 'file_read', safety_level: SafetyLevel.READONLY, side_effects: [], reversible: true },
  {
    tool_name: 'file_write',
    safety_level: SafetyLevel.NORMAL,
    side_effects: ['filesystem'],
    reversible: true,
  },
  {
    tool_name: 'shell_exec',
    safety_level: SafetyLevel.DANGEROUS,
    side_effects: ['filesystem', 'network', 'process'],
    reversible: false,
  },
  {
    tool_name: 'git_commit',
    safety_level: SafetyLevel.NORMAL,
    side_effects: ['git_history'],
    reversible: false,
  },
  { tool_name: 'web_search', safety_level: SafetyLevel.READONLY, side_effects: ['network'], reversible: true },
];

/** 内置工具别名（对齐 harness.yaml tool_aliases，Build to Delete）。 */
export const DEFAULT_TOOL_ALIASES: Readonly<Record<string, string>> = {
  read: 'file_read',
  write: 'file_write',
  exec: 'shell_exec',
  search: 'web_search',
  commit: 'git_commit',
};
