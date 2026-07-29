"use client";

/**
 * /memory/health — 记忆健康报告
 */

import { MemoryHub } from "@/components/memory";
import { HealthReport } from "@/components/memory/HealthReport";

export default function MemoryHealthPage() {
  return (
    <MemoryHub activeTab="health">
      <HealthReport />
    </MemoryHub>
  );
}
