/**
 * F162: WeChat Work（企业微信）CLI 类型定义。
 *
 * wecom-cli 响应统一 base 形状：{ errcode, errmsg, ...data }。
 * errcode === 0 成功，其余为企微后端 API 错误。
 *
 * 移植自 clowder-ai `infrastructure/enterprise/wecom-types.ts`。
 */

/** Base response from wecom-cli commands */
export interface WeComBaseResponse {
  errcode: number;
  errmsg: string;
}

export interface WeComDocResponse extends WeComBaseResponse {
  url: string;
  docid: string;
}

export interface WeComTodoResponse extends WeComBaseResponse {
  todo_id: string;
}

export interface WeComMeetingResponse extends WeComBaseResponse {
  meetingid: string;
  meeting_code: string;
  meeting_link: string;
}

export interface WeComSmartTableSheetResponse extends WeComBaseResponse {
  sheet_list: Array<{ sheet_id: string; title: string }>;
}

export interface WeComSmartTableGetFieldsResponse extends WeComBaseResponse {
  fields: Array<{ field_id: string; field_title: string; field_type: string }>;
}

export interface WeComSmartTableFieldsResponse extends WeComBaseResponse {
  fields: Array<{ field_id: string; field_title: string }>;
}

export interface WeComSmartTableRecordsResponse extends WeComBaseResponse {
  records: Array<{ record_id: string }>;
}

export interface WeComUserListResponse extends WeComBaseResponse {
  userlist: Array<{ userid: string; name: string; alias?: string }>;
}

// --- Resource Handles（ActionService 返回） ---

export interface DocHandle {
  docId: string;
  url: string;
  docName: string;
}

export interface TodoHandle {
  todoId: string;
  content: string;
}

export interface MeetingHandle {
  meetingId: string;
  meetingCode: string;
  meetingLink: string;
  title: string;
}

export interface GoldenChainResult {
  doc: DocHandle;
  smartTable: DocHandle;
  todos: TodoHandle[];
  meeting: MeetingHandle;
  summary: string;
}
