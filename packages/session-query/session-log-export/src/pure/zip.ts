/**
 * Session-log ZIP 的纯流式生产层。
 *
 * 移植自 dsh `session-log-export/src/archive.ts` 中与宿主服务无关的纯逻辑部分：
 * 分块反压推送（`ResponseCapacityGate`）、单条目编码（`pushArtifact/Binary/Stream
 * Chunks`）、附件 zip 路径（`mediaZipEntryPath` / `fileZipEntryPath`）、以及用
 * fflate 增量生成整个归档字节的流式生产（`streamSessionLogZipFromEntries`）。
 * 本模块不关心条目从哪来——它接受一个 `AsyncIterable<SessionLogZipEntry>` 并按
 * zip 顺序逐个压缩，从而与 `archive.ts` 保持单向依赖（archive → zip，绝无循环）。
 * 压缩运行在宿主侧，归档字节逐步产出，宿主从不整包驻留内存；响应队列到达高水位
 * 时生产等待消费者 pull，慢消费者把累积上界限定为固定队列加上一次同步 fflate push。
 * @module
 */

import { Zip, ZipDeflate } from 'fflate'
import type { FileAttachmentRef, ImageAttachmentRef } from '../ports/source.ts'

/** 合法的 fflate DEFLATE 分级。 */
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** 未显式配置时使用的平衡缺省。 */
export const DEFAULT_SESSION_LOG_COMPRESSION_LEVEL: SessionLogCompressionLevel = 6

/** 一个导出的文件：一条会话日志文本，或一个被引用的附件对象。 */
export type SessionLogZipEntry =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly data: Uint8Array }
  | { readonly path: string; readonly chunks: AsyncIterable<Uint8Array> }

/** 每种光栅媒体类型对应的归档扩展名。 */
const MEDIA_TYPE_EXTENSIONS: Record<ImageAttachmentRef['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * 一个媒体对象的 zip 路径：以不透明附件 id 内容寻址，共享图片只落一份，日志中的
 * id 无需清单即可反查回归档条目。
 * @param ref - 会话日志中的持久化引用。
 * @returns 归档内的路径。
 */
export function mediaZipEntryPath(ref: ImageAttachmentRef): string {
  return `media/${String(ref.attachmentId)}.${MEDIA_TYPE_EXTENSIONS[ref.mediaType]}`
}

/**
 * 保留一个已存文件引用摘要与名字的归档路径。名字段先中和路径分隔与 C0 控制字符，
 * 再对点段（`.`/`..`/空）整体回退为 `file`，否则以 `_` 前缀剥离前导点，保证归档内
 * 每个 basename 永不会以路径段语义被重新切分或解释成父目录穿越。
 * @param ref - 会话日志中的文件引用。
 * @returns 归档内的路径。
 */
export function fileZipEntryPath(ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).replace(/^sha256:/u, '')
  const name = ref.name.replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
  const safeName =
    name === '' || name === '.' || name === '..'
      ? 'file'
      : name.startsWith('.')
        ? `_${name}`
        : name
  return `files/${digest.slice(0, 2)}/${digest}/${safeName}`
}

/**
 * 来自不可信会话 id 的一个安全 zip 路径段。会话 id 由宿主控制，但品牌允许任意非
 * 空字符串，因此 `../`、点段与分隔符在塑造归档条目前被中和。不同 id 可能折叠到同
 * 一段（宿主铸造的 UUID 不会冲突，故不保留唯一性后缀）。
 * @param id - 原始会话 id。
 * @returns 文件系统安全的一段。
 */
export function safeSessionIdSegment(id: string): string {
  // 先把任意连续点段折叠为单个 `_`（中和 `..`/`...` 的父目录穿越语义），再把剩余
  // 的非安全字符（含 `/`、`\`、控制符）收敛为 `_`，保证返回段永不含路径分隔与点段。
  return id.replace(/\.+/gu, '_').replace(/[^A-Za-z0-9_-]/gu, '_')
}

/** 一次 zip push 携带的日志文本代码单元数（限制编码内存）。 */
const PUSH_CHUNK_CODE_UNITS = 1 << 16

/** 一次 zip push 携带的媒体字节数（限制内存；图片本就受尺寸上限约束）。 */
const PUSH_CHUNK_BYTES = 1 << 16

/** 响应流在 ZIP 生产等待 pull 前保留的字节容量。 */
const RESPONSE_HIGH_WATER_MARK_BYTES = 1 << 16

/** 仅在 ReadableStream pull 恢复容量时释放的一个生产等待者。 */
export class ResponseCapacityGate {
  private releasePending: (() => void) | undefined

  /**
   * 等响应队列出现正字节容量或取消获胜。
   * @param controller - 以 desiredSize 拥有容量计的响应控制器。
   * @param signal - 请求/消费端合并的取消信号。
   */
  async wait(
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    if (controller.desiredSize === null || controller.desiredSize > 0) return
    await new Promise<void>((resolve) => {
      const release = (): void => {
        this.releasePending = undefined
        signal.removeEventListener('abort', release)
        resolve()
      }
      this.releasePending = release
      signal.addEventListener('abort', release, { once: true })
    })
    signal.throwIfAborted()
  }

  /** 消费端一次 pull 后释放当前生产等待者。 */
  pulled(): void {
    this.releasePending?.()
  }
}

