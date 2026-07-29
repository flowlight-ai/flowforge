"use client";

import { useState } from "react";
import * as Diff from "diff";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  filePath: string;
  fileName: string;
  original: string;
  current: string;
  hunks: DiffHunk[];
  action: "created" | "modified" | "deleted";
}

export function computeFileDiff(original: string, current: string, filePath: string): DiffFile {
  const patch = Diff.structuredPatch(filePath, filePath, original, current, "", "", { context: 3 });
  const hunks: DiffHunk[] = patch.hunks.map(h => {
    const lines: DiffLine[] = [];
    let o = h.oldStart;
    let n = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("+")) {
        lines.push({ type: "added", newLineNumber: n++, content: line.slice(1) });
      } else if (line.startsWith("-")) {
        lines.push({ type: "removed", oldLineNumber: o++, content: line.slice(1) });
      } else {
        lines.push({ type: "unchanged", oldLineNumber: o++, newLineNumber: n++, content: line.slice(1) });
      }
    }
    return { header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, lines };
  });
  const action = !original ? "created" : !current ? "deleted" : "modified";
  console.log("[DiffViewer] computeFileDiff", { filePath, hunkCount: hunks.length, action });
  return { filePath, fileName: filePath.split(/[/\\]/).pop() || filePath, original, current, hunks, action };
}

interface DiffViewerProps {
  files: DiffFile[];
  onAcceptFile?: (filePath: string) => void;
  onRejectFile?: (filePath: string) => void;
  onRevertAll?: () => void;
}

