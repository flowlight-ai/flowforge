/**
 * F198 Phase C AC-C4: agent-sessions-reader
 * 读取 ~/.claude/jobs/<shortId>/state.json，返回聚合的会话快照。
 * 用于 agent-sessions 域提供 Hub Oversight deep-dive 视图。
 *
 * 本地化自 clowder-ai `src/domains/terminal/agent-sessions-reader.ts`（T6.5）。
 * jobsDir 可注入（测试 / 非默认 HOME 场景）。
 *
 * @module @flowforge/limb-terminal/agent-sessions-reader
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_JOBS_DIR = join(homedir(), '.claude/jobs');

export interface AgentSessionSnapshot {
  daemonShortId: string;
  state: string;
  detail?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function readAgentSessions(jobsDir?: string): Promise<AgentSessionSnapshot[]> {
  const dir = jobsDir ?? DEFAULT_JOBS_DIR;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const sessions: AgentSessionSnapshot[] = [];
  for (const entry of entries) {
    const statePath = join(dir, entry, 'state.json');
    try {
      await stat(join(dir, entry)); // ensure it's a dir
      const raw = await readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw);
      sessions.push({
        daemonShortId: (parsed.daemonShort as string | undefined) ?? entry,
        state: (parsed.state as string | undefined) ?? 'unknown',
        ...(parsed.detail !== undefined ? { detail: parsed.detail as string } : {}),
        ...(parsed.cwd !== undefined ? { cwd: parsed.cwd as string } : {}),
        ...(parsed.createdAt !== undefined ? { createdAt: parsed.createdAt as string } : {}),
        ...(parsed.updatedAt !== undefined ? { updatedAt: parsed.updatedAt as string } : {}),
      });
    } catch {
      // Skip missing state.json or malformed JSON
    }
  }
  return sessions;
}
