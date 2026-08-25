/**
 * @flowforge/forgekin-roles — T7.28 SecurityOfficerForgekin 契约验证（F043）。
 *
 * 对齐 F043 §2.2/§2.3 + 验收标准 AC-2/AC-3/AC-4/AC-5：
 *   - observe 采集 4 类信号（AC-2）
 *   - act 5 种动作路由（AC-3）
 *   - 阻断操作必须 operator 批准（AC-4）
 *   - 扫描 / 审计 / 告警自主执行（AC-5）
 *   - 审计 append-only（AC-10）
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import type { RoleActionResult } from '../src/types.js';
import {
  BLOCKING_ACTIONS,
  SecurityOfficerForgekin,
} from '../src/security-officer.js';

/** 从动作结果提取动作特有字段（result 值域为 unknown，测试断言用）。 */
function pick(res: RoleActionResult, key: string): any {
  return res.result[key];
}

function makeSec(): SecurityOfficerForgekin {
  return new SecurityOfficerForgekin({
    forgekinId: 'forgemind:alpha',
    name: '阿尔法',
    businessSystems: ['siem', 'iam'],
  });
}

function act(s: SecurityOfficerForgekin, actionType: string, params: Record<string, unknown> = {}) {
  return s.act({ action_type: actionType, params });
}

describe('SecurityOfficerForgekin（F043 狼·阿尔法）', () => {
  it('observe 采集安全事件 / 漏洞源 / 访问日志 / 合规日历 4 类信号（AC-2）', async () => {
    const s = makeSec();
    const obs = await s.observe({
      security_signals: {
        security_events: ['evt-1'],
        vulnerability_feeds: ['CVE-2026-0001'],
        access_logs: [{ user: 'u1', action: 'login' }],
        compliance_calendar: ['SOC2-2026-Q3'],
      },
    });
    expect(obs.security_events).toEqual(['evt-1']);
    expect(obs.vulnerability_feeds).toEqual(['CVE-2026-0001']);
    expect(obs.access_logs).toHaveLength(1);
    expect(obs.compliance_calendar).toEqual(['SOC2-2026-Q3']);
  });

  it('act 路由：vulnerability_scan 支持 SAST / DAST / SCA（AC-3）', async () => {
    const s = makeSec();
    for (const scanType of ['sast', 'dast', 'sca']) {
      const res = await act(s, 'vulnerability_scan', { scan_type: scanType, targets: ['svc-a'] });
      expect(res.executed).toBe(true);
      expect(pick(res, 'scan').scan_type).toBe(scanType);
      expect(pick(res, 'tool')).toBe('SecurityScanner');
    }
  });

  it('act 路由：compliance_check / threat_model 自主执行（AC-5）', async () => {
    const s = makeSec();
    const comp = await act(s, 'compliance_check', { standard: 'gdpr' });
    expect(comp.executed).toBe(true);
    expect(pick(comp, 'compliance').standard).toBe('GDPR');

    const tm = await act(s, 'threat_model', { model: 'stride', system: 'payment' });
    expect(tm.executed).toBe(true);
    expect(pick(tm, 'threat_model').model).toBe('stride');
    expect(pick(tm, 'threat_model').system).toBe('payment');
  });

  it('act 路由：audit 写入 append-only 审计日志，条目递增（I3 / AC-10）', async () => {
    const s = makeSec();
    const first = await act(s, 'audit', { scope: 'iam' });
    expect(first.executed).toBe(true);
    expect(pick(first, 'audit').entries).toBe(1);
    expect(pick(first, 'audit').status).toBe('appended');

    const second = await act(s, 'audit', { scope: 'billing' });
    expect(pick(second, 'audit').entries).toBe(2); // append-only 递增
  });

  it('act 路由：alert 自主执行且已投递（AC-5）', async () => {
    const s = makeSec();
    const res = await act(s, 'alert', { severity: 'critical' });
    expect(res.executed).toBe(true);
    expect(pick(res, 'alert').delivered).toBe(true);
    expect(pick(res, 'alert').severity).toBe('critical');
    expect(pick(res, 'tool')).toBe('SecurityPolicyEngine');
  });

  it('I1：阻断操作必须 operator 批准（blocking=true 或内置阻断类型，AC-4）', async () => {
    const s = makeSec();
    // 显式阻断标记
    const flagged = await act(s, 'alert', { severity: 'high', blocking: true });
    expect(flagged.executed).toBe(false);
    expect(flagged.decisionRecord).toBe('pending_operator_review');

    // 内置阻断动作类型（stop_service / disable_account / revoke_permission）
    expect(BLOCKING_ACTIONS).toEqual(['stop_service', 'disable_account', 'revoke_permission']);
    for (const blocking of BLOCKING_ACTIONS) {
      const res = await act(s, blocking, { target: 'svc-a' });
      expect(res.executed).toBe(false);
      expect(res.decisionRecord).toBe('pending_operator_review');
      expect(pick(res, 'reason')).toBe('blocking_action_requires_operator_approval');
    }
  });

  it('verify：alert 未投递为 false；已投递为 true', async () => {
    const s = makeSec();
    const delivered = await act(s, 'alert', { severity: 'info' });
    expect(await s.verify(delivered)).toBe(true);

    const notDelivered = {
      ...delivered,
      result: { alert: { delivered: false } },
    };
    expect(await s.verify(notDelivered)).toBe(false);
  });

  it('能力画像缺省含盲点 / 工具集（F043 §2.1）', () => {
    const s = makeSec();
    const profile = s.capabilityProfile as Record<string, unknown>;
    expect(profile.blind_spots).toContain('告警疲劳');
    expect(profile.tools).toContain('ThreatModeler');
    expect(profile.max_awakening_stage).toBe('E3'); // 觉醒阶 E3 上限
  });

  it('未知 action.type 抛 RangeError', async () => {
    const s = makeSec();
    await expect(act(s, 'hack_the_planet')).rejects.toThrow(RangeError);
  });
});
