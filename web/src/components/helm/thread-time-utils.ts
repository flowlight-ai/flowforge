/**
 * 会话时间格式化工具
 *
 * 参考 clowder-ai/packages/web/src/components/ThreadSidebar/thread-utils.ts 的
 * formatRelativeTime 实现。支持紧凑和完整两种输出格式。
 */

/**
 * 将时间戳/时间字符串格式化为相对时间（如"刚刚 / 5 分钟前 / 3 天前"）。
 *
 * @param ts  时间戳（毫秒）或可被 Date 解析的字符串
 * @param compact  紧凑模式：true=「5分」/「3时」/「2天」，false=「5分钟前」/「3小时前」
 */
export function formatRelativeTime(
  ts: number | string,
  compact = false
): string {
  const time = typeof ts === "string" ? new Date(ts).getTime() : ts;
  if (!Number.isFinite(time)) return "";

  const diff = Date.now() - time;
  // 未来时间回退为日期字符串
  if (diff < 0) return new Date(time).toLocaleDateString();

  if (compact) {
    if (diff < 60_000) return "刚刚";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}时`;
    return `${Math.floor(diff / 86400_000)}天`;
  }

  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86400_000)}天前`;
}
