/**
 * protocol — TraeBridgeProtocol 协议层契约验证（对齐 Python protocol.py）。
 *
 * 覆盖 F045 §2.3 不变量：I1 UUID4 唯一 / I2 请求-响应配对 / I3 超时保证 /
 * I4 归档不丢数据 / I7 status.json 可见性 / I8 逃生舱。
 *
 * 测试注入：sleepFn 推进假时钟（无真实等待）+ nowMsFn 读假时钟。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTraeBridgeConfig, type TraeBridgeConfig } from '../src/config.js';
import {
  TraeBridgeCancelledError,
  TraeBridgeProtocolError,
  TraeBridgeTimeoutError,
} from '../src/errors.js';
import { makeBridgeRequestContext } from '../src/models.js';
import { TraeBridgeProtocol } from '../src/protocol.js';

/** 假时钟：sleepFn 推进时钟，轮询超时测试无真实等待 */
function makeFakeClock(startMs = 0): {
  nowMs: () => number;
  sleep: (seconds: number) => Promise<void>;
  elapsed: () => number;
} {
  let current = startMs;
  return {
    nowMs: () => current,
    sleep: async (seconds) => {
      current += seconds * 1000;
    },
    elapsed: () => current,
  };
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const tmpDirs: string[] = [];
let sharedDir: string;

function makeConfig(overrides: Partial<TraeBridgeConfig> = {}): TraeBridgeConfig {
  return makeTraeBridgeConfig({ shared_dir: sharedDir, ...overrides });
}

function makeProtocol(
  overrides: Partial<TraeBridgeConfig> = {},
  clock = makeFakeClock(),
): TraeBridgeProtocol {
  return new TraeBridgeProtocol(makeConfig(overrides), {
    sleepFn: clock.sleep,
    nowMsFn: clock.nowMs,
    logger: silentLogger,
  });
}

const testContext = (): ReturnType<typeof makeBridgeRequestContext> =>
  makeBridgeRequestContext({ forgekin_id: 'forgemind:luban', task_type: 'chat' });

beforeEach(() => {
  sharedDir = mkdtempSync(path.join(os.tmpdir(), 'trae-bridge-proto-'));
  tmpDirs.push(sharedDir);
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('目录初始化', () => {
  it('构造时创建六个目录', () => {
    makeProtocol();
    for (const sub of ['requests', 'responses', 'cancels', 'acks', 'archive']) {
      expect(existsSync(path.join(sharedDir, sub))).toBe(true);
    }
    expect(existsSync(sharedDir)).toBe(true);
  });

  it('cleanup_on_startup 把遗留 pending 标记为 timeout（不变量 3）', () => {
    const proto = makeProtocol();
    // 先写入一个 pending 请求
    writeFileSync(
      path.join(sharedDir, 'requests', 'request_old.json'),
      JSON.stringify({ request_id: 'old', status: 'pending', timeout_seconds: 300 }),
      'utf-8',
    );
    // 新实例启用清理
    makeProtocol({ cleanup_on_startup: true });
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_old.json'), 'utf-8'),
    );
    expect(data.status).toBe('timeout');
    expect(typeof data.timeout_at).toBe('string');
    expect(proto).toBeDefined();
  });
});

describe('writeRequest（不变量 1 + 7）', () => {
  it('写入 request_{uuid}.json + status.json pending 计数', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: '你好' }], testContext());
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);

    const requestFile = path.join(sharedDir, 'requests', `request_${rid}.json`);
    const data = JSON.parse(readFileSync(requestFile, 'utf-8'));
    expect(data.request_id).toBe(rid);
    expect(data.status).toBe('pending');
    expect(data.timeout_seconds).toBe(300);
    expect(data.context.forgekin_id).toBe('forgemind:luban');
    expect(data.messages[0]).toEqual({ role: 'user', content: '你好' });

    const status = proto.getStatus();
    expect(status.pending_count).toBe(1);
    expect(status.last_activity_at).not.toBeNull();
  });

  it('显式 requestId / sessionId / timeoutSeconds 透传', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest(
      [{ role: 'user', content: 'x' }],
      testContext(),
      { requestId: 'task-abc', sessionId: 'sess-1', timeoutSeconds: 99 },
    );
    expect(rid).toBe('task-abc');
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', 'request_task-abc.json'), 'utf-8'),
    );
    expect(data.session_id).toBe('sess-1');
    expect(data.timeout_seconds).toBe(99);
  });

  it('空 messages / 非法 role 抛 ProtocolError', async () => {
    const proto = makeProtocol();
    await expect(proto.writeRequest([], testContext())).rejects.toThrow(
      TraeBridgeProtocolError,
    );
    await expect(
      proto.writeRequest([{ role: 'tool', content: 'x' }], testContext()),
    ).rejects.toThrow(TraeBridgeProtocolError);
  });

  it('update_status_on_write=false 时不写 status', async () => {
    const proto = makeProtocol({ update_status_on_write: false });
    await proto.writeRequest([{ role: 'user', content: 'x' }], testContext());
    expect(existsSync(path.join(sharedDir, 'status.json'))).toBe(false);
  });
});

