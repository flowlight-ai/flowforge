"use client";

/**
 * /signals — 信号总览
 *
 * 依据 WEB-FUSION-DESIGN.md §9.4：使用 SignalsOverview 组件。
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignalsOverview } from "@/components/signals";

function SignalsInner() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  return <SignalsOverview initialReferrerThread={from} />;
}

export default function SignalsPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>加载中...</div>}>
      <SignalsInner />
    </Suspense>
  );
}
