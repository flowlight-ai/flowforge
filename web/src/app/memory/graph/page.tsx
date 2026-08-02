"use client";

/**
 * /memory/graph — 记忆图谱可视化
 */

import { MemoryHub } from "@/components/memory";
import { CollectionGraph } from "@/components/memory/CollectionGraph";

export default function MemoryGraphPage() {
  return (
    <MemoryHub activeTab="graph">
      <CollectionGraph />
    </MemoryHub>
  );
}
