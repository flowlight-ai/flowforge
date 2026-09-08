/**
 * 宿主侧会话日志下载核心：把一个 Session 逻辑日志序列化为规范 JSONL、经只读
 * 数据端口读取每条日志并在其读取前穿越活跃会话的刷写屏障、按 zip 顺序装配整个
 * 归档（根 → 子代理后代 → 全部去重的图片 → 全部去重的文件）并流式产出。
 *
 * 移植自 dsh `session-log-export/src/archive.ts`（完整实现 `serializeSessionLog` /
 * `readSessionLogText` / `flushLiveSessionLog` / `sessionLogZipEntries` /
 * `streamSessionLogZip` / `sessionLogZipFilename` / `SESSION_LOG_FILENAME`，含
 * `collectAttachmentRefs` / `collectEventAttachmentRefs` / `attachmentRefsInArtifact`）。
 * 原实现直连 `@deepseek-ai/cordis`、`dsh-session`、`dsh-session-persistence`、
 * `dsh-session-query`、`dsh-attachment`、`dsh-brand`；此处全部改为调用包内注入端口
 * 与内存实现，最终零 `@deepseek-ai/*` 引用。Session JSON 类型取自
 * `@flowforge/session-format`；当前格式版本号在包内定义为 `SESSION_FORMAT_VERSION`
 * （=2，来源见注释）。压缩与反压逻辑收拢进 `pure/zip.ts`，archive 只做装配。
 * @module
 */

import { sessionFormatLogFilename } from '@flowforge/session-format'
import {
  streamSessionLogZipFromEntries,
  safeSessionIdSegment,
  fileZipEntryPath,
  mediaZipEntryPath,
  type SessionLogCompressionLevel,
  type SessionLogZipEntry,
} from './pure/zip.ts'
import type { LiveSessionStoreSeam } from './ports/live-session.ts'
import type {
  AttachmentPort,
  FileAttachmentRef,
  ImageAttachmentRef,
  LineagePort,
  SessionEvent,
  SessionHeader,
  SessionLineageNode,
  SessionSourcePort,
} from './ports/source.ts'

/** 当前会话格式代次。来源：`@flowforge/session-format-catalog` 的 `INSTALLED_SESSION_FORMAT_VERSION`（=2）。 */
export const SESSION_FORMAT_VERSION = 2

/** 每个被导出的会话日志的当前代次规范基名（`session.v2.jsonl`）。 */
export const SESSION_LOG_FILENAME = sessionFormatLogFilename(SESSION_FORMAT_VERSION)

/** 导出需要的数据源（活跃会话存储可缺省；其余三类必填）。 */
export interface SessionLogExportSource {
  readonly source: SessionSourcePort
  readonly lineages: LineagePort
  readonly attachments: AttachmentPort
  readonly live: LiveSessionStoreSeam | undefined
}

/** 仅含活跃会话存储切片的数据源（供刷写屏障使用）。 */
export type LiveFlushSource = Pick<SessionLogExportSource, 'live'>

/**
 * 在一个（可能）存活会话的日志被读取前，穿越其内存存储的权威持久化屏障。冷或缺失
 * 的 id 没有内存工作要刷写。
 * @param liveSource - 导出数据源切片（含可选的活跃会话存储）。
 * @param id - 即将读取制品的会话。
 * @param signal - 可选取消，围绕刷写屏障观察。
 */
export async function flushLiveSessionLog(
  liveSource: LiveFlushSource,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const live = liveSource.live
  if (live === undefined) return
  const session = live.get(id)
  if (session === undefined) return
  await live.flush(session)
  signal?.throwIfAborted()
}

/**
 * 把一条会话逻辑日志序列化为规范 JSONL 文本：先将头部序列化为规范头行，再逐事件
 * 一行，末尾换行。
 * @param header - 会话的不可变头。
 * @param events - 按 seq 序的已提交事件。
 * @returns JSONL 文本。
 */
