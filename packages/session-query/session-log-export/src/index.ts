/**
 * Session-log 下载命令与宿主侧流式下载路由的装配。
 *
 * 移植自 dsh `session-log-export/src/index.ts` 的装配/路由/命令意图（去掉 schemastery
 * Config 与 cordis Context）。本模块不依赖 cordis：命令与路由经注入的
 * {@link HostContextPort} 注册，配置经 `contract/config.ts`（zod）解析，`source`
 * 数据源随宿主上下文携带。浏览器依赖（`fetch` / 下载 URL 触发保存）在
 * `controller.ts` 侧经注入回调呈现。
 */

import {
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogCompressionLevel,
} from './archive.ts'
import type { HostContextPort } from './ports/context.ts'
import type { CommandResult } from './contract/command.ts'

/** 解析并校验导出配置，收敛 `compressionLevel` 到合法区间。 */
export { resolveCompression } from './contract/config.ts'

/** 稳定的浏览器下载路径，跨传输迁移保持一致。 */
export const SESSION_LOG_EXPORT_PATH = '/api/session.export'

/** Web `/export` 命令不接收路径参数时返回的请求已记录话术。 */
const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * 注册仅 Web 的 `/export` 命令与鉴权 ZIP 下载路由。
 * @param host - 承载命令注册、路由注册、配置与导出数据源的宿主上下文。
 */
export function apply(host: HostContextPort): void {
  const level = host.config.compressionLevel
  host.registerCommand({
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
    handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
      ? REQUESTED
      : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
  })
  host.registerFetch({
    path: SESSION_LOG_EXPORT_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const response = await sessionLogExportResponse(host, request, level)
      if (request.method === 'GET') return response
      await response.body?.cancel()
      return new Response(null, { status: response.status, headers: response.headers })
    },
  })
}

/**
 * 构造一个会话日志导出响应（含校验、根读取与流式 ZIP 装配）。
 * @param host - 携带 `source` 数据源（可能缺省）的宿主上下文。
 * @param request - 已鉴权请求，其 `signal` 观察请求取消。
 * @param compressionLevel - 每个 ZIP 条目的合法 DEFLATE 分级。
 * @returns 一个成功 ZIP 响应或 400/404/500 响应。
 */
export async function sessionLogExportResponse(
  host: HostContextPort,
  request: Request,
  compressionLevel: SessionLogCompressionLevel,
): Promise<Response> {
  const url = new URL(request.url)
  const query = Object.fromEntries(url.searchParams)
  const sessionIdValue = query['sessionId']
  const descendantsValue = query['includeDescendants']
  if (sessionIdValue === undefined || sessionIdValue.length === 0
    || (descendantsValue !== undefined && descendantsValue !== 'true' && descendantsValue !== 'false')) {
    return new Response('missing or invalid sessionId query parameter', { status: 400 })
  }
  const sessionId = sessionIdValue
  const source = host.source
  if (source === undefined) {
    return new Response(
      'session log export is unavailable: missing session source service',
      { status: 500 },
    )
  }
  let rootContent: string | undefined
  try {
    await flushLiveSessionLog(source, sessionId, request.signal)
    rootContent = await readSessionLogText(source.source, sessionId, request.signal)
    request.signal.throwIfAborted()
  } catch {
    request.signal.throwIfAborted()
    // 根准备失败（刷写、打开或读取）：回 500 而不回声错误——错误可能把绝对宿主
    // 路径带进浏览器错误栏。
    return new Response('session log export failed to read the stored log', { status: 500 })
  }
  if (rootContent === undefined) {
    return new Response('session not found', { status: 404 })
  }
  const response = new Response(
    streamSessionLogZip(
      source,
      rootContent,
      sessionId,
      descendantsValue === 'true',
      compressionLevel,
      request.signal,
    ),
    {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${sessionLogZipFilename(sessionId)}"`,
      },
    },
  )
  return response
}

export type { SessionLogExportSource } from './archive.ts'