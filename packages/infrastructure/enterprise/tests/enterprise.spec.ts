/**
 * enterprise 插件包测试 — C33（F162 企业 IM 操作治理边界 ADR-029）。
 *
 * 覆盖：LarkCliExecutor（可用性缓存 / JSON 信封解析 / ok:false → LarkApiError /
 * 非 JSON → ProtocolError / ENOENT → UnavailableError / 超时 → UnavailableError /
 * flag 序列化 boolean+undefined 跳过 / 纯 data 无 ok 字段视为成功）；
 * LarkActionService（createDoc/createBase/createTask/createCalendarEvent/
 * createSlides + 缺字段抛错 + searchUsers scope 降级 + goldenChain 编排）；
 * WeComCliExecutor（errcode!==0 → WeComApiError / MCP content 包装剥离 /
 * 原始 JSON 直通）；WeComActionService（createDoc + content 二次调用 /
 * createSmartTable 五步 / createTodo / createMeeting / getUserList / goldenChain）；
 * Cordis 插件挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeEnterpriseService, {
  LarkActionService,
  LarkApiError,
  LarkCliExecutor,
  LarkCliProtocolError,
  LarkCliUnavailableError,
  WeComActionService,
  WeComApiError,
  WeComCliExecutor,
  WeComCliUnavailableError,
  isScopeOrPermissionError,
  type ExecFileFn,
  type EnterpriseLogger,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

const silentLog: EnterpriseLogger = { info: () => {}, warn: () => {}, debug: () => {} };

/** 构造 execFile 桩：按 args 匹配返回预设 stdout。 */
function fakeExec(route: (args: string[]) => string | null): ExecFileFn {
  return async (_file, args) => ({ stdout: route(args) ?? '', stderr: '' });
}

// ---------------------------------------------------------------------------
// LarkCliExecutor
// ---------------------------------------------------------------------------