export function serializeSessionLog(
  header: SessionHeader,
  events: readonly SessionEvent[],
): string {
  // 匹配当前 v2 物理头。继承的切分已由 `events` 中带标签的 session/end-seed 事件
  // 表达；`delegationDepth` 在磁盘上必填，故头部省略时取 0。
  /* jscpd:ignore-start -- 刻意镜像 JSONL 后端的 toHeaderLine：导出文本即规范 v2 物理
     头行，而这个后端无关的包不得依赖某一后端实现。 */
  const lines = [JSON.stringify({
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    ...header.parentSession !== undefined ? { parentSession: header.parentSession } : {},
    isSeeded: header.isSeeded,
    ...header.origin !== undefined ? { origin: header.origin } : {},
    delegationDepth: header.delegationDepth ?? 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  })]
  /* jscpd:ignore-end */
  for (const event of events) lines.push(JSON.stringify(event))
  return `${lines.join('\n')}\n`
}

/**
 * 经数据端口读取一条完整会话逻辑日志并序列化。读取只观察已提交日志（持久化从不
 * 返回撕裂尾部），解析后的刷写后读取至少观察到已刷写前缀。
 * @param source - 会话日志源端口。
 * @param id - 要读取的会话。
 * @param signal - 可选取消，转发给读取。
 * @returns 序列化 JSONL 文本，会话不存在时为 `undefined`。
 */
export async function readSessionLogText(
  source: SessionSourcePort,
  id: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const log = await source.readSessionLog(id, signal)
  return log === undefined ? undefined : serializeSessionLog(log.header, log.events)
}

/**
 * 收集一个内容数组内的每个附件引用，像存活附件路由一样深入嵌套的 tool result。
 * @param content - 一个事件内容数组（或嵌套 tool-result 内容）。
 * @param images - 以附件 id 为键的图片去重表。
 * @param files - 以附件 id 与存储名为键的文件去重表。
 */
function collectAttachmentRefs(
  content: unknown,
  images: Map<string, ImageAttachmentRef>,
  files: Map<string, FileAttachmentRef>,
): void {
  if (!Array.isArray(content)) return
  const pending: unknown[] = []
  for (const item of content) pending.push(item)
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      images.set(String(ref.attachmentId), ref)
    }
    if (block.type === 'file' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as FileAttachmentRef
      files.set(`${String(ref.attachmentId)}\u0000${ref.name}`, ref)
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) pending.push(item)
    }
  }
}

/**
 * 收集一条会话事件携带的每个附件引用，覆盖与存活附件路由扫描一致的载体
 * （直接内容、消息内容、插入的消息、嵌入式 Assistant 流里完成的块）。
 * @param event - 一条已解析的 JSONL 事件对象。
 * @param images - 以附件 id 为键的图片去重表。
 * @param files - 以附件 id 与存储名为键的文件去重表。
 */
function collectEventAttachmentRefs(
  event: unknown,
  images: Map<string, ImageAttachmentRef>,
  files: Map<string, FileAttachmentRef>,
): void {
  const data = (event as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return
  const carrier = data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    stream?: Array<{ type?: unknown; chunk?: { type?: unknown; block?: unknown } }>
  }
  collectAttachmentRefs(carrier.content, images, files)
  if (carrier.message !== undefined) collectAttachmentRefs(carrier.message.content, images, files)
  if (carrier.inserted !== undefined) {
    for (const message of carrier.inserted) collectAttachmentRefs(message.content, images, files)
  }
  if (carrier.stream !== undefined) {
    for (const record of carrier.stream) {
      if (record.type === 'chunk' && record.chunk?.type === 'block-end') {
        collectAttachmentRefs([record.chunk.block], images, files)
      }
    }
  }
}

/**
 * 收集一份已存制品文本提到的不同附件引用。解析失败的行无法引用附件并被跳过
 * （制品文本本身无论解析与否都会原样导出）。
 * @param content - 已存制品文本。
 * @returns 去重后的图片与文件引用表。
 */
function attachmentRefsInArtifact(content: string): {
  readonly images: Map<string, ImageAttachmentRef>
  readonly files: Map<string, FileAttachmentRef>
} {
  const images = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  for (const line of content.split('\n')) {
    if (line === '') continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    collectEventAttachmentRefs(event, images, files)
  }
  return { images, files }
}

/**
 * 一个根会话的导出归档文件名。
 * @param sessionId - 根会话 id（缩成一个安全路径段）。
 * @returns 该会话导出归档的附件文件名。
 */
export function sessionLogZipFilename(sessionId: string): string {
  return `flowforge-session-${safeSessionIdSegment(sessionId)}.zip`
}

