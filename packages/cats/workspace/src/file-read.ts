/**
 * @flowforge/cats-workspace — 内存有界文件读取（F063 OOM 修复）。
 *
 * TS 移植自 clowder-ai `domains/workspace/workspace-file-read.ts`：
 * 预览与 watcher 共用的有界读取 + 二进制分类（扩展名/MIME 优先，NUL 字节兜底），
 * 大文件/二进制文件 sha256 返回 '' 保证路由与 watcher 判定一致。
 * 纯函数（无状态），直接可测。
 *
 * @module @flowforge/cats-workspace/file-read
 */

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { extname } from 'node:path';

/** 文本预览 / hash 读入内存的硬上限。 */
export const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB

const MIME_MAP: Record<string, string> = {
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.js': 'text/javascript',
  '.jsx': 'text/jsx',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** 按扩展名猜测 MIME；未知返回 'text/plain'。 */
export function guessMime(filepath: string): string {
  return MIME_MAP[extname(filepath)] ?? 'text/plain';
}

function isMediaMime(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/');
}

/**
 * 扩展名是否映射到媒体（image/audio/video）MIME。
 * 这是路由与 watcher 共享的 known-binary 判定，两者必须一致。
 */
export function isKnownBinaryPath(absPath: string): boolean {
  return isMediaMime(guessMime(absPath));
}

export interface WorkspaceFilePreview {
  /** 解码后的文本内容，有界于 maxBytes；二进制文件为空。 */
  content: string;
  /**
   * 完整读取文本文件的 sha256；二进制或截断文件为 ''。
   * 空值使路由与 watcher 同步，大/二进制文件不会误报 "externally changed"。
   */
  sha256: string;
  /** 真实文件字节数（stat，而非有界读取）。 */
  size: number;
  /** size 超过 maxBytes 时为 true（content 是有界前缀）。 */
  truncated: boolean;
  /** 检测为二进制（known media MIME 或 NUL 字节）时为 true。 */
  binary: boolean;
  /** 扩展名猜测的 MIME（未知 'text/plain'）。 */
  mime: string;
}

function hashUtf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 从文件头读取至多 byteCount 字节。无论真实文件多大，内存占用不超过 byteCount。
 */
async function readPrefix(absPath: string, byteCount: number): Promise<Buffer> {
  if (byteCount <= 0) return Buffer.alloc(0);
  const handle = await open(absPath, 'r');
  try {
    const buf = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buf, 0, byteCount, 0);
    return bytesRead === byteCount ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** 启发式二进制嗅探：前缀中出现 NUL 字节即二进制（与 git 同规则）。 */
function looksBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/**
 * 内存有界预览。最多读 maxBytes，大文件或误判二进制（未知扩展名的视频）
 * 永远不会 OOM。二进制判定与 {@link isKnownBinaryPath} 一致（known media
 * 扩展名优先，NUL 字节内容嗅探兜底），与 watcher 签名逻辑相同。
 */
export async function readWorkspaceFilePreview(
  absPath: string,
  opts: { maxBytes?: number } = {},
): Promise<WorkspaceFilePreview> {
  const maxBytes = opts.maxBytes ?? MAX_PREVIEW_BYTES;
  const { size } = await stat(absPath);
  const mime = guessMime(absPath);

  if (isMediaMime(mime)) {
    return { content: '', sha256: '', size, truncated: false, binary: true, mime };
  }

  const truncated = size > maxBytes;
  const prefix = await readPrefix(absPath, Math.min(size, maxBytes));

  if (looksBinary(prefix)) {
    return { content: '', sha256: '', size, truncated: false, binary: true, mime };
  }

  const content = prefix.toString('utf-8');
  return {
    content,
    sha256: truncated ? '' : hashUtf8(content),
    size,
    truncated,
    binary: false,
    mime,
  };
}

/**
 * 文件变更检测签名（watcher 用）。返回：
 *  - 小文本文件的全量内容 sha256，
 *  - known-media / 二进制 / 超限文件 ''（不跟踪——不可编辑），
 *  - 读错误 null（调用方视为"无签名"）。
 *
 * 与 {@link readWorkspaceFilePreview} 使用同一二进制判定 + 同一上限，
 * 路由与 watcher 对文件 hash 判定永远一致，小媒体文件不会触发虚假变更事件。
 */
export async function computeWorkspaceFileSha256(
  absPath: string,
  maxBytes = MAX_PREVIEW_BYTES,
): Promise<string | null> {
  try {
    const { size } = await stat(absPath);
    if (size > maxBytes) return '';
    if (isKnownBinaryPath(absPath)) return '';
    const prefix = await readPrefix(absPath, Math.min(size, maxBytes));
    if (looksBinary(prefix)) return '';
    return hashUtf8(prefix.toString('utf-8'));
  } catch {
    return null;
  }
}
