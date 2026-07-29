"use client";

/**
 * useHelmDiff — Diff 文件变更 + 附件状态 Hook（Phase 3 拆分）
 *
 * 从 helm.entries 的 tool-call 结果中检测 file_changes 并合并到 diffFiles。
 *
 * 替代 HelmLayout 中的 useState：
 *   diffFiles / attachments
 */

import { useState, useEffect, useCallback } from "react";
import { DiffFile, computeFileDiff } from "../DiffViewer";
import { Attachment } from "../AttachmentPreview";
import type { useHelmWebSocket } from "../../../hooks/useHelmWebSocket";

type HelmWS = ReturnType<typeof useHelmWebSocket>;

export function useHelmDiff(helm: HelmWS) {
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // 从 tool-call 结果中检测 file_changes
  useEffect(() => {
    for (const entry of helm.entries) {
      if (entry.type === "tool-call" && entry.data?.result) {
        const result = entry.data.result;
        if (result?.file_changes && Array.isArray(result.file_changes)) {
          const newDiffs: DiffFile[] = result.file_changes.map(
            (change: any) => {
              const original = change.original ?? change.before ?? "";
              const current =
                change.current ?? change.after ?? change.content ?? "";
              return computeFileDiff(
                original,
                current,
                change.file_path || change.path || "unknown"
              );
            }
          );
          if (newDiffs.length > 0) {
            setDiffFiles((prev) => {
              const existingPaths = new Set(prev.map((f) => f.filePath));
              const merged = [...prev];
              for (const d of newDiffs) {
                if (existingPaths.has(d.filePath)) {
                  const idx = merged.findIndex((f) => f.filePath === d.filePath);
                  merged[idx] = d;
                } else {
                  merged.push(d);
                }
              }
              return merged;
            });
          }
        }
      }
    }
  }, [helm.entries]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeDiffFile = useCallback((filePath: string) => {
    setDiffFiles((prev) => prev.filter((f) => f.filePath !== filePath));
  }, []);

  const clearDiffFiles = useCallback(() => {
    setDiffFiles([]);
  }, []);

  const clearAll = useCallback(() => {
    setDiffFiles([]);
    setAttachments([]);
  }, []);

  return {
    diffFiles,
    setDiffFiles,
    attachments,
    setAttachments,
    removeAttachment,
    removeDiffFile,
    clearDiffFiles,
    clearAll,
  };
}
