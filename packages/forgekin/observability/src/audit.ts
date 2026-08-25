/**
 * @flowforge/forgekin-observability — T7.12 审计日志：AuditLogger。
 *
 * TS 重写自 `core/observability.py` AuditLogger：
 *   - log：追加 JSONL 审计事件（timestamp/event_type/trace_id/details）
 *   - log_gate_decision / log_human_intervention / log_cascade_event：三个领域便捷方法
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** 审计事件记录（JSONL 一行一条）。 */
export interface AuditEntry {
  timestamp: number;
  event_type: string;
  trace_id: string | null;
  details: Record<string, unknown>;
}

/**
 * 审计日志记录器 — 追加写入 JSONL 文件。
 *
 * @param logPath 日志文件路径（缺省 logs/audit.jsonl，父目录自动创建）。
 */
export class AuditLogger {
  constructor(private readonly logPath: string = 'logs/audit.jsonl') {}

  /**
   * 记录审计事件。
   *
   * @param event_type 事件类型（如 gate_decision / human_intervention）。
   * @param details 事件详情。
   * @param trace_id 可选链路 id。
   */
  async log(
    event_type: string,
    details: Record<string, unknown>,
    trace_id: string | null = null,
  ): Promise<void> {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      event_type,
      trace_id,
      details,
    };
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** 记录门禁决策。 */
  async log_gate_decision(
    gate_id: string,
    verdict: string,
    scores: Record<string, unknown>,
    trace_id: string | null = null,
  ): Promise<void> {
    await this.log('gate_decision', { gate_id, verdict, scores }, trace_id);
  }

  /** 记录人工干预。 */
  async log_human_intervention(
    gate_id: string,
    action: string,
    operator: string,
    trace_id: string | null = null,
  ): Promise<void> {
    await this.log('human_intervention', { gate_id, action, operator }, trace_id);
  }

  /** 记录级联事件。 */
  async log_cascade_event(
    from_model: string,
    to_model: string,
    reason: string,
    trace_id: string | null = null,
  ): Promise<void> {
    await this.log('cascade_event', { from_model, to_model, reason }, trace_id);
  }
}
