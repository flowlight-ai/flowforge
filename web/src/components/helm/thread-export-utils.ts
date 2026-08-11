/**
 * 会话导出工具
 *
 * 参考 clowder-ai ThreadItem 的导出功能：优先调用后端 /export 接口，
 * 失败时回退到前端拼接基础 Markdown（拉取消息列表）。
 */

import type { Thread } from "@/stores/threadStore";

/** 把文件名中的非法字符替换为下划线 */
function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_") || "thread";
}

/** 触发浏览器下载 Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出会话为 Markdown 文件。
 *
 * 优先调用 GET /api/v1/threads/{id}/export?format=md；
 * 后端不支持时回退到拉取消息列表自行拼接。
 */
export async function exportThreadAsMarkdown(thread: Thread): Promise<void> {
  try {
    const res = await fetch(
      `/api/v1/threads/${thread.id}/export?format=md`
    );
    if (res.ok) {
      const blob = await res.blob();
      downloadBlob(blob, `${safeFileName(thread.title)}.md`);
      return;
    }
    // 后端不支持导出时，前端拼接基础信息
    const messagesRes = await fetch(
      `/api/v1/threads/${thread.id}/messages?limit=500`
    );
    const messages = messagesRes.ok ? await messagesRes.json() : [];
    const lines: string[] = [
      `# ${thread.title}`,
      "",
      `> 会话 ID: ${thread.id}`,
      `> 创建时间: ${thread.created_at}`,
      `> 更新时间: ${thread.updated_at}`,
      "",
      "---",
      "",
    ];
    for (const msg of messages.items ?? messages ?? []) {
      const ts = new Date(msg.timestamp).toLocaleString();
      const who =
        msg.source === "user"
          ? "用户"
          : msg.forgekin_name
            ? `${msg.forgekin_name}（${msg.forgekin_role ?? ""}）`
            : "系统";
      lines.push(
        `## ${who} · ${ts}`,
        "",
        msg.content ?? "",
        "",
        "---",
        ""
      );
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    downloadBlob(blob, `${safeFileName(thread.title)}.md`);
  } catch (e) {
    console.error("导出会话失败:", e);
    alert("导出会话失败，请查看控制台");
  }
}
