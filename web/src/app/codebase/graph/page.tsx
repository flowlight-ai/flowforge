"use client";

/**
 * /codebase/graph — 代码知识图谱 3D 可视化（EP-CB6 Web 渲染闭环）。
 *
 * 通过 next/dynamic + ssr:false 懒加载 CodebaseGraphView（three 需 client-only，
 * 不在服务端求值）；useSearchParams 用 Suspense 包裹，满足 Next 14 静态渲染约束。
 * 缺省关闭：?enabled=1 才挂载 heavy GPU 页面，?project=<id> 指定工程（缺省 demo）。
 */

import dynamic from "next/dynamic";
import { Suspense } from "react";

const CodebaseGraphView = dynamic(
  () => import("@/components/codebase/CodebaseGraphView"),
  { ssr: false },
);

export default function CodebaseGraphPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "var(--muted)" }}>加载中…</div>}>
      <CodebaseGraphView />
    </Suspense>
  );
}