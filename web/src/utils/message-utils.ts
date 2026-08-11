/**
 * 消息操作工具函数
 *
 * 提供消息复制、删除（软/硬）、编辑、分支等核心操作函数，
 * 参考 clowder-ai 的 MessageActions 设计，适配 flowforge 数据结构。
 */

import type {
  CouncilMessage,
  MessageBranch,
  BranchType,
  MessageSoftDelete,
  MessageStatus,
} from "../lib/council-types";

// ── 复制消息 ────────────────────────────────────────────────────

/**
 * 复制消息内容到剪贴板
 * @param msg - 要复制的消息
 * @returns 是否复制成功
 */
export async function copyMessage(msg: CouncilMessage): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    // 构建格式化文本：包含来源和时间戳
    const sourceLabel = getSourceLabel(msg);
    const time = formatTime(msg.timestamp);
    const text = `[${sourceLabel}] ${time}\n${msg.content}`;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取消息来源标签
 */
function getSourceLabel(msg: CouncilMessage): string {
  switch (msg.source) {
    case "user":
      return "我";
    case "forgekin":
      return msg.forgekinName || "智能体";
    case "system":
      return "系统";
    default:
      return "未知";
  }
}

/**
 * 格式化时间戳为可读字符串
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 格式化时间戳为完整日期时间
 */
export function formatFullTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── 删除消息 ────────────────────────────────────────────────────

/**
 * 软删除消息（标记删除而非真正移除）
 * @param msg - 要删除的消息
 * @param deletedBy - 删除者
 * @param reason - 删除原因
 * @returns 更新后的消息（带 softDelete 标记）
 */
export function softDeleteMessage(
  msg: CouncilMessage,
  deletedBy: "user" | "system" = "user",
  reason?: string,
): CouncilMessage {
  return {
    ...msg,
    softDelete: {
      deleted: true,
      deletedAt: Date.now(),
      deletedBy,
      reason,
    },
  };
}

/**
 * 硬删除消息（从消息列表中移除）
 * 由调用方处理列表过滤逻辑，此函数仅返回过滤谓词
 * @param msg - 要删除的消息
 * @returns 是否应被移除
 */
export function isHardDeleted(msg: CouncilMessage): boolean {
  return msg.softDelete?.deleted === true;
}

/**
 * 检查消息是否已软删除
 */
export function isSoftDeleted(msg: CouncilMessage): boolean {
  return msg.softDelete?.deleted === true;
}

// ── 编辑消息 ────────────────────────────────────────────────────

/**
 * 编辑消息内容
 * @param msg - 原消息
 * @param newContent - 新内容
 * @returns 更新后的消息（保留原 meta 和 timestamp）
 */
export function editMessage(
  msg: CouncilMessage,
  newContent: string,
): CouncilMessage {
  return {
    ...msg,
    content: newContent,
    // 编辑后添加编辑标记（通过 meta 传递）
    meta: {
      ...msg.meta,
      editedAt: Date.now(),
    },
  };
}

// ── 消息分支 ────────────────────────────────────────────────────

/**
 * 从父消息创建分支消息
 * @param parentMsg - 父消息
 * @param branchType - 分支类型
 * @param newContent - 分支后的新内容（可选，不传则沿用父消息内容）
 * @param reason - 分支原因
 * @returns 新分支消息
 */
export function branchMessage(
  parentMsg: CouncilMessage,
  branchType: BranchType,
  newContent?: string,
  reason?: string,
): CouncilMessage {
  const branch: MessageBranch = {
    type: branchType,
    parentId: parentMsg.id,
    timestamp: Date.now(),
    reason,
  };

  return {
    id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: parentMsg.source,
    forgekinId: parentMsg.forgekinId,
    forgekinName: parentMsg.forgekinName,
    forgekinRole: parentMsg.forgekinRole,
    content: newContent ?? parentMsg.content,
    timestamp: Date.now(),
    branch,
    meta: parentMsg.meta ? { ...parentMsg.meta } : undefined,
    messageType: parentMsg.messageType,
  };
}

/**
 * 获取消息的显示状态标签
 * @param status - 消息状态
 * @returns 中文状态标签
 */
export function getMessageStatusLabel(status?: MessageStatus): string {
  switch (status) {
    case "sending":
      return "发送中";
    case "sent":
      return "已发送";
    case "read":
      return "已读";
    case "failed":
      return "发送失败";
    default:
      return "";
  }
}

/**
 * 获取消息状态指示器颜色
 * @param status - 消息状态
 * @returns CSS 颜色值
 */
export function getMessageStatusColor(status?: MessageStatus): string {
  switch (status) {
    case "sending":
      return "var(--muted)";
    case "sent":
      return "var(--muted)";
    case "read":
      return "#22c55e";
    case "failed":
      return "#ef4444";
    default:
      return "transparent";
  }
}

// ── 消息分组与过滤 ──────────────────────────────────────────────

/**
 * 按时间线分组消息（用于分支视图）
 * @param messages - 所有消息
 * @returns 按时间线分组的消息列表
 */
export function groupMessagesByTimeline(
  messages: CouncilMessage[],
): Map<string, CouncilMessage[]> {
  const groups = new Map<string, CouncilMessage[]>();

  // 根时间线（无分支的消息）
  const rootTimeline: CouncilMessage[] = [];

  for (const msg of messages) {
    if (msg.branch) {
      // 分支消息归入独立时间线
      const timelineKey = `branch-${msg.branch.parentId}`;
      const existing = groups.get(timelineKey) || [];
      existing.push(msg);
      groups.set(timelineKey, existing);
    } else {
      rootTimeline.push(msg);
    }
  }

  groups.set("root", rootTimeline);
  return groups;
}

/**
 * 过滤掉已软删除的消息
 * @param messages - 消息列表
 * @returns 过滤后的消息列表
 */
export function filterSoftDeleted(
  messages: CouncilMessage[],
): CouncilMessage[] {
  return messages.filter((msg) => !isSoftDeleted(msg));
}

/**
 * 查找消息的分支子消息
 * @param msg - 父消息
 * @param allMessages - 全部消息列表
 * @returns 分支子消息列表
 */
export function findBranchChildren(
  msg: CouncilMessage,
  allMessages: CouncilMessage[],
): CouncilMessage[] {
  return allMessages.filter(
    (m) => m.branch?.parentId === msg.id,
  );
}

/**
 * 检查消息是否有分支
 */
export function hasBranches(
  msg: CouncilMessage,
  allMessages: CouncilMessage[],
): boolean {
  return findBranchChildren(msg, allMessages).length > 0;
}

// ── 消息内容预览 ────────────────────────────────────────────────

/**
 * 获取消息内容预览（截断长文本）
 * @param content - 消息内容
 * @param maxLength - 最大长度（默认 80）
 * @returns 截断后的预览文本
 */
export function getMessagePreview(content: string, maxLength = 80): string {
  const text = content.replace(/\n/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/**
 * 获取消息类型图标
 * @param messageType - 消息类型
 * @returns emoji 图标
 */
export function getMessageTypeIcon(messageType?: string): string {
  switch (messageType) {
    case "cli_output":
      return "💻";
    case "approval":
      return "✅";
    case "rich_block":
      return "📦";
    case "text":
      return "💬";
    default:
      return "💬";
  }
}