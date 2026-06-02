"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SoloTaskPhase } from "../../lib/solo-types";
import { renderMarkdown } from "./solo-utils";

function detectFileType(path: string): "markdown" | "code" | "image" | "text" {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext)) return "image";
  if (["py", "ts", "tsx", "js", "jsx", "json", "yaml", "yml", "toml", "css", "scss", "less", "html", "xml", "sh", "bat", "ps1", "sql", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "cs", "rb", "php", "vue", "svelte", "astro", "env", "cfg", "ini", "lock"].includes(ext)) return "code";
  return "text";
}

export default function MarkdownPanel({
  content, onChange, phase, filePath,
}: {
  content: string; onChange: (content: string) => void; phase: SoloTaskPhase;
  filePath?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState(content);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setEditBuffer(content); }, [content]);

  const fileType = filePath ? detectFileType(filePath) : content ? "markdown" : "text";

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    if (editMode) autoResize();
  }, [editMode, editBuffer, autoResize]);

  const handleEditChange = useCallback((val: string) => {
    setEditBuffer(val);
    setSaveStatus("idle");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onChange(val);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    }, 800);
  }, [onChange]);

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filePath?.split(/[/\\]/).pop() || "output.md"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = () => { onChange(editBuffer); setEditMode(false); setSaveStatus("idle"); };
  const handleCancelEdit = () => { setEditBuffer(content); setEditMode(false); setSaveStatus("idle"); };

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  return (
    <div className="solo-artifact-panel">
      <div className="artifact-tabs">
        <div className="artifact-tab-group">
          <button className={`artifact-tab${!editMode ? " active" : ""}`} onClick={() => setEditMode(false)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            预览
          </button>
          <button className={`artifact-tab${editMode ? " active" : ""}`} onClick={() => setEditMode(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            编辑
          </button>
        </div>
        {filePath && (
          <span className="artifact-file-type-badge">
            {fileType === "markdown" ? "📝" : fileType === "code" ? "💻" : fileType === "image" ? "🖼️" : "📄"}
            {fileType}
          </span>
        )}
        <div className="artifact-tab-spacer" />
        {saveStatus === "saved" && <span className="artifact-save-status">已保存</span>}
        <div className="artifact-tab-actions">
          {editMode ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleSaveEdit}>保存</button>
              <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>取消</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(content)}>复制</button>
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>导出</button>
            </>
          )}
        </div>
      </div>
      <div className="artifact-body">
        {editMode ? (
          <textarea ref={textareaRef} className="artifact-edit-area" value={editBuffer} onChange={(e) => handleEditChange(e.target.value)} onInput={autoResize} />
        ) : content ? (
          fileType === "image" && filePath ? (
            <div className="artifact-image-preview">
              <img src={filePath} alt={filePath.split(/[/\\]/).pop()} className="artifact-preview-img" />
            </div>
          ) : fileType === "code" && filePath ? (
            <pre className="artifact-code-preview"><code>{content}</code></pre>
          ) : (
            <div className="artifact-draft-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          )
        ) : (
          <div className="artifact-draft-empty">任务输出内容将在此展示</div>
        )}
        <div className="artifact-footer-info">{content.length} 字</div>
      </div>
    </div>
  );
}
