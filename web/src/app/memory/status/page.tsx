"use client";

/**
 * /memory/status — 索引状态
 */

import { MemoryHub } from "@/components/memory";
import { IndexStatus } from "@/components/memory/IndexStatus";

export default function MemoryStatusPage() {
  return (
    <MemoryHub activeTab="status">
      <IndexStatus />
    </MemoryHub>
  );
}
