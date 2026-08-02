/**
 * client.ts — Forgekin 客户端逻辑
 *
 * 提供头像上传、详情拉取、配置保存三个 API 调用函数。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 *
 * 依赖：仅依赖 @/lib/council-types 的 ForgekinRosterItem，不依赖上游
 */

import type { ForgekinRosterItem } from "@/lib/council-types";

/**
 * uploadAvatarAsset —— 上传头像资源。
 *
 * 简化实现：使用 FileReader 将文件转为 base64 data URL 直接返回，
 * 不走后端对象存储。后续 Phase 可替换为真实的 /api/v1/assets 上传。
 *
 * @param file 用户选择的头像文件
 * @returns base64 data URL（可直接作为 <img src> 使用）
 */
export function uploadAvatarAsset(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("未选择文件"));
      return;
    }
    // 简单的体积与类型校验
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error("头像文件不能超过 2MB"));
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("头像必须为图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("不支持的文件内容"));
      }
    };
    reader.readAsDataURL(file);
  });
}

/**
 * fetchForgekinDetail —— 从 /api/v1/forgemind/roster 拉取 Forgekin 详情。
 *
 * 后端 roster 端点返回全部花名册，本函数在客户端按 id 过滤出目标项。
 * 当网络失败或未找到时抛出错误，由调用方决定兜底策略。
 */
export async function fetchForgekinDetail(id: string): Promise<ForgekinRosterItem> {
  const res = await fetch("/api/v1/forgemind/roster");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  const items: ForgekinRosterItem[] = data.builtin || data.roster || [];
  const found = items.find((item) => item.id === id);
  if (!found) {
    throw new Error(`未找到 Forgekin: ${id}`);
  }
  return found;
}

/**
 * saveForgekinConfig —— 保存 Forgekin 配置到 /api/v1/forgemind/{id}。
 *
 * 以 PUT 方法提交完整配置（PATCH 语义在路由层用 PUT 模拟）。
 *
 * @returns true 表示保存成功；false 表示失败（错误细节通过抛出异常传递）
 */
export async function saveForgekinConfig(id: string, payload: object): Promise<boolean> {
  const res = await fetch(`/api/v1/forgemind/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err.detail || err.message || detail;
    } catch {
      // 响应非 JSON，保持默认 detail
    }
    throw new Error(detail);
  }
  return true;
}