describe('pollResponse（不变量 2 + 3 + 8）', () => {
  it('正常响应：解析 + 归档 + completed 计数（I2/I4/I7）', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    // operator 回写响应
    writeFileSync(
      path.join(sharedDir, 'responses', `response_${rid}.json`),
      JSON.stringify({
        request_id: rid,
        content: '回答',
        status: 'completed',
        model: 'Doubao-Seed2.0',
        usage: { total_tokens: 5 },
        completed_at: '2026-08-21T00:00:00.000Z',
      }),
      'utf-8',
    );

    const response = await proto.pollResponse(rid);
    expect(response.content).toBe('回答');
    expect(response.model).toBe('Doubao-Seed2.0');

    // I4 归档：request/response 离开原目录进入 archive/
    expect(existsSync(path.join(sharedDir, 'requests', `request_${rid}.json`))).toBe(false);
    expect(existsSync(path.join(sharedDir, 'responses', `response_${rid}.json`))).toBe(false);
    const archived = readdirSync(path.join(sharedDir, 'archive'));
    expect(archived).toHaveLength(2);
    expect(archived.every((name) => name.includes(rid.slice(0, 8)))).toBe(true);

    expect(proto.getStatus().completed_total).toBe(1);
  });

  it('response request_id 不匹配抛 ProtocolError（I2 配对校验）', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    writeFileSync(
      path.join(sharedDir, 'responses', `response_${rid}.json`),
      JSON.stringify({ request_id: 'other-id', content: '', status: 'completed' }),
      'utf-8',
    );
    await expect(proto.pollResponse(rid)).rejects.toThrow(/不匹配/);
  });

  it('响应 status=error → 归档 + completed 计数 + 抛 ProtocolError', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    writeFileSync(
      path.join(sharedDir, 'responses', `response_${rid}.json`),
      JSON.stringify({ request_id: rid, content: '', status: 'error', error: 'LLM 挂了' }),
      'utf-8',
    );
    await expect(proto.pollResponse(rid)).rejects.toThrow(/LLM 调用错误: LLM 挂了/);
    expect(proto.getStatus().completed_total).toBe(1);
  });

  it('cancel 文件 → 抛 CancelledError + request 标 cancelled + 计数（I8）', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    await proto.writeCancel(rid, 'operator 手动取消');

    await expect(proto.pollResponse(rid)).rejects.toThrow(TraeBridgeCancelledError);
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', `request_${rid}.json`), 'utf-8'),
    );
    expect(data.status).toBe('cancelled');
    expect(typeof data.cancelled_at).toBe('string');
    expect(proto.getStatus().cancelled_total).toBe(1);
  });

  it('cancel 优先于 response 检测（每轮先查 cancel）', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    writeFileSync(
      path.join(sharedDir, 'responses', `response_${rid}.json`),
      JSON.stringify({ request_id: rid, content: 'ok', status: 'completed' }),
      'utf-8',
    );
    await proto.writeCancel(rid, 'stop');
    await expect(proto.pollResponse(rid)).rejects.toThrow(TraeBridgeCancelledError);
  });

  it('超时 → request 标 timeout + timeout_at + 计数 + 抛 TimeoutError（I3）', async () => {
    const clock = makeFakeClock();
    const proto = makeProtocol({ poll_interval_seconds: 2, default_timeout_seconds: 5 }, clock);
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());

    await expect(proto.pollResponse(rid)).rejects.toThrow(TraeBridgeTimeoutError);
    // 假时钟推进：2s 间隔 × 3 轮 > 5s 超时
    expect(clock.elapsed()).toBeGreaterThanOrEqual(5000);

    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'requests', `request_${rid}.json`), 'utf-8'),
    );
    expect(data.status).toBe('timeout');
    expect(typeof data.timeout_at).toBe('string');
    expect(proto.getStatus().timeout_total).toBe(1);
  });

  it('timeout 解析优先级：参数 > request 文件 > config 默认', async () => {
    const proto = makeProtocol();
    const rid = await proto.writeRequest(
      [{ role: 'user', content: 'q' }],
      testContext(),
      { timeoutSeconds: 77 },
    );
    expect(proto.readRequestTimeout(rid)).toBe(77);
    expect(proto.readRequestTimeout('missing')).toBeNull();
  });
});

