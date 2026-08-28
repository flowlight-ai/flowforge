/**
 * @flowforge/cats-workspace — F063 workspace Cordis 插件（C28）。
 *
 * TS 移植自 clowder-ai `domains/workspace`（7 文件）：
 *   - security：traversal/symlink-escape/denylist 三重防护 + worktree/linked-root 注册表
 *   - git-worktree-probe：git 探测（GitRunner 注入，缺省 nodeGitRunner）
 *   - path-resolution：绝对路径 / Markdown href → typed target
 *   - edit：HMAC 编辑会话 token + sha256 冲突检测原子写（F063 AC-9）
 *   - file-read：内存有界预览 + 二进制分类（F063 OOM 修复）
 *   - watcher：文件变更监听（socket.io 剥离为端口接口）
 *   - navigation-delivery：导航投递回执聚合（emitter 注入）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsWorkspace from '@flowforge/cats-workspace'
 * ctx.plugin(CatsWorkspace)
 * // ctx.catsWorkspace.createSecurity(opts) / .createEditSession(opts) / .setupFileWatcher(server)
 * ```
 *
 * @module @flowforge/cats-workspace
 */

import { Context, Service } from '@flowforge/cordis';

import { WorkspaceSecurity, WorkspaceSecurityError } from './security.js';
import type { WorktreeEntry, WorkspaceSecurityOptions } from './security.js';
import { EditSession } from './edit.js';
import type { EditSessionOptions, WriteConflict, WriteResult } from './edit.js';
import { resolveWorkspaceAbsolutePath, resolveWorkspaceDocumentHref } from './path-resolution.js';
import type { WorkspaceAbsolutePathTarget, WorkspaceDocumentTarget } from './path-resolution.js';
import {
  computeWorkspaceFileSha256,
  guessMime,
  isKnownBinaryPath,
  MAX_PREVIEW_BYTES,
  readWorkspaceFilePreview,
} from './file-read.js';
import type { WorkspaceFilePreview } from './file-read.js';
import { setupWorkspaceFileWatcher } from './watcher.js';
import type { WorkspaceLogger, WorkspaceSocket, WorkspaceSocketServer } from './watcher.js';
import {
  aggregateWorkspaceNavigationReceipts,
  emitWorkspaceNavigate,
  WORKSPACE_NAVIGATION_ACK_ROOM,
} from './navigation-delivery.js';
import type {
  WorkspaceNavigationDeliveryStatus,
  WorkspaceNavigationEmitter,
} from './navigation-delivery.js';

// Re-export 核心实现 + 类型。
export { WorkspaceSecurity, WorkspaceSecurityError };
export type { WorktreeEntry, WorkspaceSecurityOptions };
export { EditSession };
export type { EditSessionOptions, WriteConflict, WriteResult };
export { resolveWorkspaceAbsolutePath, resolveWorkspaceDocumentHref };
export type { WorkspaceAbsolutePathTarget, WorkspaceDocumentTarget };
export {
  computeWorkspaceFileSha256,
  guessMime,
  isKnownBinaryPath,
  MAX_PREVIEW_BYTES,
  readWorkspaceFilePreview,
};
export type { WorkspaceFilePreview };
export { setupWorkspaceFileWatcher };
export type { WorkspaceLogger, WorkspaceSocketServer, WorkspaceSocket };
export { aggregateWorkspaceNavigationReceipts, emitWorkspaceNavigate, WORKSPACE_NAVIGATION_ACK_ROOM };
export type { WorkspaceNavigationDeliveryStatus, WorkspaceNavigationEmitter };
export type { GitRunner, GitResult } from './git-worktree-probe.js';
export { nodeGitRunner, readGitWorktreeList } from './git-worktree-probe.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** workspace 域（F063）：security / edit-session / file 读写 / watcher / navigation 工厂 */
    catsWorkspace: WorkspaceService;
  }
}

/**
 * workspace 域服务 — 组装 F063 security / edit / file-read / watcher 工厂。
 *
 * 挂载 `ctx.catsWorkspace`，提供：
 *   - createSecurity(opts?)：安全层（worktree 注册表 + linked roots，GitRunner 注入）
 *   - createEditSession(opts?)：HMAC token + 冲突检测写
 *   - setupFileWatcher(server, security?, logger?)：文件变更监听（socket 端口）
 *   - resolveAbsolutePath / resolveDocumentHref：绝对路径 / href 解析
 */
export class WorkspaceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'catsWorkspace');
  }

  /** 创建 workspace 安全层（cwd/env/GitRunner 可注入）。 */
  createSecurity(options: WorkspaceSecurityOptions = {}): WorkspaceSecurity {
    return new WorkspaceSecurity(options);
  }

  /** 创建编辑会话（secret/ttl/now 可注入）。 */
  createEditSession(options: EditSessionOptions = {}): EditSession {
    return new EditSession(options);
  }

  /** 挂载文件 watcher 到 socket server（socket.io 端口接口）。 */
  setupFileWatcher(
    server: WorkspaceSocketServer,
    security: WorkspaceSecurity,
    logger?: WorkspaceLogger,
  ): void {
    setupWorkspaceFileWatcher(server, security, logger);
  }

  /** 解析 Codex 原生绝对路径 → typed Workspace target。 */
  resolveAbsolutePath(
    security: WorkspaceSecurity,
    absolutePath: string,
    repoRoot?: string,
  ): Promise<WorkspaceAbsolutePathTarget> {
    return resolveWorkspaceAbsolutePath(security, absolutePath, repoRoot);
  }

  /** 解析 Markdown 文档链接（含可选 :line）→ typed target。 */
  resolveDocumentHref(
    security: WorkspaceSecurity,
    href: string,
    repoRoot?: string,
  ): Promise<WorkspaceDocumentTarget> {
    return resolveWorkspaceDocumentHref(security, href, repoRoot);
  }
}

export default WorkspaceService;
