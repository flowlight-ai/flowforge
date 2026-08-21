/**
 * codex-adapter — T6.6 Codex `exec --json` 事件解析契约验证。
 *
 * 覆盖：thread.started、todo_list 快照、item.started（mcp_tool_call / command_execution）、
 * agent_message 多轮分隔、command_execution / file_change / mcp_tool_call 完成态、
 * web_search / reasoning / item error、Reconnecting 行、turn.* 终态追踪、
 * buildSpawnArgs / isAvailable / parser finalize。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCodexAdapter,
  createCodexStreamState,
  transformCodexEvent,
} from '../src/codex-adapter.js';

let tmpDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'limb-adapters-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('transformCodexEvent — 会话与文本', () => {
  it('thread.started → session_init', () => {
    const out = transformCodexEvent({ type: 'thread.started', thread_id: 'thr-1' });
    expect(out).toEqual({ type: 'session_init', sessionId: 'thr-1', timestamp: expect.any(Number) });
  });

  it('agent_message → text；第二轮以 \\n\\n 分隔', () => {
    const state = createCodexStreamState();
    const first = transformCodexEvent(
      { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
      state,
    );
    expect(first).toEqual({ type: 'text', content: 'hello', timestamp: expect.any(Number) });
    const second = transformCodexEvent(
      { type: 'item.completed', item: { type: 'agent_message', text: 'again' } },
      state,
    );
    expect(second).toEqual({ type: 'text', content: '\n\nagain', timestamp: expect.any(Number) });
  });

  it('空 agent_message / 未知 item 类型跳过', () => {
    expect(transformCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: '  ' } })).toBeNull();
    expect(transformCodexEvent({ type: 'item.completed', item: { type: 'unknown_thing' } })).toBeNull();
  });

  it('todo_list → system_info(task_progress snapshot)', () => {
    const out = transformCodexEvent({
      type: 'item.completed',
      item: {
        type: 'todo_list',
        todo_items: [
          { id: 't1', content: 'do a', status: 'completed' },
          { id: 't2', text: 'do b', status: 'in_progress' },
        ],
      },
    });
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({
        type: 'task_progress',
        action: 'snapshot',
        tasks: [
          { id: 't1', subject: 'do a', status: 'completed' },
          { id: 't2', subject: 'do b', status: 'in_progress' },
        ],
      }),
      timestamp: expect.any(Number),
    });
  });
});

describe('transformCodexEvent — 工具事件', () => {
  it('item.started mcp_tool_call → tool_use（mcp:server/tool + toolUseId）', () => {
    const out = transformCodexEvent({
      type: 'item.started',
      item: { type: 'mcp_tool_call', server: 'fs', tool: 'read', arguments: { path: '/a' }, id: 'call-1' },
    });
    expect(out).toEqual({
      type: 'tool_use',
      toolName: 'mcp:fs/read',
      toolInput: { path: '/a' },
      toolUseId: 'call-1',
      timestamp: expect.any(Number),
    });
  });

  it('item.started command_execution → tool_use', () => {
    const out = transformCodexEvent({
      type: 'item.started',
      item: { type: 'command_execution', command: 'ls -la' },
    });
    expect(out).toEqual({
      type: 'tool_use',
      toolName: 'command_execution',
      toolInput: { command: 'ls -la' },
      timestamp: expect.any(Number),
    });
  });

  it('command_execution completed → tool_result（command/status/exit_code/output）', () => {
    const out = transformCodexEvent({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'ls', status: 'completed', exit_code: 0, aggregated_output: 'file.txt\n' },
    });
    expect(out).toEqual({
      type: 'tool_result',
      content: 'command: ls\nstatus: completed\nexit_code: 0\nfile.txt',
      timestamp: expect.any(Number),
    });
  });

  it('file_change completed → tool_use', () => {
    const out = transformCodexEvent({
      type: 'item.completed',
      item: { type: 'file_change', status: 'completed', changes: [{ path: '/a.ts' }] },
    });
    expect(out).toEqual({
      type: 'tool_use',
      toolName: 'file_change',
      toolInput: { status: 'completed', changes: [{ path: '/a.ts' }] },
      timestamp: expect.any(Number),
    });
  });

  it('mcp_tool_call completed ok → tool_result(ok)', () => {
    const out = transformCodexEvent({
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        server: 'fs',
        tool: 'read',
        id: 'call-1',
        status: 'completed',
        result: { content: [{ type: 'text', text: 'file body' }] },
      },
    });
    expect(out).toEqual({
      type: 'tool_result',
      content: 'mcp:fs/read (completed)\nfile body',
      toolName: 'mcp:fs/read',
      toolResultStatus: 'ok',
      toolUseId: 'call-1',
      timestamp: expect.any(Number),
    });
  });

  it('mcp_tool_call failed → tool_result(error) 用 item.error.message', () => {
    const out = transformCodexEvent({
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        server: 'fs',
        tool: 'write',
        status: 'failed',
        error: { message: 'permission denied' },
      },
    });
    expect(out).toMatchObject({
      type: 'tool_result',
      toolName: 'mcp:fs/write',
      toolResultStatus: 'error',
      content: 'mcp:fs/write (failed)\npermission denied',
    });
  });

  it('web_search → system_info（仅计数）', () => {
    const out = transformCodexEvent({ type: 'item.completed', item: { type: 'web_search', query: 'secret' } });
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'web_search', count: 1 }),
      timestamp: expect.any(Number),
    });
  });

  it('reasoning → system_info(thinking)；item error → system_info(warning)', () => {
    expect(transformCodexEvent({ type: 'item.completed', item: { type: 'reasoning', text: 'hmm' } })).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'thinking', text: 'hmm' }),
      timestamp: expect.any(Number),
    });
    expect(transformCodexEvent({ type: 'item.completed', item: { type: 'error', message: 'boom' } })).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'warning', message: 'boom' }),
      timestamp: expect.any(Number),
    });
  });
});

describe('transformCodexEvent — 控制流', () => {
  it('error Reconnecting... → system_info；其余 error → null', () => {
    expect(transformCodexEvent({ type: 'error', message: 'Reconnecting... attempt 2' })).toEqual({
      type: 'system_info',
      content: 'Reconnecting... attempt 2',
      timestamp: expect.any(Number),
    });
    expect(transformCodexEvent({ type: 'error', message: 'fatal' })).toBeNull();
  });

  it('turn.completed → null 并记录 lastTurnTerminal=successful', () => {
    const state = createCodexStreamState();
    expect(transformCodexEvent({ type: 'turn.completed', status: 'completed' }, state)).toBeNull();
    expect(state.lastTurnTerminal).toBe('successful');
  });

  it('turn.failed → lastTurnTerminal=non_success；item 事件重置终态', () => {
    const state = createCodexStreamState();
    transformCodexEvent({ type: 'turn.failed' }, state);
    expect(state.lastTurnTerminal).toBe('non_success');
    transformCodexEvent({ type: 'item.started', item: { type: 'command_execution', command: 'x' } }, state);
    expect(state.lastTurnTerminal).toBeUndefined();
  });

  it('非对象输入跳过', () => {
    expect(transformCodexEvent(null)).toBeNull();
    expect(transformCodexEvent('raw')).toBeNull();
  });
});

describe('createCodexAdapter', () => {
  it('默认配置对齐 EAC', () => {
    const adapter = createCodexAdapter();
    expect(adapter.config).toMatchObject({ kind: 'codex', binary: 'codex', defaultTimeoutMs: 120_000 });
  });

  it('buildSpawnArgs 组装 exec [resume ID] --json --ignore-user-config [prompt]', () => {
    const adapter = createCodexAdapter();
    expect(adapter.buildSpawnArgs({ prompt: 'fix bug' })).toEqual(['exec', '--json', '--ignore-user-config', 'fix bug']);
    expect(adapter.buildSpawnArgs({ resumeSessionId: 'sess-1', prompt: 'continue' })).toEqual([
      'exec', 'resume', 'sess-1', '--json', '--ignore-user-config', 'continue',
    ]);
  });

  it('isAvailable 基于注入 PATH 探测二进制', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'codex'), '#!/bin/sh\n', { mode: 0o755 });
    const adapter = createCodexAdapter();
    expect(adapter.isAvailable(dir)).toBe(true);
    expect(adapter.isAvailable(join(tmpdir(), 'no-such-dir'))).toBe(false);
  });

  it('createParser finalize 置 finalizeEmitted 且返回 null', () => {
    const adapter = createCodexAdapter();
    const parser = adapter.createParser();
    expect(parser.finalize?.()).toBeNull();
  });
});
