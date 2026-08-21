#!/usr/bin/env node
/**
 * mock-cli — T6.7 端到端测试固定输出 CLI（跨平台 fixture）
 *
 * 用法：node mock-cli.mjs --mode <claude|codex|gemini|opencode|agy> [--resume ID] [prompt...]
 * - claude/codex/gemini/opencode：向 stdout 输出固定 NDJSON 事件序列（模拟 stream-json/json/ndjson）
 * - agy：向 stdout 输出固定 plain text（模拟 --print 模式）
 * 脚本不读取 prompt 内容，仅按 mode 输出预置序列，便于 e2e 断言解析结果。
 */
import process from 'node:process';

const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex >= 0 ? (args[modeIndex + 1] ?? 'claude') : 'claude';

function emit(...events) {
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

switch (mode) {
  case 'codex':
    // codex exec --json：thread → 工具 → 文本 → 终态
    emit(
      { type: 'thread.started', thread_id: 'mock-thread-codex' },
      { type: 'item.started', item: { type: 'command_execution', command: 'echo mock' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Hello from mock codex' } },
      { type: 'turn.completed', status: 'completed' },
    );
    break;

  case 'gemini':
    // gemini -o stream-json：init → assistant message → 成功终止
    emit(
      { type: 'init', session_id: 'mock-sess-gemini' },
      { type: 'message', role: 'assistant', content: 'Hello from mock gemini' },
      { type: 'result', status: 'success' },
    );
    break;

  case 'opencode':
    // opencode run --format json：step → 文本 → 遥测收尾
    emit(
      { type: 'step_start', sessionID: 'mock-sess-opencode' },
      { type: 'text', part: { type: 'text', text: 'Hello from mock opencode' } },
      {
        type: 'step_finish',
        part: { tokens: { input: 40, output: 12, total: 52, cache: { read: 0, write: 0 } } },
      },
    );
    break;

  case 'agy':
    // agy --print：纯文本 stdout
    process.stdout.write('Hello from mock agy\n');
    break;

  case 'claude':
  default:
    // claude stream-json：init → 增量文本 → 成功终止
    emit(
      { type: 'system', subtype: 'init', session_id: 'mock-sess-claude' },
      {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: 'msg_1', usage: { input_tokens: 10, cache_read_input_tokens: 2 } },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello from mock claude' },
        },
      },
      { type: 'stream_event', event: { type: 'message_stop' } },
      { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 4 } },
    );
    break;
}
