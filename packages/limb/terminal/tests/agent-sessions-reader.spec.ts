/**
 * AgentSessionsReader 单元测试 — T6.5 agent-sessions-reader.ts
 * 覆盖：正常读取、缺目录返回空、malformed JSON 跳过、非目录跳过、daemonShort 缺省。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAgentSessions } from '../src/agent-sessions-reader.js';

describe('readAgentSessions', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ff-terminal-jobs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('读取 jobs 目录下的 state.json 快照', async () => {
    await mkdir(join(dir, 'short1'));
    await writeFile(
      join(dir, 'short1', 'state.json'),
      JSON.stringify({ daemonShort: 'short1', state: 'idle', detail: 'waiting', cwd: '/work', createdAt: 't1' }),
    );
    const sessions = await readAgentSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      daemonShortId: 'short1',
      state: 'idle',
      detail: 'waiting',
      cwd: '/work',
      createdAt: 't1',
    });
  });

  it('daemonShort 缺省为目录名；state 缺省为 unknown', async () => {
    await mkdir(join(dir, 'short2'));
    await writeFile(join(dir, 'short2', 'state.json'), JSON.stringify({}));
    const sessions = await readAgentSessions(dir);
    expect(sessions[0]?.daemonShortId).toBe('short2');
    expect(sessions[0]?.state).toBe('unknown');
  });

  it('目录不存在返回空数组', async () => {
    const sessions = await readAgentSessions(join(dir, 'missing'));
    expect(sessions).toEqual([]);
  });

  it('malformed JSON 跳过该条目', async () => {
    await mkdir(join(dir, 'bad'));
    await writeFile(join(dir, 'bad', 'state.json'), '{ not json');
    await mkdir(join(dir, 'good'));
    await writeFile(join(dir, 'good', 'state.json'), JSON.stringify({ state: 'running' }));
    const sessions = await readAgentSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.daemonShortId).toBe('good');
  });

  it('非目录条目（缺 state.json）跳过', async () => {
    await writeFile(join(dir, 'file-entry'), 'x');
    const sessions = await readAgentSessions(dir);
    expect(sessions).toEqual([]);
  });
});
