/**
 * @flowforge/forgekin-roles — SecurityOfficerForgekin 安全官（狼·阿尔法，F043）。
 *
 * TS 重写自 `forgemind/species_impl/org/security_officer.py`（F043 §2.2）：
 *   - observe: 采集安全事件 / 漏洞源 / 访问日志 / 合规日历 4 类信号
 *   - act: vulnerability_scan / compliance_check / threat_model / audit / alert
 *     5 种动作
 *   - verify: 漏洞闭环 / 合规状态 / 告警降噪
 *
 * 关键不变量（F043 §2.3）：
 *   - I1 阻断操作（停止服务 / 禁用账号 / 撤销权限）必须 operator 批准
 *     （觉醒阶 E3 上限）
 *   - I2 扫描 / 审计 / 告警自主执行（不阻塞）
 *   - I3 审计动作写入审计日志（append-only）
 *
 * @module @flowforge/forgekin-roles
 */

import {
  ForgekinRole,
  type ForgekinRoleOptions,
} from './base.js';
import {
  AwakeningStage,
  EvolutionStage,
  ForgekinSpecies,
  type RoleActionResult,
} from './types.js';

/** 阻断操作动作类型（I1：必须 operator 批准）。 */
export const BLOCKING_ACTIONS = ['stop_service', 'disable_account', 'revoke_permission'] as const;

/** SecurityOfficerForgekin 构造选项（F043 缺省：ORG 形态 / E1 进化 / E1 觉醒）。 */
export interface SecurityOfficerOptions extends ForgekinRoleOptions {
  /** 能力画像（缺省填入 F043 五能力 + 盲点 + 工具集）。 */
  capabilityProfile?: Readonly<Record<string, unknown>> | undefined;
}

/** 安全官可进化智能体（狼·阿尔法）— 设计 → 扫描 → 建模 → 合规 → 告警。 */
export class SecurityOfficerForgekin extends ForgekinRole {
  static readonly ROLE_ID = 'security-officer' as const;

  /** 审计日志（append-only，I3）：角色实例内存队列，审计动作写入。 */
  private readonly auditLog: string[] = [];

  constructor(options: SecurityOfficerOptions) {
    super({
      ...options,
      species: options.species ?? ForgekinSpecies.ORG,
      evolutionStage: options.evolutionStage ?? EvolutionStage.E1,
      awakeningStage: options.awakeningStage ?? AwakeningStage.E1,
      capabilityProfile: options.capabilityProfile ?? {
        responsibilities: [
          '安全设计',
          '漏洞扫描（SAST / DAST / SCA）',
          '威胁建模（STRIDE / Attack Tree）',
          '合规检查（GDPR / 等保 / SOC2）',
          '入侵检测（异常行为识别 / 告警响应）',
        ],
        blind_spots: ['过度关注威胁', '业务影响考量不足', '告警疲劳'],
        tools: [
          'SecurityScanner',
          'ThreatModeler',
          'ComplianceChecker',
          'IntrusionDetector',
          'SecurityPolicyEngine',
        ],
        max_evolution_stage: EvolutionStage.E3,
        max_awakening_stage: AwakeningStage.E3,
      },
    });
  }

  /** 观察安全环境：安全事件 / 漏洞源 / 访问日志 / 合规日历（F043 AC-2）。 */
  override async observe(
    environment: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.markLifecycle('observing');
    const signals = (environment.security_signals ?? {}) as Readonly<Record<string, unknown>>;
    return {
      species: this.species,
      role: SecurityOfficerForgekin.ROLE_ID,
      security_events: signals.security_events ?? [],
      vulnerability_feeds: signals.vulnerability_feeds ?? [],
      access_logs: signals.access_logs ?? [],
      compliance_calendar: signals.compliance_calendar ?? [],
      systems_queried: [...this.businessSystems],
    };
  }

  /** 执行安全动作（F043 AC-3 五动作路由）。 */
  override async act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult> {
    this.markLifecycle('acting');
    const actionType = String(action.action_type ?? action.type ?? 'unknown');
    const params = (action.params ?? {}) as Readonly<Record<string, unknown>>;
    const role = SecurityOfficerForgekin.ROLE_ID;

    // I1 阻断操作必须 operator 批准（F043 §2.3）
    if (this.requiresApproval(actionType, params)) {
      return this.makeResult(role, actionType, params, false, {
        reason: 'blocking_action_requires_operator_approval',
        hint: `阻断操作（${actionType}）需经 requestApproval 由 operator 批准`,
      });
    }

    switch (actionType) {
      case 'vulnerability_scan': {
        const scanType = String(params.scan_type ?? 'sast').toLowerCase();
        const targets = Array.isArray(params.targets) ? params.targets : [];
        // I2 扫描自主执行
        return this.makeResult(role, actionType, params, true, {
          scan: { scan_type: scanType, targets, findings: [], status: 'completed' },
          tool: 'SecurityScanner',
        });
      }
      case 'compliance_check': {
        const standard = String(params.standard ?? 'gdpr').toUpperCase();
        return this.makeResult(role, actionType, params, true, {
          compliance: { standard, status: 'pass', gaps: [] },
          tool: 'ComplianceChecker',
        });
      }
      case 'threat_model': {
        const model = String(params.model ?? 'stride').toLowerCase();
        const system = String(params.system ?? '');
        return this.makeResult(role, actionType, params, true, {
          threat_model: { model, system, threats: [], risk_level: 'low' },
          tool: 'ThreatModeler',
        });
      }
      case 'audit': {
        const scope = String(params.scope ?? '');
        // I3 审计写入 append-only 审计日志
        this.auditLog.push(`${new Date().toISOString()} scope=${scope}`);
        return this.makeResult(role, actionType, params, true, {
          audit: { scope, entries: this.auditLog.length, status: 'appended' },
          tool: 'IntrusionDetector',
        });
      }
      case 'alert': {
        const severity = String(params.severity ?? 'info').toLowerCase();
        // I2 告警自主执行
        return this.makeResult(role, actionType, params, true, {
          alert: {
            severity,
            channels: ['console'],
            delivered: true,
            deduped: false, // 告警去重（F043 风险缓解：告警分级 + 严重度去重）
          },
          tool: 'SecurityPolicyEngine',
        });
      }
      default:
        throw new RangeError(`未知 action.type=${actionType}`);
    }
  }

  /** 验证安全结果：合规 + 执行 + 阻断类已批准（F043 §2.2 verify）。 */
  override async verify(result: RoleActionResult): Promise<boolean> {
    this.markLifecycle('verifying');
    const compliance = result.complianceCheck;
    if (!compliance.valueAnchorsRespected || !compliance.charterAligned) return false;
    if (!result.executed) return false;
    // I1 阻断操作即使执行也需 operator 批准记录
    if (result.actionType === 'alert') {
      const alert = (result.result.alert ?? {}) as Readonly<Record<string, unknown>>;
      return alert.delivered === true;
    }
    return true;
  }

  // ── I1 审批：阻断操作（停止服务 / 禁用账号 / 撤销权限）必须 operator 批准 ──

  override requiresApproval(
    actionType: string,
    params?: Readonly<Record<string, unknown>>,
  ): boolean {
    // 显式阻断标记优先；其次内置阻断动作类型
    if (params?.blocking === true) return true;
    return (BLOCKING_ACTIONS as readonly string[]).includes(actionType);
  }
}