/**
 * 按 zip 顺序产出导出条目：预读的根日志在前，随后按血缘序每个子代理后代（存活时
 * 刷写、经数据端口读取后在即将产出前读到、消费端前移后丢弃），再随后是被包含日志
 * 引用的每个不同附件。图片作为有界存对象读取并校验；通用文件保持流经 ZIP 写器。
 * 宿主在根之外最多同时持有一个后代日志、一张图片与一个文件块。
 * @param source - 挂载好的导出数据源（缺服务的调用方在开流前已回 500）。
 * @param rootContent - 已序列化的根日志（调用方预读，以便缺失会话路径在开流前干净作答）。
 * @param sessionId - 根会话 id。
 * @param includeDescendants - 是否包含每个子代理后代。
 * @param signal - 可选取消，转发给血缘、持久化与附件读取。
 * @returns 按 zip 顺序的导出条目。
 */
export async function* sessionLogZipEntries(
  source: SessionLogExportSource,
  rootContent: string,
  sessionId: string,
  includeDescendants: boolean,
  signal?: AbortSignal,
): AsyncGenerator<SessionLogZipEntry> {
  const media = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  const rememberAttachments = (content: string): void => {
    const refs = attachmentRefsInArtifact(content)
    for (const [id, ref] of refs.images) media.set(id, ref)
    for (const [id, ref] of refs.files) files.set(id, ref)
  }
  rememberAttachments(rootContent)
  yield { path: SESSION_LOG_FILENAME, content: rootContent }
  if (includeDescendants) {
    const seen = new Set<string>([sessionId])
    const collect = async function* (
      nodes: readonly SessionLineageNode[],
    ): AsyncGenerator<SessionLogZipEntry> {
      for (const node of nodes) {
        signal?.throwIfAborted()
        const id = node.session.header.id
        if (seen.has(id)) continue
        seen.add(id)
        await flushLiveSessionLog(source, id, signal)
        const content = await readSessionLogText(source.source, id, signal)
        signal?.throwIfAborted()
        if (content === undefined) {
          throw new Error(`subagent "${id}" has no stored log`)
        }
        rememberAttachments(content)
        yield {
          path: `subagents/${safeSessionIdSegment(id)}/${SESSION_LOG_FILENAME}`,
          content,
        }
        yield* collect(node.descendants)
      }
    }
    const descendants = await source.lineages.traceDescendants(sessionId, signal)
    signal?.throwIfAborted()
    yield* collect(descendants)
  }
  for (const ref of media.values()) {
    signal?.throwIfAborted()
    const stored = await source.attachments.readImage(ref, signal)
    signal?.throwIfAborted()
    yield { path: mediaZipEntryPath(ref), data: stored.data }
  }
  for (const ref of files.values()) {
    signal?.throwIfAborted()
    yield {
      path: fileZipEntryPath(ref),
      chunks: source.attachments.readFileStream(ref, signal),
    }
  }
}

/**
 * 以 WHO 的 ReadableStream 流式产出单个会话日志 ZIP。根日志由调用方先读取并序列化
 * （缺失根或缺失服务在任何字节产出前干净作答）；每个条目一产出即以有界分块编码并
 * deflate，归档字节增量到达。后代读取失败即让流报错（fail-loud，绝不静默少导出）。
 * @param source - 挂载好的导出数据源（缺服务的调用方在开流前已回 500）。
 * @param rootContent - 已序列化的根日志（第一个 zip 条目）。
 * @param sessionId - 根会话 id。
 * @param includeDescendants - 是否包含每个子代理后代。
 * @param compressionLevel - 每个 ZIP 条目的合法 fflate DEFLATE 分级。
 * @param signal - 请求取消与响应消费端取消的合并。
 * @returns zip 字节流。
 */
export function streamSessionLogZip(
  source: SessionLogExportSource,
  rootContent: string,
  sessionId: string,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return streamSessionLogZipFromEntries(
    sessionLogZipEntries(source, rootContent, sessionId, includeDescendants, signal),
    compressionLevel,
    signal,
  )
}

export type { SessionLogCompressionLevel, SessionLogZipEntry } from './pure/zip.ts'
export type { SessionEvent, SessionHeader } from './ports/source.ts'
export type { LiveSessionStoreSeam } from './ports/live-session.ts'