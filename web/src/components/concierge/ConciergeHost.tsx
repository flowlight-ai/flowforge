"use client";

/**
 * ConciergeHost — 管家球宿主
 *
 * 来源：clowder-ai/packages/web/src/components/concierge/ConciergeHost.tsx（简化版）
 *
 * Phase 2 阶段：占位实现，仅渲染挂载点，不引入 clowder-ai 的完整管家球逻辑。
 * 后续 Phase 6 会按需补全管家球交互、意图识别、唤回等能力。
 */

import { useEffect, useState } from "react";

export function ConciergeHost() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // 占位：渲染一个隐藏的挂载点，保持 Shell 结构完整
  return (
    <div
      data-concierge-host="true"
      aria-hidden="true"
      style={{ display: "none" }}
    />
  );
}
