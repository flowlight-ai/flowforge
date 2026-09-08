/**
 * 导出所需的只读数据端口（会话日志源 / 附件存储 / 血缘）及其真实内存实现。
 *
 * dsh 的 `archive.ts` 直接依赖 `dsh-session-persistence`（ReadHandle 读取）、
 * `dsh-attachment`（AttachmentStore）、`dsh-session-query`（血缘追踪）。本包把
 * 这三类读取窄化为包内最小注入端口：都不携带任何 dsh 运行时代码，契约测试直接
 * 使用各自内存实现（铁律 T9）。附件的 `ImageAttachmentRef` / `FileAttachmentRef`
 * 契型也在包内重建，供纯 zip 路径计算使用。
 *
 * `@flowforge/session-format` 的 `SessionFormatHeader` / `SessionFormatEvent` 即
 * dsh 的 `SessionHeader` / `SessionEvent`，此处建立类型别名以保留 archive 侧命名。
 */

import type { SessionFormatHeader, SessionFormatEvent } from '@flowforge/session-format'

/** 会话逻辑头（等价于 flowforge 的 `SessionFormatHeader`）。 */
export type SessionHeader = SessionFormatHeader

/** 一条已提交的逻辑事件（等价于 flowforge 的 `SessionFormatEvent`）。 */
export type SessionEvent = SessionFormatEvent

/** 光栅媒体类型（与附件网格一致）。 */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 一张不可变图片的持久化引用契约（包内重建，不含运行时实现依赖）。 */
export interface ImageAttachmentRef {
  /** 不透明的存储标识，绝不解释为文件系统路径或 URL。 */
  readonly attachmentId: string
  readonly mediaType: ImageMediaType
}

/** 一个通用文件的持久化引用契约（包内重建）。 */
export interface FileAttachmentRef {
  /** 内容寻址摘要（可能带有 `sha256:` 前缀）。 */
  readonly attachmentId: string
  /** 展示名，绝不解释为路径。 */
  readonly name: string
}

/**
 * 只读会话日志源端口：按 id 返回一整个会话的逻辑日志（头 + 有序事件），
 * 会话不存在返回 `undefined`。
 */
export interface SessionSourcePort {
  readSessionLog(id: string, signal?: AbortSignal): Promise<
    { readonly header: SessionHeader; readonly events: readonly SessionEvent[] } | undefined
  >
}

/**
 * 真实内存会话日志源：用真实数组模拟每个会话的有序日志，可被 `markAbsent`
 * 标记为不存在（考验 archive 的 404 / 子代理缺失路径）。
 */
export class MemorySessionSource implements SessionSourcePort {
  private readonly logs = new Map<string, { header: SessionHeader; events: SessionEvent[] }>()
  private readonly absent = new Set<string>()

  /** 登记一个会话的完整逻辑日志。 */
  set(id: string, header: SessionHeader, events: readonly SessionEvent[]): void {
    this.logs.set(id, { header, events: [...events] })
  }

  /** 标记某个 id 不存在（`readSessionLog` 返回 `undefined`）。 */
  markAbsent(id: string): void {
    this.absent.add(id)
  }

  async readSessionLog(id: string, signal?: AbortSignal): Promise<
    { readonly header: SessionHeader; readonly events: readonly SessionEvent[] } | undefined
  > {
    signal?.throwIfAborted()
    if (this.absent.has(id)) return undefined
    const log = this.logs.get(id)
    return log === undefined ? undefined : { header: log.header, events: log.events }
  }
}

/** 一次读回的单张图片字节。 */
export interface StoredImageAttachment {
  readonly data: Uint8Array
}

/**
 * 附件端口：按引用读取图片的完整字节，或按引用流式读取一个通用文件
 * （以 `AsyncIterable<Uint8Array>` 表示，绝不整套驻留内存）。
 */
export interface AttachmentPort {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

/**
 * 真实内存附件端口：图片按 attachmentId 存一份完整字节，文件按 attachmentId 存
 * 一份分块序列；引用缺失时抛错（fail-loud），与真正的后端拒绝行为一致。
 */
export class MemoryAttachmentPort implements AttachmentPort {
  private readonly images = new Map<string, Uint8Array>()
  private readonly files = new Map<string, Uint8Array[]>()

  /** 登记一张图片的完整字节。 */
  storeImage(attachmentId: string, data: Uint8Array): void {
    this.images.set(attachmentId, data)
  }

  /** 登记一个文件的分块序列。 */
  storeFile(attachmentId: string, chunks: readonly Uint8Array[]): void {
    this.files.set(attachmentId, chunks.map(chunk => chunk))
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    signal?.throwIfAborted()
    const data = this.images.get(String(ref.attachmentId))
    if (data === undefined) {
      throw new Error(`image attachment "${String(ref.attachmentId)}" is not stored`)
    }
    return { data }
  }

  async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    signal?.throwIfAborted()
    const chunks = this.files.get(String(ref.attachmentId))
    if (chunks === undefined) {
      throw new Error(`file attachment "${String(ref.attachmentId)}" is not stored`)
    }
    for (const chunk of chunks) {
      signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** 血缘树节点：一个后代会话头与其（可能为空的）再后代列表。 */
export interface SessionLineageNode {
  readonly session: { readonly header: SessionHeader }
  readonly descendants: readonly SessionLineageNode[]
}

/**
 * 血缘端口：按根会话 id 返回其直系后代森林（dsh 的 `traceSession.descendants`）。
 */
export interface LineagePort {
  traceDescendants(id: string, signal?: AbortSignal): Promise<readonly SessionLineageNode[]>
}

/**
 * 真实内存血缘端口：为每个 id 预置其后代森林；未登记返回空森林。
 */
export class MemoryLineagePort implements LineagePort {
  private readonly descendants = new Map<string, readonly SessionLineageNode[]>()

  /** 为某个根会话设置其后代森林。 */
  set(id: string, nodes: readonly SessionLineageNode[]): void {
    this.descendants.set(id, nodes)
  }

  async traceDescendants(id: string, signal?: AbortSignal): Promise<readonly SessionLineageNode[]> {
    signal?.throwIfAborted()
    return this.descendants.get(id) ?? []
  }
}

/**
 * flowforge `SessionPersistence` 的只读外形（无需运行时依赖即可结构匹配其
 * `readFrom(id, fromSeq, signal) → { meta, events } | undefined` 形状）。
 * 作为 host 接线出口将真实持久化反接回 {@link SessionSourcePort}。
 */
export interface StoredSessionReader {
  readFrom(
    id: string,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{ readonly meta: SessionHeader; readonly events: readonly SessionEvent[] } | undefined>
}

/**
 * 把 flowforge 风格的持久化读取反接为 {@link SessionSourcePort} 的纯适配函数。
 * 该适配仅在 host 组装点使用，不参与本包单测；依赖通过结构型鸭子类型注入，
 * 因此本包可独立构建而无需引用 `@flowforge/session-persistence` 的实现体。
 * @param reader - flowforge `SessionPersistence`（或其兼容读取器）。
 * @returns 与该持久化绑定的只读会话日志源。
 */
export function flowforgeReadSessionLogAdapter(reader: StoredSessionReader): SessionSourcePort {
  return {
    async readSessionLog(id: string, signal?: AbortSignal) {
      const result = await reader.readFrom(id, 0, signal)
      return result === undefined ? undefined : { header: result.meta, events: result.events }
    },
  }
}