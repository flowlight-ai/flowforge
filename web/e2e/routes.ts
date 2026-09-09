/**
 * E2E 冒烟路由注册表 — 全页面路由可达（T8.10）
 *
 * 路由清单来自 web/src/app 下约定式 page 文件（2026-09-09 盘点）。
 * 仅收录静态可达路由；动态段（[id]/[threadId]/[taskId] 等）需参数，排除。
 * expectedFrag 表示该页稳定渲染后必然出现的可见文本（用于在无后端时仍证明页面渲染成功），
 * 为空时仅做「可导航 + 非错误页」断言。
 */
export interface SmokeRoute {
  /** 相对路由路径 */
  readonly path: string;
  /** 该页稳定渲染后必然出现的可见文本片段（可空） */
  readonly expectedFrag?: string;
}

export const SMOKE_ROUTES: readonly SmokeRoute[] = [
  { path: "/", expectedFrag: "运行概览" },
  { path: "/council" },
  { path: "/memory" },
  { path: "/memory/catalog" },
  { path: "/memory/graph" },
  { path: "/memory/health" },
  { path: "/memory/search" },
  { path: "/memory/status" },
  { path: "/mission-control" },
  { path: "/mission-hub" },
  { path: "/review" },
  { path: "/signals" },
  { path: "/signals/sources" },
  { path: "/solo" },
  { path: "/tasks" },
  { path: "/admin" },
  { path: "/admin/agents" },
  { path: "/admin/autonomous" },
  { path: "/admin/co-creators" },
  { path: "/admin/env" },
  { path: "/admin/governance" },
  { path: "/admin/im" },
  { path: "/admin/marketplace" },
  { path: "/admin/mcp" },
  { path: "/admin/models" },
  { path: "/admin/notify" },
  { path: "/admin/observability" },
  { path: "/admin/permissions" },
  { path: "/admin/plugins" },
  { path: "/admin/quotas" },
  { path: "/admin/routing" },
  { path: "/admin/settings" },
  { path: "/admin/tools" },
];

/** Next.js 未匹配路由时的默认 404 / 异常文案（判定路由可达失败的依据） */
export const ROUTE_ERROR_FRAGS: readonly string[] = [
  "This page could not be found",
  "Application error: a client-side exception",
  "Internal Server Error",
];