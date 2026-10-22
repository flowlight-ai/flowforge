"use client";

/**
 * http-codebase-read — 浏览器侧真实数据只读端口（EP-CB7）。
 *
 * 以「预取缓存」策略把服务端 `/codebase-graph/data` 的 JSON 拉入内存，再返回一个
 * 实现同步签名 `CodebaseGraphRead`（nodesOf/edgesOf/anchorOf）的对象，喂入既有
 * `CodebaseGraphInjector`。fetch 是异步，故用 factory 先 `await` 一次拉全量。
 *
 * 失败（db 缺失 / 工程不存在 / 网络错）时返回 `null`，由调用方回落内置 seed。
 * 本模块不 import codebase / three，无副作用。
 *
 * 中文对照：http 只读数据端口 / 预取只读管道
 * @module @flowforge/web-frontend/components/codebase/http-codebase-read
 */

import type { CodebaseGraphRead, CodebaseNodeRow, CodebaseEdgeRow, GraphAnchor } from "@flowforge/graph-ui";

/** 服务端端点返回形状（route handler 已保证，见 codebase-graph/data/route.ts）。 */
interface HttpGraphPayload {
  readonly project: string;
  readonly nodes: readonly CodebaseNodeRow[];
  readonly edges: readonly CodebaseEdgeRow[];
  readonly anchors: Readonly<Record<string, GraphAnchor>>;
}

/**
 * 拉取并构造真实只读端口；失败返回 null（调用方回落 seed）。
 * @returns 预取成功返回同步只读端口；db/工程缺失或网络失败返回 null。
 */
export async function loadHttpCodebaseRead(project: string): Promise<CodebaseGraphRead | null> {
  let payload: HttpGraphPayload;
  try {
    const res = await fetch(`/codebase-graph/data?project=${encodeURIComponent(project)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    payload = (await res.json()) as HttpGraphPayload;
  } catch {
    return null;
  }

  const nodes = payload.nodes;
  const edges = payload.edges;
  const anchorsById = new Map<string, GraphAnchor>(Object.entries(payload.anchors ?? {}));

  return {
    nodesOf(): readonly CodebaseNodeRow[] {
      return nodes;
    },
    edgesOf(): readonly CodebaseEdgeRow[] {
      return edges;
    },
    anchorOf(nodeId: string): GraphAnchor | null {
      return anchorsById.get(nodeId) ?? null;
    },
  };
}