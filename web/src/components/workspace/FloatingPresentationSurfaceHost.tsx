"use client";

/**
 * FloatingPresentationSurfaceHost — 演示浮窗宿主
 * Phase 2 阶段：占位实现，仅渲染挂载点，不引入 完整的演示浮窗逻辑。
 * 后续 Phase 6 会按需补全浮窗内容、讲稿同步、最小化/还原等能力。
 */

import { useEffect, useState } from "react";

export function FloatingPresentationSurfaceHost() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // 占位：渲染一个隐藏的挂载点，保持 Shell 结构完整
  return (
    <div
      data-presentation-surface-host="true"
      aria-hidden="true"
      style={{ display: "none" }}
    />
  );
}
