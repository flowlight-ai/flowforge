/**
 * @flowforge/cats-workspace — 文件变更 watcher（socket.io 剥离）。
 *
 * TS 移植自 clowder-ai `domains/workspace/workspace-file-watcher.ts`：
 * fs.watch + debounce(300ms) + sha 轮询兜底，watch/unwatch 生命周期按 socket 管理。
 * 插件化改造：socket.io `Server`/`Socket` 类型剥离为 `WorkspaceSocketServer` /
 * `WorkspaceSocket` 端口接口（socket.io 实例天然兼容，无需依赖 socket.io 包）；
 * pino logger 剥离为 `WorkspaceLogger` 端口（缺省 console）。
 *
 * @module @flowforge/cats-workspace/watcher
 */

import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { computeWorkspaceFileSha256 } from './file-read.js';
import type { WorkspaceSecurity } from './security.js';

const DEBOUNCE_MS = 300;
const POLL_FALLBACK_MS = 150;
const WATCHDOG_POLL_MS = 1000;

/** 最小 socket server 端口（socket.io Server 天然满足）。 */
export interface WorkspaceSocketServer {
  on(event: 'connection', listener: (socket: WorkspaceSocket) => void): void;
}

/** 最小 socket 端口（socket.io Socket 天然满足）。 */
export interface WorkspaceSocket {
  id: string;
  on(event: string, listener: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
}

/** 日志端口（缺省 console；host 可接 pino/自定义）。 */
export interface WorkspaceLogger {
  debug(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

const consoleLogger: WorkspaceLogger = {
  debug: (obj, msg) => console.debug(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
};

interface WatchEntry {
  stop: () => void;
  worktreeId: string;
  path: string;
  absolutePath: string;
  lastSha256: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

function startFileMonitor(
  parentDir: string,
  onFsEvent: () => void,
  onPoll: () => void,
  logger: WorkspaceLogger,
): () => void {
  let poller: ReturnType<typeof setInterval> | null = null;
  const startPolling = (intervalMs: number) => {
    if (poller) return;
    poller = setInterval(onPoll, intervalMs);
    poller.unref?.();
  };

  try {
    const watcher = watch(parentDir, { persistent: false }, onFsEvent);
    // fs.watch 高负载下可能静默漏掉 atomic-save 事件；低频 sha 轮询保活
    startPolling(WATCHDOG_POLL_MS);
    watcher.on('error', (err) => {
      logger.warn({ parentDir, err }, 'fs.watch failed, falling back to polling');
      watcher.close();
    });
    return () => {
      watcher.close();
      if (poller) clearInterval(poller);
    };
  } catch (err) {
    logger.warn({ parentDir, err }, 'fs.watch unavailable, falling back to polling');
    startPolling(POLL_FALLBACK_MS);
    return () => {
      if (poller) clearInterval(poller);
    };
  }
}

/**
 * 挂载文件 watcher 到 socket server：
 * `workspace:watch-file`（worktreeId/path/sha256）→ 立即签名对比 + fs.watch 监听；
 * `workspace:unwatch-file` / disconnect → 清理。
 * security 注入（root 解析 + 路径校验）。
 */
export function setupWorkspaceFileWatcher(
  server: WorkspaceSocketServer,
  security: WorkspaceSecurity,
  logger: WorkspaceLogger = consoleLogger,
): void {
  const socketWatchers = new Map<string, WatchEntry>();

  server.on('connection', (socket: WorkspaceSocket) => {
    socket.on('workspace:watch-file', async (rawData: unknown) => {
      const data = rawData as { worktreeId?: string; path?: string; sha256?: string };
      if (!data?.worktreeId || !data?.path) return;

      cleanupSocket(socket.id);

      try {
        const root = await security.getWorktreeRoot(data.worktreeId);
        const absolutePath = await security.resolveWorkspaceFilesystemPath(root, data.path);
        await stat(absolutePath);

        const currentSha = (await computeWorkspaceFileSha256(absolutePath)) || '';
        const parentDir = dirname(absolutePath);

        const entry: WatchEntry = {
          stop: () => {},
          worktreeId: data.worktreeId,
          path: data.path,
          absolutePath,
          lastSha256: currentSha,
          debounceTimer: null,
        };

        const scheduleChange = () => {
          // atomic-save 流程可能只上报临时文件名；下方 sha 检查抑制无关事件
          if (socketWatchers.get(socket.id) !== entry) return;
          if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
          entry.debounceTimer = setTimeout(() => handleChange(socket, entry), DEBOUNCE_MS);
        };

        const stop = startFileMonitor(
          parentDir,
          scheduleChange,
          () => {
            if (socketWatchers.get(socket.id) !== entry) return;
            void handleChange(socket, entry);
          },
          logger,
        );

        entry.stop = stop;
        socketWatchers.set(socket.id, entry);

        logger.debug({ socketId: socket.id, path: data.path }, 'Watching file');

        if (currentSha && data.sha256 !== currentSha) {
          socket.emit('workspace:file-changed', {
            worktreeId: data.worktreeId,
            path: data.path,
            sha256: currentSha,
          });
          logger.debug({ socketId: socket.id, path: data.path }, 'Immediate sha mismatch, notified client');
        }
      } catch (e) {
        logger.debug({ socketId: socket.id, path: data.path, err: e }, 'Failed to watch file');
      }
    });

    socket.on('workspace:unwatch-file', () => {
      cleanupSocket(socket.id);
    });

    socket.on('disconnect', () => {
      cleanupSocket(socket.id);
    });
  });

  async function handleChange(socket: WorkspaceSocket, entry: WatchEntry): Promise<void> {
    const newSha = await computeWorkspaceFileSha256(entry.absolutePath);
    if (!newSha || newSha === entry.lastSha256) return;

    entry.lastSha256 = newSha;

    socket.emit('workspace:file-changed', {
      worktreeId: entry.worktreeId,
      path: entry.path,
      sha256: newSha,
    });
    logger.debug({ socketId: socket.id, path: entry.path }, 'File changed, notified client');
  }

  function cleanupSocket(socketId: string): void {
    const entry = socketWatchers.get(socketId);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.stop();
    socketWatchers.delete(socketId);
  }
}
