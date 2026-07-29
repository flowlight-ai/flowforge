"use client";

import { useState, useEffect, useMemo } from "react";

export interface Attachment {
  id: string;
  file_name: string;
  file_size: number;
  file_type: "image" | "text" | "code" | "pdf" | "json" | "other";
  mime_type: string;
  status: "uploaded" | "processing" | "ready" | "failed" | "deleted";
  url?: string;
}

interface AttachmentPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  taskId?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: Attachment["file_type"]): string {
  switch (type) {
    case "image": return "🖼";
    case "code": return "💻";
    case "text": return "📄";
    case "pdf": return "📕";
    case "json": return "📋";
    default: return "📎";
  }
}

function ImageThumbnail({ attachment }: { attachment: Attachment }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.url) {
      setThumbUrl(attachment.url);
    }
  }, [attachment.url]);

  if (!thumbUrl) {
    return (
      <div style={{
        width: 64,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-tertiary, #1e293b)",
        borderRadius: 6,
        fontSize: 24,
        flexShrink: 0,
      }}>
        🖼
      </div>
    );
  }

  return (
    <img
      src={thumbUrl}
      alt={attachment.file_name}
      style={{
        width: 64,
        height: 64,
        objectFit: "cover",
        borderRadius: 6,
        flexShrink: 0,
      }}
    />
  );
}

function AttachmentCard({ attachment, onRemove }: { attachment: Attachment; onRemove: (id: string) => void }) {
  const isFailed = attachment.status === "failed";
  const isProcessing = attachment.status === "processing";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 8px",
      background: isFailed
        ? "rgba(239, 68, 68, 0.1)"
        : "var(--bg-tertiary, #1e293b)",
      border: `1px solid ${isFailed ? "rgba(239, 68, 68, 0.3)" : "var(--border, #334155)"}`,
      borderRadius: 8,
      minWidth: 160,
      maxWidth: 220,
      flexShrink: 0,
      position: "relative",
      opacity: attachment.status === "deleted" ? 0.4 : 1,
      transition: "opacity 0.2s",
    }}>
      {attachment.file_type === "image" ? (
        <ImageThumbnail attachment={attachment} />
      ) : (
        <div style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-secondary, #1e1e2e)",
          borderRadius: 6,
          fontSize: 18,
          flexShrink: 0,
        }}>
          {getFileIcon(attachment.file_type)}
        </div>
      )}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "hidden",
        flex: 1,
        minWidth: 0,
      }}>
        <span style={{
          fontSize: 12,
          color: "var(--fg, #e2e8f0)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.3,
        }}>
          {attachment.file_name}
        </span>
        <span style={{
          fontSize: 10,
          color: "var(--muted, #64748b)",
          lineHeight: 1.2,
        }}>
          {isProcessing ? "上传中..." : isFailed ? "上传失败" : formatFileSize(attachment.file_size)}
        </span>
      </div>
      <button
        onClick={() => onRemove(attachment.id)}
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          background: "transparent",
          border: "none",
          color: "var(--muted, #64748b)",
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
          padding: "2px 4px",
          borderRadius: 4,
          transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--fg, #e2e8f0)";
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--muted, #64748b)";
          e.currentTarget.style.background = "transparent";
        }}
        title="移除附件"
      >
        ✕
      </button>
    </div>
  );
}

export default function AttachmentPreview({ attachments, onRemove, taskId }: AttachmentPreviewProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div style={{
      display: "flex",
      gap: 8,
      padding: "8px 12px",
      overflowX: "auto",
      background: "var(--bg-secondary, #1e1e2e)",
      borderTop: "1px solid var(--border, #334155)",
      scrollbarWidth: "thin",
      scrollbarColor: "var(--border, #334155) transparent",
    }}>
      {attachments.map((att) => (
        <AttachmentCard key={att.id} attachment={att} onRemove={onRemove} />
      ))}
    </div>
  );
}
