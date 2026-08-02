import { redirect } from "next/navigation";

/**
 * /admin/models 旧入口 — 已废弃
 *
 *   原 ModelConfigPage（390 行）已合并到 /admin/settings 的 "accounts" section
 *   （"账户与密钥" — 模型 Provider、API Key、凭据管理）
 *
 * 本路由保留为 301 永久重定向，避免外链与书签失效。
 */
export default function AdminModelsRedirectPage() {
  redirect("/admin/settings?section=accounts");
}
