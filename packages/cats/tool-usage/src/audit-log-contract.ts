/**
 * Minimal audit-log contract for the skill-consumption receipt service.
 *
 * Ported in place of clowder's `orchestration/EventAuditLog` so the tool-usage
 * package stays self-contained. Consumers inject an implementation that appends
 * audit events; the in-memory implementation below doubles as the contract test
 * seam.
 */

export enum AuditEventTypes {
  SKILL_CONSUMPTION_RECEIPT = 'skill_consumption_receipt',
}

export interface AuditEvent {
  id: string
  type: string
  threadId?: string
  timestamp: number
  data: Record<string, unknown>
}

export interface AuditEventInput {
  type: AuditEventTypes
  threadId: string
  data: Record<string, unknown>
}

export interface EventAuditLog {
  append(input: AuditEventInput): Promise<AuditEvent>
}

/** In-memory audit log for tests. */
export class InMemoryAuditLog implements EventAuditLog {
  readonly events: AuditEvent[] = []

  async append(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: `audit-${this.events.length + 1}`,
      type: input.type,
      threadId: input.threadId,
      timestamp: Date.now(),
      data: input.data,
    }
    this.events.push(event)
    return event
  }
}