describe('parseResponse', () => {
  it('转换为标准 LLM 返回格式（provider=trae + tool_calls 兜底 []）', () => {
    const proto = makeProtocol();
    const result = proto.parseResponse({
      request_id: 'rid-1',
      content: 'hi',
      status: 'completed',
      model: 'trae',
      usage: { total_tokens: 1 },
      tool_calls: null,
      error: '',
      completed_at: '2026-08-21T00:00:00.000Z',
    });
    expect(result).toMatchObject({
      content: 'hi',
      model: 'trae',
      tool_calls: [],
      provider: 'trae',
      request_id: 'rid-1',
      completed_at: '2026-08-21T00:00:00.000Z',
    });
  });
});

describe('归档上限（不变量 4）', () => {
  it('enforce_archive_limit 保留最近 max_archive_files 个', async () => {
    const proto = makeProtocol({ max_archive_files: 2 });
    for (const rid of ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3']) {
      await proto.writeRequest(
        [{ role: 'user', content: 'q' }],
        testContext(),
        { requestId: rid },
      );
      writeFileSync(
        path.join(sharedDir, 'responses', `response_${rid}.json`),
        JSON.stringify({ request_id: rid, content: 'ok', status: 'completed' }),
        'utf-8',
      );
      await proto.archiveRequestResponse(rid);
    }
    const archived = readdirSync(path.join(sharedDir, 'archive'));
    expect(archived.length).toBeLessThanOrEqual(2);
  });

  it('archive_completed=false 时不归档', async () => {
    const proto = makeProtocol({ archive_completed: false });
    const rid = await proto.writeRequest([{ role: 'user', content: 'q' }], testContext());
    await proto.archiveRequestResponse(rid);
    expect(existsSync(path.join(sharedDir, 'requests', `request_${rid}.json`))).toBe(true);
  });
});

describe('writeCancel / healthCheck / listPendingRequests', () => {
  it('writeCancel 写入 cancel 文件', async () => {
    const proto = makeProtocol();
    await proto.writeCancel('rid-1', '原因', 'test');
    const data = JSON.parse(
      readFileSync(path.join(sharedDir, 'cancels', 'cancel_rid-1.json'), 'utf-8'),
    );
    expect(data.reason).toBe('原因');
    expect(data.cancelled_by).toBe('test');
  });

  it('healthCheck 可读写目录返回 true', async () => {
    const proto = makeProtocol();
    expect(await proto.healthCheck()).toBe(true);
    expect(existsSync(path.join(sharedDir, 'requests', '.health_check'))).toBe(false);
  });

  it('listPendingRequests 按 created_at 升序 + 字段完整', async () => {
    // 注入真实时钟保证两次写入的 created_at 单调递增（默认假时钟恒为 0）
    const proto = makeProtocol({}, {
      nowMs: () => Date.now(),
      sleep: async () => {},
      elapsed: () => 0,
    });
    await proto.writeRequest(
      [{ role: 'user', content: 'q2' }],
      makeBridgeRequestContext({ forgekin_id: 'f:second', task_type: 'review_code' }),
      { requestId: 'rid-2' },
    );
    // 手工改写 created_at 让 rid-1 更早
    const rid1File = path.join(sharedDir, 'requests', 'request_rid-1.json');
    await proto.writeRequest(
      [{ role: 'user', content: 'q1' }],
      makeBridgeRequestContext({ forgekin_id: 'f:first' }),
      { requestId: 'rid-1' },
    );
    const data = JSON.parse(readFileSync(rid1File, 'utf-8'));
    data.created_at = '2020-01-01T00:00:00.000Z';
    writeFileSync(rid1File, JSON.stringify(data, null, 2), 'utf-8');

    const pending = proto.listPendingRequests();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.['request_id']).toBe('rid-1');
    expect(pending[0]).toMatchObject({
      forgekin_id: 'f:first',
      task_type: 'chat',
      file: 'request_rid-1.json',
    });
    expect(pending[1]?.['task_type']).toBe('review_code');
  });
});

describe('updateRequestStatus 边界', () => {
  it('请求文件不存在时静默返回', async () => {
    const proto = makeProtocol();
    await expect(proto.updateRequestStatus('missing', 'timeout')).resolves.toBeUndefined();
  });
});
