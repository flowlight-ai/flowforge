/**
 * F162 Phase B: Lark/Feishu Action Service — 治理边界（ADR-029）。
 *
 * 经 lark-cli 的类型化企业操作方法 + 审计日志。全部 cat 侧 Lark 动作
 * 走此处，禁止裸 CLI 调用。覆盖 docs/base/task/calendar/slides + GoldenChain。
 *
 * 移植自 clowder-ai `infrastructure/enterprise/LarkActionService.ts`。
 */

import {
  isScopeOrPermissionError,
  LarkApiError,
  type EnterpriseLogger,
  type LarkCliExecutor,
} from './lark-executor.ts';
import type {
  LarkBaseCreateResponse,
  LarkBaseHandle,
  LarkCalendarCreateResponse,
  LarkCalendarEventHandle,
  LarkContactSearchResponse,
  LarkDocHandle,
  LarkDocsCreateResponse,
  LarkGoldenChainResult,
  LarkSlideHandle,
  LarkSlidesCreateResponse,
  LarkTaskCreateResponse,
  LarkTaskHandle,
} from './lark-types.ts';

export interface CreateDocOpts {
  /** Document title */
  title: string;
  /** Markdown content (Lark-flavored). Pass plain markdown; lark-cli handles conversion. */
  markdown?: string;
  /** Optional parent folder token */
  folderToken?: string;
}

export interface CreateBaseOpts {
  /** Base (Bitable) app name */
  name: string;
  folderToken?: string;
  /** e.g. "Asia/Shanghai" */
  timeZone?: string;
}

export interface CreateTaskOpts {
  /** Task title */
  summary: string;
  description?: string;
  /** Assignee open_id（Phase B 单一 assignee；多人用 assignMany 自行循环） */
  assigneeOpenId?: string;
  /** Due date: ISO 8601, YYYY-MM-DD, +2d relative, or ms timestamp */
  due?: string;
  /** Client token for idempotency */
  idempotencyKey?: string;
}

export interface CreateCalendarEventOpts {
  summary: string;
  description?: string;
  /** ISO 8601 start time */
  start: string;
  /** ISO 8601 end time */
  end: string;
  /** Attendee IDs (ou_xxx user, oc_xxx chat, omm_xxx room), comma-joined input allowed */
  attendeeOpenIds?: string[];
  /** Calendar ID (default: primary) */
  calendarId?: string;
  /** RFC5545 recurrence rule */
  rrule?: string;
}

export interface CreateSlidesOpts {
  title: string;
  folderToken?: string;
}

export interface GoldenChainOpts {
  docTitle: string;
  docMarkdown: string;
  baseName: string;
  tasks: Array<{
    summary: string;
    assigneeOpenId: string;
    due?: string;
    description?: string;
  }>;
  calendarSummary: string;
  calendarStart: string;
  calendarEnd: string;
  calendarAttendeeOpenIds: string[];
  /** If true, also create a Slides deck and include in summary */
  includeSlides?: boolean;
}

export class LarkActionService {
  private readonly executor: LarkCliExecutor;
  private readonly log: EnterpriseLogger;

  constructor(executor: LarkCliExecutor, log: EnterpriseLogger) {
    this.executor = executor;
    this.log = log;
  }

  isAvailable(): Promise<boolean> {
    return this.executor.isAvailable();
  }

  async createDoc(opts: CreateDocOpts): Promise<LarkDocHandle> {
    this.audit('createDoc', { title: opts.title, hasMarkdown: Boolean(opts.markdown) });
    const res = await this.executor.exec<LarkDocsCreateResponse>('docs', '+create', {
      title: opts.title,
      ...(opts.markdown ? { markdown: opts.markdown } : {}),
      ...(opts.folderToken ? { 'folder-token': opts.folderToken } : {}),
    });
    const data = res.data;
    if (!data?.doc_id) {
      throw new Error(`Lark docs +create returned no doc_id: ${JSON.stringify(res)}`);
    }
    const url = data.doc_url ?? `https://feishu.cn/docx/${data.doc_id}`;
    return { documentId: data.doc_id, url, title: opts.title };
  }

  async createBase(opts: CreateBaseOpts): Promise<LarkBaseHandle> {
    this.audit('createBase', { name: opts.name });
    const res = await this.executor.exec<LarkBaseCreateResponse>('base', '+base-create', {
      name: opts.name,
      ...(opts.folderToken ? { 'folder-token': opts.folderToken } : {}),
      ...(opts.timeZone ? { 'time-zone': opts.timeZone } : {}),
    });
    const base = res.data?.base;
    if (!base?.base_token) {
      throw new Error(`Lark base +base-create returned no base_token: ${JSON.stringify(res)}`);
    }
    const url = base.url ?? `https://feishu.cn/base/${base.base_token}`;
    return { appToken: base.base_token, url, name: base.name ?? opts.name };
  }

