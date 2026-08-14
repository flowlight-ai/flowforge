/**
 * /council — 群聊独立路由
 *
 * Next.js page 文件只允许约定导出（default/metadata/viewport 等），
 * 页面内容拆至 CouncilContent（/council 与 /council/[threadId] 共用）。
 */

import { CouncilContent } from "./CouncilContent";

export default function CouncilPage() {
  return <CouncilContent threadId={null} />;
}
