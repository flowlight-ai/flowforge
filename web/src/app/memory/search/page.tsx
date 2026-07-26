"use client";

/**
 * /memory/search — 证据检索
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MemoryHub } from "@/components/memory";
import { EvidenceSearch } from "@/components/memory/EvidenceSearch";

function SearchInner() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? undefined;
  return (
    <MemoryHub activeTab="search">
      <EvidenceSearch initialQuery={q} />
    </MemoryHub>
  );
}

export default function MemorySearchPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>加载中...</div>}>
      <SearchInner />
    </Suspense>
  );
}