  async createTask(opts: CreateTaskOpts): Promise<LarkTaskHandle> {
    this.audit('createTask', { summary: opts.summary });
    const res = await this.executor.exec<LarkTaskCreateResponse>('task', '+create', {
      summary: opts.summary,
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.assigneeOpenId ? { assignee: opts.assigneeOpenId } : {}),
      ...(opts.due ? { due: opts.due } : {}),
      ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
    });
    const data = res.data;
    if (!data?.guid) {
      throw new Error(`Lark task +create returned no guid: ${JSON.stringify(res)}`);
    }
    const handle: LarkTaskHandle = { guid: data.guid, summary: opts.summary };
    if (data.url) handle.url = data.url;
    return handle;
  }

  async createCalendarEvent(opts: CreateCalendarEventOpts): Promise<LarkCalendarEventHandle> {
    this.audit('createCalendarEvent', { summary: opts.summary });
    const attendeeIds = opts.attendeeOpenIds?.length ? opts.attendeeOpenIds.join(',') : undefined;
    const res = await this.executor.exec<LarkCalendarCreateResponse>('calendar', '+create', {
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
      ...(opts.description ? { description: opts.description } : {}),
      ...(attendeeIds ? { 'attendee-ids': attendeeIds } : {}),
      ...(opts.calendarId ? { 'calendar-id': opts.calendarId } : {}),
      ...(opts.rrule ? { rrule: opts.rrule } : {}),
    });
    const data = res.data;
    if (!data?.event_id) {
      throw new Error(`Lark calendar +create returned no event_id: ${JSON.stringify(res)}`);
    }
    return {
      eventId: data.event_id,
      calendarId: opts.calendarId ?? 'primary',
      summary: data.summary ?? opts.summary,
    };
  }

  async createSlides(opts: CreateSlidesOpts): Promise<LarkSlideHandle> {
    this.audit('createSlides', { title: opts.title });
    const res = await this.executor.exec<LarkSlidesCreateResponse>('slides', '+create', {
      title: opts.title,
      ...(opts.folderToken ? { 'folder-token': opts.folderToken } : {}),
    });
    const data = res.data;
    if (!data?.xml_presentation_id) {
      throw new Error(`Lark slides +create returned no xml_presentation_id: ${JSON.stringify(res)}`);
    }
    const url = data.url ?? `https://feishu.cn/slides/${data.xml_presentation_id}`;
    return { presentationId: data.xml_presentation_id, url, title: data.title ?? opts.title };
  }

  /**
   * Best-effort user lookup。仅 scope/permission 类错误降级为空数组
   * （并非所有租户都授予 contact:contact.search）；协议错误/CLI 不可用/
   * vendor 故障等真实问题上抛，不掩饰为"无匹配"。
   */
  async searchUsers(query: string): Promise<Array<{ openId: string; name: string }>> {
    this.audit('searchUsers', { query });
    try {
      const res = await this.executor.exec<LarkContactSearchResponse>('contact', '+search-user', { query });
      return (res.data?.users ?? []).map((u) => ({ openId: u.open_id, name: u.name }));
    } catch (err) {
      if (err instanceof LarkApiError && isScopeOrPermissionError(err)) {
        this.log.warn(`[LarkAction] searchUsers degraded — contact scope not granted: ${query}`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Golden Chain: 一句话 → Doc + Base + Tasks + Calendar Event（+ 可选 Slides）。
   * Feishu 招牌能力，与 WeCom F162 Phase A goldenChain 对齐但适配 Lark 原语。
   */
  async goldenChain(opts: GoldenChainOpts): Promise<LarkGoldenChainResult & { slides?: LarkSlideHandle }> {
    this.audit('goldenChain', { docTitle: opts.docTitle, taskCount: opts.tasks.length });

    const doc = await this.createDoc({ title: opts.docTitle, markdown: opts.docMarkdown });
    const base = await this.createBase({ name: opts.baseName });

    const tasks: LarkTaskHandle[] = [];
    for (const t of opts.tasks) {
      tasks.push(
        await this.createTask({
          summary: t.summary,
          assigneeOpenId: t.assigneeOpenId,
          ...(t.due ? { due: t.due } : {}),
          ...(t.description ? { description: t.description } : {}),
        }),
      );
    }

    const calendarEvent = await this.createCalendarEvent({
      summary: opts.calendarSummary,
      start: opts.calendarStart,
      end: opts.calendarEnd,
      attendeeOpenIds: opts.calendarAttendeeOpenIds,
    });

    let slides: LarkSlideHandle | undefined;
    if (opts.includeSlides) {
      try {
        slides = await this.createSlides({ title: `${opts.docTitle} — Slides` });
      } catch (err) {
        this.log.warn(`[LarkAction] Slides creation failed — continuing without: ${(err as Error).message}`);
      }
    }

    const lines = [
      `📄 文档: ${doc.title} — ${doc.url}`,
      `📊 多维表: ${base.name} — ${base.url}`,
      `✅ 任务: ${tasks.length} 条已分发`,
      `🗓 日程: ${calendarEvent.summary}`,
    ];
    if (slides) lines.push(`🎞 幻灯片: ${slides.title} — ${slides.url}`);
    const summary = lines.join('\n');

    return { doc, base, tasks, calendarEvent, summary, ...(slides ? { slides } : {}) };
  }

  private audit(method: string, params: unknown): void {
    this.log.info(`[LarkAction] audit ${method}: ${JSON.stringify(params)}`);
  }
}