export default function DiffViewer({ files, onAcceptFile, onRejectFile, onRevertAll }: DiffViewerProps) {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(new Set());

  console.log("[DiffViewer] render", { fileCount: files.length, fileNames: files.map(f => f.fileName) });

  const toggleHunk = (key: string) => {
    console.log("[DiffViewer] toggleHunk", { hunkKey: key, willCollapse: !collapsedHunks.has(key) });
    setCollapsedHunks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (files.length === 0) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--muted)",
        fontSize: 13,
      }}>
        <div style={{ textAlign: "center" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, opacity: 0.4 }}>
            <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.5" /><path d="M8 17l4-4 4 4" />
          </svg>
          <div>暂无变更</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>当前没有文件变更可显示</div>
        </div>
      </div>
    );
  }

  const selectedFile = files[selectedFileIndex];

  const getActionLabel = (action: DiffFile["action"]) => {
    switch (action) {
      case "created": return { text: "新建", color: "#3fb950", bg: "rgba(46, 160, 67, 0.15)" };
      case "modified": return { text: "修改", color: "#d29922", bg: "rgba(210, 153, 34, 0.15)" };
      case "deleted": return { text: "删除", color: "#f85149", bg: "rgba(248, 81, 73, 0.15)" };
    }
  };

  const getFileStats = (file: DiffFile) => {
    let added = 0;
    let removed = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "added") added++;
        else if (line.type === "removed") removed++;
      }
    }
    return { added, removed };
  };

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg-secondary, #1e1e2e)" }}>
      {/* File list sidebar */}
      <div style={{
        width: 200,
        minWidth: 200,
        borderRight: "1px solid var(--border, #313244)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          padding: "8px 12px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          borderBottom: "1px solid var(--border, #313244)",
        }}>
          变更文件 ({files.length})
        </div>
        {files.map((file, index) => {
          const stats = getFileStats(file);
          const actionInfo = getActionLabel(file.action);
          return (
            <div
              key={file.filePath}
              onClick={() => { console.log("[DiffViewer] selectFile", { index, fileName: file.fileName, filePath: file.filePath }); setSelectedFileIndex(index); }}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                background: index === selectedFileIndex ? "var(--bg-tertiary, #313244)" : "transparent",
                borderLeft: index === selectedFileIndex ? "2px solid var(--accent, #89b4fa)" : "2px solid transparent",
                fontSize: 12,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
                <span style={{
                  fontSize: 9,
                  padding: "1px 4px",
                  borderRadius: 3,
                  color: actionInfo.color,
                  background: actionInfo.bg,
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {actionInfo.text}
                </span>
                <span style={{
                  color: "var(--fg, #cdd6f4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {file.fileName}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 10, color: "var(--muted)" }}>
                {stats.added > 0 && <span style={{ color: "#3fb950" }}>+{stats.added}</span>}
                {stats.removed > 0 && <span style={{ color: "#f85149" }}>-{stats.removed}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Diff content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header with action buttons */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid var(--border, #313244)",
          background: "var(--bg-secondary, #1e1e2e)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg, #cdd6f4)" }}>
              {selectedFile.fileName}
            </span>
            <span style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 3,
              color: getActionLabel(selectedFile.action).color,
              background: getActionLabel(selectedFile.action).bg,
              fontWeight: 600,
            }}>
              {getActionLabel(selectedFile.action).text}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {selectedFile.filePath}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {onAcceptFile && (
              <button
                onClick={() => { console.log("[DiffViewer] acceptFile", { filePath: selectedFile.filePath }); onAcceptFile(selectedFile.filePath); }}
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  borderRadius: 4,
                  border: "1px solid #3fb950",
                  background: "rgba(46, 160, 67, 0.1)",
                  color: "#3fb950",
                  cursor: "pointer",
                }}
              >
                接受
              </button>
            )}
            {onRejectFile && (
              <button
                onClick={() => { console.log("[DiffViewer] rejectFile", { filePath: selectedFile.filePath }); onRejectFile(selectedFile.filePath); }}
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  borderRadius: 4,
                  border: "1px solid #f85149",
                  background: "rgba(248, 81, 73, 0.1)",
                  color: "#f85149",
                  cursor: "pointer",
                }}
              >
                拒绝
              </button>
            )}
          </div>
        </div>

        {/* Global action bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border, #313244)",
          background: "var(--bg-primary, #11111b)",
        }}>
          {onRevertAll && (
            <button
              onClick={() => { console.log("[DiffViewer] revertAll"); onRevertAll(); }}
              style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid var(--border, #45475a)",
                background: "transparent",
                color: "var(--fg, #cdd6f4)",
                cursor: "pointer",
              }}
            >
              回退到原始版本
            </button>
          )}
          {onAcceptFile && (
            <button
              onClick={() => { console.log("[DiffViewer] acceptAll", { fileCount: files.length, filePaths: files.map(f => f.filePath) }); files.forEach(f => onAcceptFile(f.filePath)); }}
              style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid #3fb950",
                background: "rgba(46, 160, 67, 0.1)",
                color: "#3fb950",
                cursor: "pointer",
              }}
            >
              全部接受
            </button>
          )}
          {onRejectFile && (
            <button
              onClick={() => { console.log("[DiffViewer] rejectAll", { fileCount: files.length, filePaths: files.map(f => f.filePath) }); files.forEach(f => onRejectFile(f.filePath)); }}
              style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid #f85149",
                background: "rgba(248, 81, 73, 0.1)",
                color: "#f85149",
                cursor: "pointer",
              }}
            >
              全部拒绝
            </button>
          )}
        </div>

        {/* Diff hunks */}
        <div style={{ flex: 1, overflowY: "auto", fontFamily: "monospace", fontSize: 13 }}>
          {selectedFile.hunks.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)", fontSize: 12, textAlign: "center" }}>
              文件内容无差异
            </div>
          ) : (
            selectedFile.hunks.map((hunk, hunkIndex) => {
              const hunkKey = `${selectedFileIndex}-${hunkIndex}`;
              const isCollapsed = collapsedHunks.has(hunkKey);
              return (
                <div key={hunkIndex}>
                  {/* Hunk header */}
                  <div
                    onClick={() => toggleHunk(hunkKey)}
                    style={{
                      background: "#45475a",
                      color: "var(--muted, #6c7086)",
                      padding: "2px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                      userSelect: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 10 }}>{isCollapsed ? "▶" : "▼"}</span>
                    <span style={{ color: "#89b4fa" }}>{hunk.header}</span>
                  </div>
                  {/* Hunk lines */}
                  {!isCollapsed && hunk.lines.map((line, lineIndex) => {
                    let bg = "transparent";
                    let color = "var(--fg, #cdd6f4)";
                    if (line.type === "added") {
                      bg = "rgba(46, 160, 67, 0.15)";
                      color = "#3fb950";
                    } else if (line.type === "removed") {
                      bg = "rgba(248, 81, 73, 0.15)";
                      color = "#f85149";
                    }
                    return (
                      <div
                        key={lineIndex}
                        style={{
                          display: "flex",
                          background: bg,
                          lineHeight: "20px",
                          minHeight: 20,
                        }}
                      >
                        {/* Old line number */}
                        <div style={{
                          width: 40,
                          minWidth: 40,
                          textAlign: "right",
                          paddingRight: 8,
                          color: "var(--muted, #6c7086)",
                          userSelect: "none",
                          fontSize: 12,
                          borderRight: "1px solid var(--border, #313244)",
                        }}>
                          {line.oldLineNumber ?? ""}
                        </div>
                        {/* New line number */}
                        <div style={{
                          width: 40,
                          minWidth: 40,
                          textAlign: "right",
                          paddingRight: 8,
                          color: "var(--muted, #6c7086)",
                          userSelect: "none",
                          fontSize: 12,
                          borderRight: "1px solid var(--border, #313244)",
                        }}>
                          {line.newLineNumber ?? ""}
                        </div>
                        {/* Line prefix */}
                        <div style={{
                          width: 20,
                          minWidth: 20,
                          textAlign: "center",
                          color,
                          userSelect: "none",
                          fontWeight: 600,
                        }}>
                          {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                        </div>
                        {/* Content */}
                        <div style={{
                          flex: 1,
                          paddingLeft: 4,
                          color,
                          whiteSpace: "pre",
                          overflowX: "auto",
                        }}>
                          {line.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
