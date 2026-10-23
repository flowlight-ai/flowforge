/**
 * label-cn — graph-ui 节点标签中文展示映射（web 消费端纯函数，EP-CB9）。
 *
 * graph-ui 的 GraphNodeLabel 为官方英文名（file/folder/function/…），详情侧栏需要
 * 本地中文对照文案。本函数仅负责「英文标签 → 中文展示名」映射，不塞进 graph-ui
 * （避免与官方英文名冲突）；未知名回退原值，保证前端健壮。
 *
 * 纯函数、零依赖，可独立单测；代码与文案全部内聚于此模块。
 *
 * 中文对照：节点标签中文映射 / 展示文案
 * @module @flowforge/web-frontend/components/graph/label-cn
 */

/** 英文 GraphNodeLabel → 中文展示名映射表。 */
export const GRAPH_LABEL_CN: Readonly<Record<string, string>> = {
  Project: "工程",
  Folder: "目录",
  File: "文件",
  Module: "模块",
  Function: "函数",
  Method: "方法",
  Class: "类",
  Interface: "接口",
  Enum: "枚举",
  Type: "类型",
  Variable: "变量",
};

/** 把 graph-ui 节点标签映射为中文展示名；未知名回退原值。 */
export function labelToCn(label: unknown): string {
  if (typeof label !== "string") return "—";
  return GRAPH_LABEL_CN[label] ?? label;
}

/** 把节点可选动作返回结构化字符串（行范围：startLine–endLine；缺任一侧返回 undefined）。 */
export function lineRangeText(startLine: unknown, endLine: unknown): string | undefined {
  if (typeof startLine !== "number" || typeof endLine !== "number") return undefined;
  return `${startLine}–${endLine}`;
}

/** 展示可读字符串：优先字符串，回退—。 */
export function displayText(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return "—";
}