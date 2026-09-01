/**
 * 文件引用发现类型 — 仅类型（供生成的 Remote 客户端消费）。
 * @module @flowforge/context-file-reference/types
 */

/** 目标 session cwd 内的一个 path-only 完成候选。 */
export interface FileReferenceCandidate {
  /** 用户可见路径（普通提示与文件系统工具接受）。 */
  path: string;
  /** 目录保持完成打开；文件结束 mention。 */
  kind: 'file' | 'directory';
}
