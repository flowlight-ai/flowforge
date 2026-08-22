/**
 * client — TraeLLMClient 客户端薄层契约验证（对齐 Python client.py）。
 *
 * 测试策略：注入确定性 uuidFn 固定 request_id，预写 response 文件模拟
 * operator 回写，pollResponse 首轮即命中（无真实等待）。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TraeLLMClient } from '../src/client.js';
import {
  makeTraeBridgeConfig,
  makeTraeClientConfig,
  type TraeBridgeConfig,
  type TraeClientConfig,
} from '../src/config.js';
import { TraeBridgeConfigError } from '../src/errors.js';
import { makeBridgeRequestContext } from '../src/models.js';
import { TraeBridgeProtocol } from '../src/protocol.js';
import type { SessionMemoryStore } from '../src/session.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const tmpDirs: string[] = [];
let sharedDir: string;

function makeMemoryStore(): SessionMemoryStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async save(scope, key, value) {
      data.set(`${scope}:${key}`, value);
    },
    async retrieve(scope, key) {
      const value = data.get(`${scope}:${key}`);
      return value === undefined ? [] : [{ value }];
    },
  };
}

/** 创建客户端：确定性 uuidFn + 预写 response 模拟 operator */
function setup(
  fixedRid: string,
  responseContent: Record<string, unknown>,
  bridgeOverrides: Partial<TraeBridgeConfig> = {},
  clientOverrides: Partial<TraeClientConfig> = {},
): { client: TraeLLMClient } {
  const bridgeConfig = makeTraeBridgeConfig({
    shared_dir: sharedDir,
    poll_interval_seconds: 0.01,
    ...bridgeOverrides,
  });
  const protocol = new TraeBridgeProtocol(bridgeConfig, {
    uuidFn: () => fixedRid,
    sleepFn: async () => {},
    logger: silentLogger,
  });
  // 预写响应文件（模拟 operator 已回写）
  writeFileSync(
    path.join(sharedDir, 'responses', `response_${fixedRid}.json`),
    JSON.stringify({ request_id: fixedRid, status: 'completed', ...responseContent }),
    'utf-8',
  );
  const client = new TraeLLMClient({
    config: makeTraeClientConfig(clientOverrides),
    bridgeConfig,
    protocol,
    sleepFn: async () => {},
  });
  return { client };
}

beforeEach(() => {
  sharedDir = mkdtempSync(path.join(os.tmpdir(), 'trae-bridge-client-'));
  tmpDirs.push(sharedDir);
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('chat 核心流程（F045 §2.1）', () => {
  it('完整往返：content + provider=trae + usage.latency_ms', async () => {
    const { client } = setup('rid-1', { content: '你好，世界', model: 'Doubao-Seed2.0' });
    const result = await client.chat([{ role: 'user', content: '你好' }]);
    expect(result['content']).toBe('你好，世界');
    expect(result['provider']).toBe('trae');
    expect(result['request_id']).toBe('rid-1');
    expect(typeof (result['usage'] as Record<string, unknown>)['latency_ms']).toBe('number');
  });

  it('桥接未启用抛 ConfigError', async () => {
    const bridgeConfig = makeTraeBridgeConfig({ shared_dir: sharedDir, enabled: false });
    const client = new TraeLLMClient({ bridgeConfig });
    await expect(client.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      TraeBridgeConfigError,
    );
  });

  it('长任务类型用 long_task_timeout（write_doc → 1800）', async () => {
    const { client } = setup(
      'rid-long',
      { content: '文档内容' },
      { archive_completed: false },
    );
    await client.chat([{ role: 'user', content: '写文档' }], {
      taskType: 'write_doc',
      forgekinId: 'forgemind:wenxin',
    });
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_rid-long.json'), 'utf-8'),
    );
    expect(data.timeout_seconds).toBe(1800);
    expect(data.context.forgekin_id).toBe('forgemind:wenxin');
  });

  it('普通任务用 default_timeout（300）', async () => {
    const { client } = setup('rid-chat', { content: 'ok' }, { archive_completed: false });
    await client.chat([{ role: 'user', content: 'hi' }]);
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_rid-chat.json'), 'utf-8'),
    );
    expect(data.timeout_seconds).toBe(300);
  });

  it('taskId 透传为 request_id', async () => {
    const bridgeConfig = makeTraeBridgeConfig({
      shared_dir: sharedDir,
      archive_completed: false,
    });
    const protocol = new TraeBridgeProtocol(bridgeConfig, {
      sleepFn: async () => {},
      logger: silentLogger,
    });
    // taskId 决定 request_id（不依赖 uuidFn）
    writeFileSync(
      path.join(sharedDir, 'responses', 'response_task-xyz.json'),
      JSON.stringify({ request_id: 'task-xyz', content: 'ok', status: 'completed' }),
      'utf-8',
    );
    const client = new TraeLLMClient({ bridgeConfig, protocol, sleepFn: async () => {} });
    const result = await client.chat([{ role: 'user', content: 'x' }], { taskId: 'task-xyz' });
    expect(result['request_id']).toBe('task-xyz');
  });
});

