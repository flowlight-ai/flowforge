"use client";

/**
 * /council/[threadId] — 群聊会话详情路由
 *
 * 复用 CouncilContent 组件，传入 threadId 参数。
 * 与 /council 共享相同的布局（header + 会话列表 + 聊天面板）。
 */

import { CouncilContent } from "../CouncilContent";

export default function CouncilThreadPage({
  params,
}: {
  params: { threadId: string };
}) {
  return <CouncilContent threadId={params.threadId} />;
}
