"use client";

import { useState } from "react";

interface Props {
  content: string;
  onChange: (content: string) => void;
  readOnly: boolean;
  wordCount: number;
}

type ViewMode = "edit" | "preview" | "split";

function renderSimpleMarkdown(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

export function HelmEditor({ content, onChange, readOnly, wordCount }: Props) {
  const [mode, setMode] = useState<ViewMode>("preview");

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  return (
    <div className="helm-editor">
      <div className="editor-toolbar">
        <div className="editor-tabs">
          {(["preview", "edit", "split"] as ViewMode[]).map((m) => (
            <button
              key={m}
              className={`editor-tab${mode === m ? " active" : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "preview" ? "预览" : m === "edit" ? "编辑" : "分屏"}
            </button>
          ))}
        </div>
        <span className="editor-stats">{wordCount} 字</span>
        <div className="editor-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleExport}>
            导出 MD
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
            复制全文
          </button>
        </div>
      </div>

      <div className={`editor-body mode-${mode}`}>
        {(mode === "edit" || mode === "split") && (
          <textarea
            className={`editor-textarea${mode === "split" ? " half" : ""}`}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            readOnly={readOnly}
            placeholder="AI 生成的内容将在此展示..."
          />
        )}
        {(mode === "preview" || mode === "split") && (
          <div
            className={`editor-preview${mode === "split" ? " half" : ""}`}
            dangerouslySetInnerHTML={{
              __html: renderSimpleMarkdown(content),
            }}
          />
        )}
      </div>
    </div>
  );
}