/**
 * 把一个媒体对象的字节以有界分块推入 deflate 流，块间像文本路径一样等待消费产能。
 * @param deflate - 该 zip 条目的 deflate 流。
 * @param data - 已存图片字节。
 * @param controller - 响应队列控制器。
 * @param capacity - 由 pull 驱动的响应容量闸。
 * @param signal - 取消；中止时抛错。
 */
export async function pushBinaryChunks(
  deflate: ZipDeflate,
  data: Uint8Array,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0
  do {
    signal.throwIfAborted()
    const end = Math.min(offset + PUSH_CHUNK_BYTES, data.byteLength)
    const finalChunk = end >= data.byteLength
    deflate.push(data.subarray(offset, end), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (offset < data.byteLength)
}

/**
 * 推送一个流式文件条目而不整体保留其完整字节序列。
 * @param deflate - 该 zip 条目的 deflate 流。
 * @param chunks - 来自附件存储的分块迭代。
 * @param controller - 响应队列控制器。
 * @param capacity - 由 pull 驱动的响应容量闸。
 * @param signal - 取消；中止时抛错。
 */
export async function pushStreamChunks(
  deflate: ZipDeflate,
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  for await (const chunk of chunks) {
    signal.throwIfAborted()
    if (chunk.byteLength === 0) continue
    deflate.push(chunk, false)
    await capacity.wait(controller, signal)
  }
  signal.throwIfAborted()
  deflate.push(new Uint8Array(), true)
  await capacity.wait(controller, signal)
}

/**
 * 把一个条目的文本以有界分块推入 deflate 流，绝不把代理对拆到块边界上
 * （孤立的高代理对会重编码为 U+FFFD，静默损坏导出的日志）。
 * @param deflate - 该 zip 条目的 deflate 流。
 * @param content - 规范会话日志文本。
 * @param controller - 响应队列控制器。
 * @param capacity - 由 pull 驱动的响应容量闸。
 * @param signal - 取消；中止时抛错。
 */
export async function pushArtifactChunks(
  deflate: ZipDeflate,
  content: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder()
  let offset = 0
  let finalChunk: boolean
  do {
    signal.throwIfAborted()
    let end = Math.min(offset + PUSH_CHUNK_CODE_UNITS, content.length)
    if (end < content.length && end - offset > 1) {
      // 边界落在代理对内部时回退一个代码单元：该对整体起于下一块。
      const last = content.charCodeAt(end - 1)
      if (last >= 0xd800 && last <= 0xdbff) end -= 1
    }
    finalChunk = end >= content.length
    deflate.push(encoder.encode(content.slice(offset, end)), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (!finalChunk)
}

/**
 * 以 WHO 提供的条目迭代生产一个会话日志 ZIP 的 ReadableStream。每个条目按 zip
 * 顺序以有界分块编码并 deflate，归档字节增量到达。条目迭代中途抛错（子代理缺失、
 * 取消、读取失败）即让流报错（fail-loud，绝不静默少导出）。
 * @param entries - 已排好 zip 顺序的导出条目。
 * @param compressionLevel - 每个 ZIP 条目的合法 fflate DEFLATE 分级。
 * @param signal - 与响应消费端取消合并的生产端取消。
 * @returns zip 字节流。
 */
export function streamSessionLogZipFromEntries(
  entries: AsyncIterable<SessionLogZipEntry>,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const consumerAbort = new AbortController()
  const producerSignal = AbortSignal.any([signal, consumerAbort.signal])
  let zip: Zip | undefined
  let zipTerminated = false
  const capacity = new ResponseCapacityGate()
  const terminateZip = (): void => {
    if (zip === undefined || zipTerminated) return
    zipTerminated = true
    zip.terminate()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // fflate 每压缩一块同步回调，因此单次 push 可先于慢消费端进队；容量闸在
      // 队列待满后于 push 之间等待 pull，把累积上界限定为队列高水位加一次同步
      // push。
      const archive = new Zip((error, data, final) => {
        /* v8 ignore next 3 -- fflate 只在内部 zip 失败时报告，合法输入不可达 */
        if (error) {
          controller.error(error)
          return
        }
        /* v8 ignore next -- fflate 可能发空块；测试无法控制 */
        if (data.byteLength > 0) controller.enqueue(data)
        if (final) controller.close()
      })
      zip = archive
      void (async () => {
        try {
          for await (const entry of entries) {
            const deflate = new ZipDeflate(entry.path, { level: compressionLevel })
            archive.add(deflate)
            if ('content' in entry) {
              await pushArtifactChunks(deflate, entry.content, controller, capacity, producerSignal)
            } else if ('data' in entry) {
              await pushBinaryChunks(deflate, entry.data, controller, capacity, producerSignal)
            } else {
              await pushStreamChunks(deflate, entry.chunks, controller, capacity, producerSignal)
            }
          }
          archive.end()
        } catch (error) {
          // 流中途失败必须让下载失败而非交付截断归档。
          /* v8 ignore next -- 类型化后端以 Error 拒绝，DOMException 在 Node 中也是其一 */
          terminateZip()
          controller.error(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    },
    pull() {
      capacity.pulled()
    },
    cancel(reason) {
      consumerAbort.abort(
        reason instanceof Error ? reason : new Error('session log export stream cancelled'),
      )
      terminateZip()
    },
  }, {
    highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES,
    size: chunk => chunk.byteLength,
  })
}