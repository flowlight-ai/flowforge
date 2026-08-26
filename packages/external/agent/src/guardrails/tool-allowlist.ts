/**
 * @flowforge/external-agent guardrails/tool-allowlist — L3 工具白名单（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/tool_allowlist.py：
 *   - ToolAllowlistConfig: default_allowed 11 个 / default_forbidden 16 个 /
 *     per_provider
 *   - AllowlistResult: allowed / tool / reason
 *   - ToolAllowlistGuardrail.check(provider_name, tool, declared_permissions?)：
 *     ① forbidden 直接拒 ② per_provider ∪ default_allowed
 *     ③ declared_permissions 取交集（最小权限原则）
 *   - loadFromYaml / getAllowedTools
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** 工具白名单配置（tool_allowlist.py ToolAllowlistConfig）。 */
export interface ToolAllowlistConfig {
  /** 默认允许的工具（所有 Provider 共享）。 */
  readonly default_allowed: readonly string[];
  /** 默认禁止的工具（即使 Provider 声明需要也拒绝）。 */
  readonly default_forbidden: readonly string[];
  /** 按 Provider 定制的白名单（key=provider_name, value=允许列表）。 */
  readonly per_provider: Readonly<Record<string, readonly string[]>>;
}

/** 默认工具白名单配置。 */
export const DEFAULT_TOOL_ALLOWLIST_CONFIG: ToolAllowlistConfig = {
  default_allowed: [
    'file_read',
    'file_write',
    'file_list',
    'git_status',
    'git_diff',
    'run_tests',
    'lint',
  ],
  default_forbidden: [
    'git_push',
    'git_force_push',
    'rm',
    'rmdir',
    'sudo',
    'database_write',
    'network_request_unauthorized',
  ],
  per_provider: {},
};

/** 白名单校验结果（tool_allowlist.py AllowlistResult）。 */
export interface AllowlistResult {
  /** 是否允许调用。 */
  readonly allowed: boolean;
  /** 请求调用的工具。 */
  readonly tool: string;
  /** 拒绝原因（allowed=false 时）。 */
  readonly reason: string;
}

/** L3 工具白名单 Guardrail（tool_allowlist.py ToolAllowlistGuardrail）。 */
export class ToolAllowlistGuardrail {
  private _config: ToolAllowlistConfig;

  constructor(config?: Partial<ToolAllowlistConfig>) {
    this._config = {
      ...DEFAULT_TOOL_ALLOWLIST_CONFIG,
      ...config,
      per_provider: config?.per_provider ?? {},
    };
  }

  /**
   * 检查工具是否允许调用（tool_allowlist.py check）：
   *   ① default_forbidden 直接拒
   *   ② per_provider ∪ default_allowed 求允许集
   *   ③ declared_permissions 取交集（最小权限原则）
   */
  check(
    providerName: string,
    tool: string,
    declaredPermissions?: readonly string[],
  ): AllowlistResult {
    // 1. 检查是否在禁止列表
    if (this._config.default_forbidden.includes(tool)) {
      return {
        allowed: false,
        tool,
        reason: `tool in default_forbidden: ${tool}`,
      };
    }

    // 2. 获取该 Provider 的允许列表（per-provider 优先）
    const perProviderAllowed = this._config.per_provider[providerName] ?? [];
    const allowedSet = new Set([
      ...this._config.default_allowed,
      ...perProviderAllowed,
    ]);

    // 3. 与 Provider 声明权限取交集（最小权限原则）
    if (declaredPermissions !== undefined) {
      const declaredSet = new Set(declaredPermissions);
      if (!declaredSet.has(tool)) {
        return {
          allowed: false,
          tool,
          reason:
            `tool '${tool}' not in provider declared_permissions: ` +
            `[${declaredPermissions.join(', ')}]`,
        };
      }
    }

    // 4. 检查是否在允许列表
    if (!allowedSet.has(tool)) {
      return {
        allowed: false,
        tool,
        reason:
          `tool '${tool}' not in allowlist ` +
          `(default + per_provider[${providerName}])`,
      };
    }

    return { allowed: true, tool, reason: '' };
  }

  /** 从 YAML 加载白名单配置（铁律 5 配置驱动）。 */
  loadFromYaml(yamlPath: string): void {
    const text = readFileSync(yamlPath, 'utf-8');
    const data = parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error(`Invalid tool allowlist yaml: ${yamlPath}`);
    }
    const raw = data as Record<string, unknown>;
    this._config = {
      default_allowed: asStrArray(raw.default_allowed),
      default_forbidden: asStrArray(raw.default_forbidden),
      per_provider: toRecordOfArrays(raw.per_provider),
    };
  }

  /** 获取某 Provider 的允许工具列表（用于运行时查询）。 */
  getAllowedTools(providerName: string): string[] {
    const perProvider = this._config.per_provider[providerName] ?? [];
    return [...new Set([...this._config.default_allowed, ...perProvider])];
  }

  /** 当前配置。 */
  get config(): ToolAllowlistConfig {
    return {
      ...this._config,
      per_provider: { ...this._config.per_provider },
    };
  }
}

function asStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toRecordOfArrays(
  value: unknown,
): Record<string, readonly string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asStrArray(items);
  }
  return result;
}
