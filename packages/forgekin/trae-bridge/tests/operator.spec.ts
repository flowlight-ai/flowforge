/**
 * operator — BridgeLLMOperator operator 端契约验证（对齐 Python bridge_operator.py）。
 *
 * 覆盖：无效响应检测 / system 合并 / callLlm 重试策略（无效重试×3 + 超时重试 +
 * 其他异常不重试）/ handleRequestFile 端到端（原子重命名互斥 + 统计 + .processing 清理）/
 * start-stop 轮询循环。
 *
 * 测试注入：fetchFn（假 OpenRoute）+ sleepFn（无真实等待）+ env: {}。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTraeBridgeConfig } from '../src/config.js';
import {
  BridgeLLMOperator,
  type BridgeLLMOperatorOptions,
  type OperatorFetchResponse,
} from '../src/operator.js';

const tmpDirs: string[] = [];
let sharedDir: string;

beforeEach(() => {
  sharedDir = mkdtempSync(path.join(os.tmpdir(), 'trae-bridge-op-'));
  tmpDirs.push(sharedDir);
  mkdirSync(path.join(sharedDir, 'requests'), { recursive: true });
  mkdirSync(path.join(sharedDir, 'responses'), { recursive: true });
  mkdirSync(path.join(sharedDir, 'cancels'), { recursive: true });
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function fetchOk(content: string): OperatorFetchResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
  };
}

function makeOperator(
  options: BridgeLLMOperatorOptions & { fetchFn: BridgeLLMOperatorOptions['fetchFn'] },
): BridgeLLMOperator {
  return new BridgeLLMOperator(makeTraeBridgeConfig({ shared_dir: sharedDir }), {
    sleepFn: async () => {},
    env: {},
    ...options,
  });
}

describe('chatEndpoint 规范化', () => {
  it('剥离尾部 /v1 后统一拼接 /v1/chat/completions', () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('x') });
    expect(op.chatEndpoint).toBe('http://localhost:13001/v1/chat/completions');
    const op2 = new BridgeLLMOperator(makeTraeBridgeConfig({ shared_dir: sharedDir }), {
      openrouteBaseUrl: 'http://localhost:9000/v1',
      env: {},
    });
    expect(op2.chatEndpoint).toBe('http://localhost:9000/v1/chat/completions');
  });
});

describe('isInvalidResponse（沉默失败检测）', () => {
  const op = makeOperator({ fetchFn: async () => fetchOk('x') });

  it('空 / 空白 → false', () => {
    expect(op.isInvalidResponse('')).toBe(false);
    expect(op.isInvalidResponse('   ')).toBe(false);
  });

  it('精确匹配与前缀匹配 pattern → true', () => {
    expect(op.isInvalidResponse('无法回答')).toBe(true);
    expect(op.isInvalidResponse('无法回答这个问题，因为...（很长的解释也照算前缀）')).toBe(true);
  });

  it('主要匹配：包含 pattern 且长度接近 → true', () => {
    expect(op.isInvalidResponse('抱歉，我无法提供更多信息')).toBe(true);
  });

  it('短内容（<10字符）含关键词 → true', () => {
    expect(op.isInvalidResponse('暂不支持')).toBe(true);
  });

  it('正常内容 → false', () => {
    expect(op.isInvalidResponse('这是一段正常的、足够长的回答内容。')).toBe(false);
  });
});

describe('mergeSystemIntoUser', () => {
  const op = makeOperator({ fetchFn: async () => fetchOk('x') });

  it('无 system 消息原样返回', () => {
    const msgs = [{ role: 'user', content: 'hi' }];
    expect(op.mergeSystemIntoUser(msgs)).toEqual(msgs);
  });

  it('system 合并到第一条 user 前（\\n\\n---\\n\\n 分隔）', () => {
    const result = op.mergeSystemIntoUser([
      { role: 'system', content: '你是鲁班' },
      { role: 'system', content: '擅长工程' },
      { role: 'user', content: '帮我建桥' },
      { role: 'assistant', content: '好的' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: '你是鲁班\n\n擅长工程\n\n---\n\n帮我建桥' });
    expect(result[1]).toEqual({ role: 'assistant', content: '好的' });
  });

  it('无 user 消息时 system 转为 user 消息', () => {
    const result = op.mergeSystemIntoUser([
      { role: 'system', content: '角色设定' },
      { role: 'assistant', content: '历史回复' },
    ]);
    expect(result[0]).toEqual({ role: 'user', content: '角色设定' });
    expect(result[1]).toEqual({ role: 'assistant', content: '历史回复' });
  });
});

describe('callLlm 重试策略', () => {
  it('成功：content + usage.latency_ms + attempts=1', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        return fetchOk('正常回答内容，长度足够');
      },
    });
    const result = await op.callLlm([{ role: 'user', content: 'q' }]);
    expect(result.status).toBe('completed');
    expect(result.content).toBe('正常回答内容，长度足够');
    expect(result.attempts).toBe(1);
    expect(result.usage['total_tokens']).toBe(3);
    expect(typeof result.usage['latency_ms']).toBe('number');
    expect(calls).toBe(1);
  });

  it('无效响应重试×3：模型序列 [主模型, Kimi-K2.6, GLM-5.1] + 重试间隔 2s', async () => {
    const models: string[] = [];
    const sleeps: number[] = [];
    const op = makeOperator({
      fetchFn: async (_url, init) => {
        models.push((JSON.parse(init.body) as { model: string }).model);
        return fetchOk('无法回答');
      },
      sleepFn: async (seconds) => {
        sleeps.push(seconds);
      },
    });
    const result = await op.callLlm([{ role: 'user', content: 'q' }]);
    expect(models).toEqual(['Doubao-Seed2.0', 'Kimi-K2.6', 'GLM-5.1']);
    expect(sleeps).toEqual([2.0, 2.0]);
    expect(result.attempts).toBe(3);
    expect(result.status).toBe('completed'); // 无效响应仍是 completed 状态
    expect(result.content).toBe('无法回答');
  });

  it('超时重试×3 → status=timeout', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        const err = new Error('signal timed out');
        err.name = 'TimeoutError';
        throw err;
      },
    });
    const result = await op.callLlm([{ role: 'user', content: 'q' }]);
    expect(result.status).toBe('timeout');
    expect(result.attempts).toBe(3);
    expect(result.error).toContain('超时');
    expect(calls).toBe(3);
  });

  it('其他异常不重试（对齐 Python）→ status=error + attempts=1', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        throw new Error('connection refused');
      },
    });
    const result = await op.callLlm([{ role: 'user', content: 'q' }]);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it('HTTP 非 200 → error 不重试', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        return { ok: false, status: 500, json: async () => ({}) };
      },
    });
    const result = await op.callLlm([{ role: 'user', content: 'q' }]);
    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 500');
    expect(calls).toBe(1);
  });

  it('system 消息在请求体中已合并到 user', async () => {
    let body: { messages: Array<{ role: string; content: string }> } | null = null;
    const op = makeOperator({
      fetchFn: async (_url, init) => {
        body = JSON.parse(init.body) as typeof body;
        return fetchOk('ok 内容足够长');
      },
    });
    await op.callLlm([
      { role: 'system', content: '你是 sherlock' },
      { role: 'user', content: '审查代码' },
    ]);
    expect(body).not.toBeNull();
    expect((body as unknown as { messages: Array<{ role: string }> }).messages).toHaveLength(1);
    const parsedBody = body as unknown as { messages: Array<{ content: string }> };
    expect(parsedBody.messages[0]?.content ?? '').toContain('你是 sherlock');
  });
});

describe('handleRequestFile 端到端', () => {
  function writeRequestFile(rid: string, overrides: Record<string, unknown> = {}): string {
    const reqFile = path.join(sharedDir, 'requests', `request_${rid}.json`);
    writeFileSync(
      reqFile,
      JSON.stringify({
        request_id: rid,
        status: 'pending',
        messages: [{ role: 'user', content: '你好' }],
        context: { forgekin_id: 'forgemind:luban', task_type: 'chat' },
        ...overrides,
      }),
      'utf-8',
    );
    return reqFile;
  }

  it('正常处理：写响应 + 清理 .processing + 统计计数', async () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('回答内容足够长') });
    const reqFile = writeRequestFile('rid-e2e');
    await op.handleRequestFile(reqFile);

    const respFile = path.join(sharedDir, 'responses', 'response_rid-e2e.json');
    expect(existsSync(respFile)).toBe(true);
    const resp = JSON.parse(readFileSync(respFile, 'utf-8'));
    expect(resp.request_id).toBe('rid-e2e');
    expect(resp.status).toBe('completed');
    expect(resp.content).toBe('回答内容足够长');
    expect(resp.tool_calls).toEqual([]);

    // .processing 与原文件均已清理
    expect(existsSync(reqFile)).toBe(false);
    expect(existsSync(`${reqFile}.processing`)).toBe(false);
    expect(op.stats.received).toBe(1);
    expect(op.stats.completed).toBe(1);
  });

  it('重命名失败（文件已不存在）直接跳过', async () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('x 内容足够长') });
    await op.handleRequestFile(path.join(sharedDir, 'requests', 'request_gone.json'));
    expect(op.stats.received).toBe(0);
  });

  it('坏 JSON → 删除 .processing 不崩溃', async () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('x 内容足够长') });
    const reqFile = path.join(sharedDir, 'requests', 'request_bad.json');
    writeFileSync(reqFile, '不是 JSON', 'utf-8');
    await op.handleRequestFile(reqFile);
    expect(existsSync(`${reqFile}.processing`)).toBe(false);
    expect(op.stats.received).toBe(0);
  });

  it('非 pending 状态跳过', async () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('x 内容足够长') });
    const reqFile = writeRequestFile('rid-done', { status: 'completed' });
    await op.handleRequestFile(reqFile);
    expect(op.stats.received).toBe(0);
    expect(existsSync(path.join(sharedDir, 'responses', 'response_rid-done.json'))).toBe(false);
  });

  it('重复 request_id 跳过（幂等）', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        return fetchOk('回答内容足够长');
      },
    });
    const reqFile = writeRequestFile('rid-dup');
    await op.handleRequestFile(reqFile);
    // 同一 rid 再次出现（例如重放）
    const reqFile2 = writeRequestFile('rid-dup');
    await op.handleRequestFile(reqFile2);
    expect(calls).toBe(1);
    expect(op.stats.received).toBe(1);
    expect(existsSync(`${reqFile2}.processing`)).toBe(false);
  });

  it('cancel 文件存在 → 跳过请求 + cancelled 计数（I8）', async () => {
    let calls = 0;
    const op = makeOperator({
      fetchFn: async () => {
        calls += 1;
        return fetchOk('x 内容足够长');
      },
    });
    const reqFile = writeRequestFile('rid-cancel');
    writeFileSync(
      path.join(sharedDir, 'cancels', 'cancel_rid-cancel.json'),
      JSON.stringify({ request_id: 'rid-cancel', reason: 'stop' }),
      'utf-8',
    );
    await op.handleRequestFile(reqFile);
    expect(calls).toBe(0);
    expect(op.stats.cancelled).toBe(1);
    expect(op.stats.received).toBe(1);
    expect(existsSync(`${reqFile}.processing`)).toBe(false);
  });

  it('request_id 为空 → 跳过', async () => {
    const op = makeOperator({ fetchFn: async () => fetchOk('x 内容足够长') });
    const reqFile = writeRequestFile('rid-empty', { request_id: '' });
    await op.handleRequestFile(reqFile);
    expect(op.stats.received).toBe(0);
  });
});

describe('start / stop 轮询循环', () => {
  it('start 幂等；轮询发现请求并处理；stop 软停止', async () => {
    let stopped = false;
    const op = new BridgeLLMOperator(makeTraeBridgeConfig({ shared_dir: sharedDir }), {
      fetchFn: async () => fetchOk('轮询回答内容够长'),
      sleepFn: async () => {
        if (!stopped && (op.stats['received'] ?? 0) >= 1) {
          stopped = true;
          void op.stop();
        }
      },
      pollInterval: 0.001,
      env: {},
    });
    await op.start();
    await op.start(); // 幂等
    expect(op.isRunning).toBe(true);

    writeFileSync(
      path.join(sharedDir, 'requests', 'request_rid-loop.json'),
      JSON.stringify({
        request_id: 'rid-loop',
        status: 'pending',
        messages: [{ role: 'user', content: 'q' }],
        context: {},
      }),
      'utf-8',
    );

    // 等待轮询处理完成（最多 2s）
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !existsSync(path.join(sharedDir, 'responses', 'response_rid-loop.json'))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await op.stop();
    expect(op.isRunning).toBe(false);
    expect(op.stats.completed).toBe(1);
    const resp = JSON.parse(
      readFileSync(path.join(sharedDir, 'responses', 'response_rid-loop.json'), 'utf-8'),
    );
    expect(resp.content).toBe('轮询回答内容够长');
  });
});
