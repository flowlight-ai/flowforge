/**
 * F162 Phase B: Lark/Feishu CLI 类型定义。
 *
 * lark-cli 为 Go CLI（@larksuite/cli），输出 raw JSON。
 * 信封：success { ok: true, identity, data } / failure { ok: false, identity, error }。
 * CLI 恒 exit 0，成功与否仅由信封 ok 字段区分；data 下为扁平字段
 * （doc_id/doc_url），与 Lark Open API 嵌套形状不同——对齐 CLI 实际输出。
 *
 * 移植自 clowder-ai `infrastructure/enterprise/lark-types.ts`。
 */

/** Error detail included when ok=false */
export interface LarkCliErrorDetail {
  type: string;
  code: number;
  message: string;
  hint?: string;
}

/** Base envelope from lark-cli */
export interface LarkBaseResponse {
  ok: boolean;
  identity?: 'user' | 'bot';
  data?: unknown;
  error?: LarkCliErrorDetail;
}

/** lark-cli docs +create */
export interface LarkDocsCreateResponse extends LarkBaseResponse {
  data?: {
    doc_id: string;
    doc_url: string;
    log_id?: string;
    message?: string;
  };
}

/** lark-cli base +base-create */
export interface LarkBaseCreateResponse extends LarkBaseResponse {
  data?: {
    base?: {
      base_token: string;
      name: string;
      url: string;
      folder_token?: string;
    };
    created?: boolean;
  };
}

/** lark-cli task +create */
export interface LarkTaskCreateResponse extends LarkBaseResponse {
  data?: {
    guid: string;
    url?: string;
  };
}

/** lark-cli calendar +create */
export interface LarkCalendarCreateResponse extends LarkBaseResponse {
  data?: {
    event_id: string;
    summary?: string;
    start?: string;
    end?: string;
  };
}

/** lark-cli slides +create */
export interface LarkSlidesCreateResponse extends LarkBaseResponse {
  data?: {
    xml_presentation_id: string;
    title?: string;
    url?: string;
    revision_id?: number;
  };
}

/** lark-cli contact +search-user（形状 best-effort，受租户 scope 限制） */
export interface LarkContactSearchResponse extends LarkBaseResponse {
  data?: {
    users?: Array<{
      open_id: string;
      name: string;
      email?: string;
      user_id?: string;
    }>;
  };
}

// --- Resource Handles（LarkActionService 返回） ---

export interface LarkDocHandle {
  documentId: string;
  url: string;
  title: string;
}

export interface LarkBaseHandle {
  appToken: string;
  url: string;
  name: string;
}

export interface LarkTaskHandle {
  guid: string;
  summary: string;
  url?: string;
}

export interface LarkCalendarEventHandle {
  eventId: string;
  calendarId: string;
  summary: string;
}

export interface LarkSlideHandle {
  presentationId: string;
  url: string;
  title: string;
}

export interface LarkGoldenChainResult {
  doc: LarkDocHandle;
  base: LarkBaseHandle;
  tasks: LarkTaskHandle[];
  calendarEvent: LarkCalendarEventHandle;
  summary: string;
}
