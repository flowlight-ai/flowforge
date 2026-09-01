/**
 * 浏览器安全 `@file` token 语法 — terminal 与 web 客户端共用（dsh 移植，D39）。
 * @module @flowforge/context-file-reference/grammar
 */

import type { FileReferenceCandidate } from './types.ts';

/** 光标处的活跃 `@` token。 */
export interface ActiveAtToken {
  /** 用户接受完成时替换的完整 token。 */
  prefix: string;
  /** `@` 或 `@"` 之后的路径查询。 */
  query: string;
  /** 用户是否打开了带引号路径。 */
  quoted: boolean;
}

/**
 * 提取光标处的 `@path` 或 `@"path with spaces"` token。
 * 其他 token 内的 `@`（如邮箱地址）不是完成触发。
 */
export function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol);
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true };
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined;
  return { prefix: plain[1], query: plain[2], quoted: false };
}

/**
 * 将选中路径格式化为提示文本。空白路径用 `@"path"` 引号语法；
 * 引用的目录在其尾斜杠后保持引号打开以便完成降级一层。
 * @returns 插入值；编辑器语法无法安全表示的路径返回 undefined。
 */
export function formatFileMention(candidate: FileReferenceCandidate, preserveQuote: boolean): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path;
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;
  const quoted = preserveQuote || /\s/u.test(path);
  if (!quoted) return `@${path}`;
  if (candidate.kind === 'directory') return `@"${path}`;
  return `@"${path}"`;
}