describe('会话上下文（session_id + session_persistence）', () => {
  it('user 消息与 assistant 响应均入会话并持久化', async () => {
    const { client } = setup('rid-s', { content: '回答内容' });
    const store = makeMemoryStore();
    client.setMemoryStore(store);

    await client.chat([{ role: 'user', content: '问题' }], { sessionId: 'sess-1' });
    expect(store.data.size).toBe(1);

    const saved = store.data.get('short_term:trae_session:sess-1') as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(saved.messages).toEqual([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答内容' },
    ]);
  });

  it('第二次调用前置会话历史（messages≤1 时追加）', async () => {
    const { client } = setup('rid-s2', { content: '第二轮回答' }, { archive_completed: false });
    const store = makeMemoryStore();
    client.setMemoryStore(store);

    await client.chat([{ role: 'user', content: '第一问' }], { sessionId: 'sess-2' });
    await client.chat([{ role: 'user', content: '第二问' }], { sessionId: 'sess-2' });

    // 第二次请求文件包含历史 + 新消息（固定 uuidFn 下两轮响应均为预写内容）
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_rid-s2.json'), 'utf-8'),
    );
    expect(data.messages.map((m: { content: string }) => m.content)).toEqual([
      '第一问',
      '第二轮回答',
      '第二问',
    ]);
  });
});

describe('streamChat / chatWithTools', () => {
  it('streamChat 按 streamChunkSize 分块', async () => {
    const { client } = setup('rid-stream', { content: 'a'.repeat(200) });
    const chunks: string[] = [];
    for await (const chunk of client.streamChat([{ role: 'user', content: 'x' }], {
      streamChunkSize: 80,
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe('a'.repeat(200));
  });

  it('chatWithTools 注入 tools 到 context', async () => {
    const { client } = setup('rid-tools', { content: 'ok' }, { archive_completed: false });
    await client.chatWithTools(
      [{ role: 'user', content: '用工具' }],
      [{ type: 'function', function: { name: 'search' } }],
    );
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_rid-tools.json'), 'utf-8'),
    );
    expect(data.context.task_type).toBe('chat_with_tools');
    expect(data.context.tools).toHaveLength(1);
  });
});

describe('专用编码方法', () => {
  it('completeCode 返回代码字符串 + task_type=complete_code', async () => {
    const { client } = setup('rid-code', { content: 'const x = 1;' }, {
      archive_completed: false,
    });
    const ctx = makeBridgeRequestContext({ forgekin_id: 'forgemind:luban' });
    const code = await client.completeCode('补全变量', ctx, { contextCode: 'let a=0;' });
    expect(code).toBe('const x = 1;');
    expect(ctx.task_type).toBe('complete_code');
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_rid-code.json'), 'utf-8'),
    );
    expect(data.messages[1].content).toContain('补全变量');
  });

  it('reviewCode 解析 JSON 围栏响应', async () => {
    const jsonContent = '```json\n{"findings": [{"type": "bug"}], "severity": "P1", "summary": "有问题"}\n```';
    const { client } = setup('rid-review', { content: jsonContent });
    const ctx = makeBridgeRequestContext({ forgekin_id: 'forgemind:sherlock' });
    const result = await client.reviewCode('x = 1', ctx);
    expect(result['severity']).toBe('P1');
    expect(result['findings']).toEqual([{ type: 'bug' }]);
    expect(result['raw_content']).toBe(jsonContent);
    expect(ctx.task_type).toBe('review_code');
  });

  it('reviewCode 非 JSON 响应兜底（findings=[]/severity=P3）', async () => {
    const { client } = setup('rid-review2', { content: '这段代码还行' });
    const ctx = makeBridgeRequestContext({ forgekin_id: 'f' });
    const result = await client.reviewCode('x', ctx);
    expect(result['findings']).toEqual([]);
    expect(result['severity']).toBe('P3');
    expect(result['summary']).toBe('这段代码还行');
  });

  it('generateTests 返回测试代码 + task_type=generate_tests', async () => {
    const { client } = setup('rid-tests', { content: 'def test_x(): pass' });
    const ctx = makeBridgeRequestContext({ forgekin_id: 'f' });
    const tests = await client.generateTests('def x(): pass', ctx);
    expect(tests).toBe('def test_x(): pass');
    expect(ctx.task_type).toBe('generate_tests');
  });
});

describe('healthCheck', () => {
  it('bridge 模式委托 protocol（目录可写 → true）', async () => {
    const bridgeConfig = makeTraeBridgeConfig({ shared_dir: sharedDir });
    const client = new TraeLLMClient({ bridgeConfig });
    expect(await client.healthCheck()).toBe(true);
  });

  it('cli/api 模式未实现 → false', async () => {
    const bridgeConfig = makeTraeBridgeConfig({ shared_dir: sharedDir });
    const cliClient = new TraeLLMClient({
      bridgeConfig,
      config: makeTraeClientConfig({ mode: 'cli' }),
    });
    expect(await cliClient.healthCheck()).toBe(false);
  });
});
