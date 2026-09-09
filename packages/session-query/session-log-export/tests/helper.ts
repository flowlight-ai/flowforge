/** 契约测试共享的内存夹具构造器。 */

import type { SessionFormatHeader } from '@flowforge/session-format'

/** 构造一个最小合法会话头；提供可选的 `version` / `delegationDepth` 等覆盖。 */
export function makeHeader(
  overrides: {
    version?: number
    id?: string
    createdAt?: number
    isSeeded?: boolean
    delegationDepth?: number
    cwd?: string
    parentSession?: string
    origin?: 'subagent'
    agentPreset?: string
  } = {},
): SessionFormatHeader {
  return {
    version: overrides.version ?? 2,
    id: overrides.id ?? 'root',
    createdAt: overrides.createdAt ?? 0,
    isSeeded: overrides.isSeeded ?? false,
    delegationDepth: overrides.delegationDepth ?? 0,
    ...overrides.cwd !== undefined ? { cwd: overrides.cwd } : {},
    ...overrides.parentSession !== undefined ? { parentSession: overrides.parentSession } : {},
    ...overrides.origin !== undefined ? { origin: overrides.origin } : {},
    ...overrides.agentPreset !== undefined ? { agentPreset: overrides.agentPreset } : {},
  }
}

/** 构造一条最小合法事件。 */
export function makeEvent(seq: number, data: unknown, type = 'message'): SessionFormatEvent {
  return { type, seq, time: seq + 1, data }
}

/** 一个携带图片块引用的内容块。 */
export function imageBlock(id: string, mediaType: string): {
  type: 'image'
  attachment: { attachmentId: string; mediaType: string }
} {
  return { type: 'image', attachment: { attachmentId: id, mediaType } }
}

/** 一个携带文件块引用的内容块。 */
export function fileBlock(id: string, name: string): {
  type: 'file'
  attachment: { attachmentId: string; name: string }
} {
  return { type: 'file', attachment: { attachmentId: id, name } }
}

/** 把一个携带附件块的内容数组包装进一个事件。 */
export function contentEvent(seq: number, content: unknown[]): SessionFormatEvent {
  return makeEvent(seq, { content })
}