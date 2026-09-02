/**
 * @flowforge/context-file-reference — 文件引用发现接缝（dsh 移植，D39）。
 *
 * 供宿主驱动的 UI 做 `@path` / `@"path with spaces"` 完成：
 *   - FileReferenceCandidate：path-only 完成候选（kind: file|directory）
 *   - activeAtToken / formatFileMention：`@file` token 语法（浏览器安全，
 *     terminal 与 web 客户端共用）
 *   - FILE_REFERENCE_PROMPT：模型引导文案
 *   - FileReferenceService（抽象）：ctx.fileReferences 可取消发现服务
 *
 * @module @flowforge/context-file-reference
 */

import { Context, Service } from '@flowforge/cordis';

import type { FileReferenceCandidate } from './types.ts';

export { activeAtToken, formatFileMention } from './grammar.ts';
export type { ActiveAtToken } from './grammar.ts';
export type { FileReferenceCandidate } from './types.ts';

/** Model guidance for path-only references selected by a user interface. */
export const FILE_REFERENCE_PROMPT =
  'Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.';

declare module '@flowforge/cordis' {
  interface Context {
    fileReferences: FileReferenceService;
  }
}

/** 宿主能力：可取消的文件引用发现。 */
export abstract class FileReferenceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileReferences');
  }

  /**
   * 为一个 agent 的工作目录列出文件/目录候选。
   * @param cwd - 目标 session 工作目录（发现边界）。
   * @param query - `@` 或 `@"` 之后的路径文本。
   * @param signal - 调用方取消。
   */
  abstract list(cwd: string, query: string, signal: AbortSignal): Promise<FileReferenceCandidate[]>;
}

export default FileReferenceService;
