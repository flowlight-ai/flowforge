/**
 * @flowforge/web-frontend — 真实 codebase.db→web 数据通道（EP-CB7）。
 *
 * 服务端 route handler：进程内 `node:sqlite` 读 `.flowforge/codebase.db`，暴露只读 JSON。
 * 路径 `/codebase-graph/data`（非 `/api` 前缀 → 不被 next.config rewrites 转发到 FastAPI）。
 *
 * DB 定位：
 *   1. 环境变量 `FF_CODEBASE_DB`（显式注入）；
 *   2. 否则从 `process.cwd()` 向上探测 `.flowforge/codebase.db`（与 plugin-codebase CLI 约定一致）。
 *
 * 返回形状对齐 graph-ui 的 CodebaseNodeRow/CodebaseEdgeRow/GraphAnchor，喂给浏览器侧
 * HttpCodebaseRead → CodebaseGraphInjector（只读管道，不写 DB、不改 codebase 核心）。
 *
 * 中文对照：codebase 图谱服务端数据端点
 * @module @flowforge/web-frontend/app/codebase-graph/data/route
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// 仅取 store 子路径，避免触发 index.ts 顶层求值连带加载 tree-sitter 原生绑定。
import { CodebaseStore } from '@flowforge/plugin-codebase/src/store.ts'

/** 仓库根的 `.flowforge/codebase.db`，环境变量优先。 */
function resolveDbPath(): string {
  const fromEnv = process.env.FF_CODEBASE_DB
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv)
  let dir = process.cwd()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(dir, '.flowforge', 'codebase.db')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(process.cwd(), '.flowforge', 'codebase.db')
}

/** 单例连接（复用，防反复开库；进程生命周期由 Next 管理）。 */
let store: CodebaseStore | undefined

function openCodebaseStore(): CodebaseStore {
  if (store !== undefined) return store
  const inst = new CodebaseStore(resolveDbPath())
  inst.open()
  store = inst
  return inst
}

/** 节点 → codebase 只读形状（CodebaseNodeRow 兼容字段）。 */
function toNodeRow(row: { id: string; label: string; name: string; filePath?: string; lines?: number }) {
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    ...(row.filePath === undefined ? {} : { filePath: row.filePath }),
    ...(row.lines === undefined ? {} : { lines: row.lines }),
  }
}

/** 边 → codebase 只读形状（CodebaseEdgeRow 兼容字段）。 */
function toEdgeRow(row: { source: string; target: string; type: string }) {
  return { source: row.source, target: row.target, type: row.type }
}

/** 依据索引路径 + 行号组装定义锚点（GraphAnchor）。 */
function buildAnchors(
  paths: ReadonlyMap<string, string>,
  rows: ReadonlyArray<{ id: string; filePath?: string; lines?: number }>,
): Record<string, { nodeId: string; filePath?: string; startLine?: number; endLine?: number }> {
  const anchors: Record<string, { nodeId: string; filePath?: string; startLine?: number; endLine?: number }> = {}
  for (const row of rows) {
    const filePath = paths.get(row.id) ?? row.filePath
    if (filePath === undefined) continue
    const anchor: { nodeId: string; filePath?: string; startLine?: number; endLine?: number } = { nodeId: row.id, filePath }
    if (row.lines !== undefined) {
      anchor.startLine = row.lines
      anchor.endLine = row.lines
    }
    anchors[row.id] = anchor
  }
  return anchors
}

/**
 * GET /codebase-graph/data?list=1 → 只返回工程列表（供项目选择下拉）。
 * GET /codebase-graph/data?project=<id> → 返回指定工程全量节点/边/锚点。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const project = req.nextUrl.searchParams.get('project')
    const listMode = req.nextUrl.searchParams.get('list') === '1'
    const inst = openCodebaseStore()
    if (listMode) {
      const items = inst.listProjects().map((p) => ({
        name: p.name,
        createdAt: p.createdAt,
        ...(p.filesIndexed === undefined ? {} : { filesIndexed: p.filesIndexed }),
        ...(p.lastIndexedAt === undefined ? {} : { lastIndexedAt: p.lastIndexedAt }),
      }))
      return NextResponse.json(
        { projects: items },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const projects = inst.listProjects()
    const target = project ?? projects[0]?.name
    if (target === undefined) {
      return NextResponse.json({ error: 'no codebase project indexed' }, { status: 404 })
    }
    if (project !== undefined && !projects.some((p) => p.name === project)) {
      return NextResponse.json({ error: `project not found: ${project}` }, { status: 404 })
    }

    const nodes = inst.allNodes(target).map(toNodeRow)
    const edges = inst.edgesOf(target).map(toEdgeRow)
    const paths = inst.indexNodePaths(target)
    const anchors = buildAnchors(paths, inst.allNodes(target))

    return NextResponse.json(
      { project: target, nodes, edges, anchors },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: `codebase graph read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}