describe('LarkCliExecutor', () => {
  it('可用 → exec 解析信封 ok:true', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: fakeExec((args) => {
        if (args[0] === '--version') return 'lark-cli v1.0';
        return JSON.stringify({ ok: true, identity: 'user', data: { doc_id: 'd1', doc_url: 'https://x/doc1' } });
      }),
    });
    expect(await exec.isAvailable()).toBe(true);
    const res = await exec.exec<{ ok: boolean; data?: { doc_id?: string } }>('docs', '+create', { title: 't' });
    expect(res.data?.doc_id).toBe('d1');
  });

  it('ok:false → LarkApiError（带 domain/command/code）', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: fakeExec((args) =>
        args[0] === '--version' ? 'v1' : JSON.stringify({ ok: false, error: { type: 'forbidden', code: 99991668, message: 'no access' } }),
      ),
    });
    await expect(exec.exec('task', '+create', {})).rejects.toBeInstanceOf(LarkApiError);
    await exec.exec('task', '+create', {}).catch((e: LarkApiError) => {
      expect(e.code).toBe(99991668);
      expect(e.domain).toBe('task');
      expect(e.command).toBe('+create');
    });
  });

  it('非 JSON stdout → LarkCliProtocolError（保留 rawOutput，区分 500/503）', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: fakeExec((args) => (args[0] === '--version' ? 'v1' : 'not-json-at-all')),
    });
    await expect(exec.exec('docs', '+create', {})).rejects.toBeInstanceOf(LarkCliProtocolError);
    await exec.exec('docs', '+create', {}).catch((e: LarkCliProtocolError) => {
      expect(e.rawOutput).toBe('not-json-at-all');
    });
  });

  it('ENOENT → LarkCliUnavailableError 并复位可用性缓存', async () => {
    const enoent: ExecFileFn = async (_f, args) => {
      if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
      const err = new Error('spawn ENOENT') as NodeJS.ErrnoException & { killed?: boolean };
      err.code = 'ENOENT';
      throw err;
    };
    const exec = new LarkCliExecutor({ log: silentLog, execFileAsync: enoent });
    expect(await exec.isAvailable()).toBe(true);
    await expect(exec.exec('docs', '+create', {})).rejects.toBeInstanceOf(LarkCliUnavailableError);
    // ENOENT 将可用性缓存为 false（不再反复探测缺失的二进制）
    expect(await exec.isAvailable()).toBe(false);
  });

  it('超时（killed）→ LarkCliUnavailableError', async () => {
    const killed: ExecFileFn = async (_f, args) => {
      if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
      const err = new Error('timeout') as NodeJS.ErrnoException & { killed?: boolean };
      err.killed = true;
      throw err;
    };
    const exec = new LarkCliExecutor({ log: silentLog, execFileAsync: killed });
    await expect(exec.exec('docs', '+create', {})).rejects.toBeInstanceOf(LarkCliUnavailableError);
  });

  it('flag 序列化：boolean 仅真值输出，undefined/null 跳过；纯 data 无 ok 视为成功', async () => {
    const seen: string[][] = [];
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        seen.push(args);
        // 无 ok 字段的纯 data 响应
        return { stdout: JSON.stringify({ doc_id: 'd2' }), stderr: '' };
      },
    });
    const res = await exec.exec<{ ok: boolean; data?: { doc_id?: string } }>('base', '+base-create', {
      name: 'n',
      empty: undefined,
      flag: true,
      off: false,
    });
    expect(seen[0]).toEqual(['base', '+base-create', '--name', 'n', '--flag']);
    expect(res.data?.doc_id).toBe('d2');
  });

  it('isScopeOrPermissionError 判定', () => {
    const mk = (code: number, type: string) => new LarkApiError({ code, type, message: 'm' }, 'd', 'c');
    expect(isScopeOrPermissionError(mk(99991664, 'x'))).toBe(true);
    expect(isScopeOrPermissionError(mk(1254300, 'x'))).toBe(true);
    expect(isScopeOrPermissionError(mk(1, 'permission_denied'))).toBe(true);
    expect(isScopeOrPermissionError(mk(500, 'internal'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LarkActionService
// ---------------------------------------------------------------------------

function larkRouter(handlers: Record<string, unknown>): ExecFileFn {
  return async (_f, args) => {
    if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
    const key = `${args[0]} ${args[1]}`;
    return { stdout: JSON.stringify(handlers[key] ?? { ok: false, error: { type: 'x', code: 1, message: 'unrouted' } }), stderr: '' };
  };
}

describe('LarkActionService', () => {
  it('createDoc / createBase / createTask / createCalendarEvent / createSlides', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: larkRouter({
        'docs +create': { ok: true, data: { doc_id: 'd1', doc_url: 'https://f/doc1' } },
        'base +base-create': { ok: true, data: { base: { base_token: 'b1', name: 'B', url: 'https://f/b1' } } },
        'task +create': { ok: true, data: { guid: 'g1', url: 'https://f/t1' } },
        'calendar +create': { ok: true, data: { event_id: 'e1', summary: 'S' } },
        'slides +create': { ok: true, data: { xml_presentation_id: 'p1', title: 'P', url: 'https://f/p1' } },
      }),
    });
    const svc = new LarkActionService(exec, silentLog);

    expect(await svc.createDoc({ title: 'T', markdown: '# x' })).toEqual({
      documentId: 'd1', url: 'https://f/doc1', title: 'T',
    });
    expect((await svc.createBase({ name: 'B' })).appToken).toBe('b1');
    const task = await svc.createTask({ summary: 'S' });
    expect(task.guid).toBe('g1');
    expect(task.url).toBe('https://f/t1');
    expect(await svc.createCalendarEvent({ summary: 'S', start: 'a', end: 'b', calendarId: 'cal1' })).toEqual({
      eventId: 'e1', calendarId: 'cal1', summary: 'S',
    });
    expect((await svc.createSlides({ title: 'P' })).presentationId).toBe('p1');
  });

  it('缺关键字段 → 抛错（不做静默降级）', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: larkRouter({ 'docs +create': { ok: true, data: {} } }),
    });
    await expect(new LarkActionService(exec, silentLog).createDoc({ title: 'T' })).rejects.toThrow(/no doc_id/);
  });

  it('searchUsers：scope 错误降级为空数组；其他错误上抛', async () => {
    const scopeExec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        return { stdout: JSON.stringify({ ok: false, error: { type: 'scope_denied', code: 99991664, message: 'no scope' } }), stderr: '' };
      },
    });
    expect(await new LarkActionService(scopeExec, silentLog).searchUsers('q')).toEqual([]);

    const failExec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        return { stdout: JSON.stringify({ ok: false, error: { type: 'internal', code: 500, message: 'boom' } }), stderr: '' };
      },
    });
    await expect(new LarkActionService(failExec, silentLog).searchUsers('q')).rejects.toBeInstanceOf(LarkApiError);

    const okExec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: larkRouter({ 'contact +search-user': { ok: true, data: { users: [{ open_id: 'ou1', name: 'Alice' }] } } }),
    });
    expect(await new LarkActionService(okExec, silentLog).searchUsers('a')).toEqual([{ openId: 'ou1', name: 'Alice' }]);
  });

  it('goldenChain 编排（含可选 slides 失败降级）', async () => {
    const exec = new LarkCliExecutor({
      log: silentLog,
      execFileAsync: larkRouter({
        'docs +create': { ok: true, data: { doc_id: 'd', doc_url: 'https://f/d' } },
        'base +base-create': { ok: true, data: { base: { base_token: 'b', name: 'B', url: 'https://f/b' } } },
        'task +create': { ok: true, data: { guid: 'g' } },
        'calendar +create': { ok: true, data: { event_id: 'e', summary: 'C' } },
        // slides 故意缺字段 → 抛错降级
        'slides +create': { ok: true, data: {} },
      }),
    });
    const result = await new LarkActionService(exec, silentLog).goldenChain({
      docTitle: 'D', docMarkdown: '# m', baseName: 'B',
      tasks: [{ summary: 't1', assigneeOpenId: 'ou1' }],
      calendarSummary: 'C', calendarStart: 's', calendarEnd: 'e', calendarAttendeeOpenIds: ['ou1', 'ou2'],
      includeSlides: true,
    });
    expect(result.tasks.length).toBe(1);
    expect(result.summary).toContain('📄 文档');
    expect(result.summary).toContain('📊 多维表');
    expect(result.summary).toContain('✅ 任务: 1 条已分发');
    // slides 失败 → 无 slides 字段，编排继续
    expect(result.slides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WeComCliExecutor
// ---------------------------------------------------------------------------

describe('WeComCliExecutor', () => {
  it('errcode 0 直通；errcode!==0 → WeComApiError', async () => {
    const ok = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', url: 'https://w/1', docid: 'dd1' }), stderr: '' };
      },
    });
    const res = await ok.exec<{ errcode: number; errmsg: string; docid: string }>('doc', 'create_doc', { doc_type: 3 });
    expect(res.docid).toBe('dd1');

    const bad = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        return { stdout: JSON.stringify({ errcode: 40001, errmsg: 'invalid' }), stderr: '' };
      },
    });
    await expect(bad.exec('todo', 'create_todo', {})).rejects.toBeInstanceOf(WeComApiError);
    await bad.exec('todo', 'create_todo', {}).catch((e: WeComApiError) => {
      expect(e.errcode).toBe(40001);
      expect(e.category).toBe('todo');
      expect(e.method).toBe('create_todo');
    });
  });

  it('MCP content 包装剥离（content[0].text）', async () => {
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        const inner = JSON.stringify({ errcode: 0, errmsg: 'ok', todo_id: 'td1' });
        return { stdout: JSON.stringify({ content: [{ text: inner, type: 'text' }], isError: false }), stderr: '' };
      },
    });
    const res = await exec.exec<{ errcode: number; errmsg: string; todo_id: string }>('todo', 'create_todo', {});
    expect(res.todo_id).toBe('td1');
  });

  it('CLI 未安装 → WeComCliUnavailableError', async () => {
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async () => {
        const err = new Error('nope') as NodeJS.ErrnoException & { killed?: boolean };
        err.code = 'ENOENT';
        throw err;
      },
    });
    expect(await exec.isAvailable()).toBe(false);
    await expect(exec.exec('doc', 'create_doc', {})).rejects.toBeInstanceOf(WeComCliUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// WeComActionService
// ---------------------------------------------------------------------------

function wecomRouter(handlers: Record<string, unknown>): ExecFileFn {
  return async (_f, args) => {
    if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
    const key = `${args[0]} ${args[1]}`;
    const payload = handlers[key] ?? { errcode: 1, errmsg: 'unrouted' };
    return { stdout: JSON.stringify(payload), stderr: '' };
  };
}

describe('WeComActionService', () => {
  it('createDoc 含 content → 二次 edit_doc_content 调用', async () => {
    const calls: string[] = [];
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        calls.push(`${args[0]} ${args[1]}`);
        return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', url: 'https://w/d', docid: 'd1' }), stderr: '' };
      },
    });
    const handle = await new WeComActionService(exec, silentLog).createDoc({ docName: 'N', content: '# c' });
    expect(handle.docId).toBe('d1');
    expect(calls).toEqual(['doc create_doc', 'doc edit_doc_content']);
  });

  it('createSmartTable 五步（create → get_sheet → get_fields → update_fields → add_fields → add_records）', async () => {
    const calls: string[] = [];
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        calls.push(`${args[0]} ${args[1]}`);
        if (args[1] === 'create_doc') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', url: 'https://w/t', docid: 't1' }), stderr: '' };
        if (args[1] === 'smartsheet_get_sheet') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', sheet_list: [{ sheet_id: 'sh1', title: 'S' }] }), stderr: '' };
        if (args[1] === 'smartsheet_get_fields') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', fields: [{ field_id: 'f0', field_title: '文本', field_type: 'FIELD_TYPE_TEXT' }] }), stderr: '' };
        return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', fields: [], records: [] }), stderr: '' };
      },
    });
    const handle = await new WeComActionService(exec, silentLog).createSmartTable({
      tableName: 'T',
      fields: [
        { fieldTitle: '任务', fieldType: 'FIELD_TYPE_TEXT' },
        { fieldTitle: '状态', fieldType: 'FIELD_TYPE_SINGLE_SELECT' },
      ],
      records: [{ 任务: 'a', 状态: '待处理' }],
    });
    expect(handle.docId).toBe('t1');
    expect(calls).toEqual([
      'doc create_doc',
      'doc smartsheet_get_sheet',
      'doc smartsheet_get_fields',
      'doc smartsheet_update_fields',
      'doc smartsheet_add_fields',
      'doc smartsheet_add_records',
    ]);
  });

  it('createTodo / createMeeting / getUserList', async () => {
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: wecomRouter({
        'todo create_todo': { errcode: 0, errmsg: 'ok', todo_id: 'td1' },
        'meeting create_meeting': { errcode: 0, errmsg: 'ok', meetingid: 'm1', meeting_code: '123', meeting_link: 'https://w/m' },
        'contact get_userlist': { errcode: 0, errmsg: 'ok', userlist: [{ userid: 'u1', name: 'Alice' }] },
      }),
    });
    const svc = new WeComActionService(exec, silentLog);
    expect(await svc.createTodo({ content: 'c', followerUserIds: ['u1'] })).toEqual({ todoId: 'td1', content: 'c' });
    expect((await svc.createMeeting({ title: 'M', startDatetime: 's', durationSeconds: 60, inviteeUserIds: ['u1'] })).meetingCode).toBe('123');
    expect(await svc.getUserList()).toEqual([{ userId: 'u1', name: 'Alice', alias: undefined }]);
  });

  it('goldenChain 四连编排 + summary 四行', async () => {
    const exec = new WeComCliExecutor({
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') return { stdout: 'v1', stderr: '' };
        const m = args[1];
        if (m === 'create_doc') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', url: 'https://w/d', docid: 'd1' }), stderr: '' };
        if (m === 'smartsheet_get_sheet') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', sheet_list: [{ sheet_id: 'sh1' }] }), stderr: '' };
        if (m === 'smartsheet_get_fields') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', fields: [{ field_id: 'f0', field_title: '文本', field_type: 'FIELD_TYPE_TEXT' }] }), stderr: '' };
        if (m === 'create_todo') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', todo_id: 'td1' }), stderr: '' };
        if (m === 'create_meeting') return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', meetingid: 'm1', meeting_code: '1', meeting_link: 'https://w/m' }), stderr: '' };
        return { stdout: JSON.stringify({ errcode: 0, errmsg: 'ok', fields: [], records: [] }), stderr: '' };
      },
    });
    const result = await new WeComActionService(exec, silentLog).goldenChain({
      docName: 'D', docContent: '# c', tableName: 'T',
      tasks: [{ content: 't1', assigneeUserId: 'u1' }, { content: 't2', assigneeUserId: 'u2' }],
      meetingTitle: 'M', meetingStart: 's', meetingDurationSeconds: 3600, meetingInviteeUserIds: ['u1', 'u2'],
    });
    expect(result.todos.length).toBe(2);
    expect(result.summary.split('\n').length).toBe(4);
    expect(result.summary).toContain('📄 文档');
    expect(result.summary).toContain('🎥 会议');
  });
});

// ---------------------------------------------------------------------------
// Cordis 插件
// ---------------------------------------------------------------------------

describe('ForgeEnterpriseService（Cordis 插件）', () => {
  it('挂载 ctx.forgeEnterprise + lark/wecom 双 ActionService + 可用性', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeEnterpriseService, {
      log: silentLog,
      execFileAsync: async (_f, args) => {
        if (args[0] === '--version') {
          // 仅 lark-cli 可用；wecom-cli 不可用
          if (_f === 'lark-cli') return { stdout: 'v1', stderr: '' };
          const err = new Error('nope') as NodeJS.ErrnoException & { killed?: boolean };
          err.code = 'ENOENT';
          throw err;
        }
        return { stdout: JSON.stringify({ ok: true, data: { doc_id: 'd9', doc_url: 'https://f/d9' } }), stderr: '' };
      },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeEnterprise;
    expect(svc).toBeDefined();
    expect(await svc.isLarkAvailable()).toBe(true);
    expect(await svc.isWeComAvailable()).toBe(false);

    expect((await svc.lark.createDoc({ title: 'T' })).documentId).toBe('d9');
    await expect(svc.wecom.createDoc({ docName: 'N' })).rejects.toBeInstanceOf(WeComCliUnavailableError);
  });
});
