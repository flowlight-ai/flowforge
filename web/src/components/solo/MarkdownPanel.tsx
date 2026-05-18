"use client";

import { useState, useEffect } from "react";
import { SoloTaskPhase } from "../../lib/solo-types";
import { renderMarkdown } from "./solo-utils";

export default function MarkdownPanel({
  content, onChange, phase,
}: {
  content: string; onChange: (content: string) => void; phase: SoloTaskPhase;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState(content);
  useEffect(() => { setEditBuffer(content); }, [content]);

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "output.md"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = () => { onChange(editBuffer); setEditMode(false); };
  const handleCancelEdit = () => { setEditBuffer(content); setEditMode(false); };

  return (
    <div className="solo-artifact-panel">
      <div className="artifact-tabs">
        <div className="artifact-tab-group">
          <button className={`artifact-tab${!editMode ? " active" : ""}`} onClick={() => setEditMode(false)}>预览</button>
          <button className={`artifact-tab${editMode ? " active" : ""}`} onClick={() => setEditMode(true)}>编辑</button>
        </div>
        <div className="artifact-tab-spacer" />
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
          <textarea className="artifact-edit-area" value={editBuffer} onChange={(e) => setEditBuffer(e.target.value)} />
        ) : content ? (
          <div className="artifact-draft-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        ) : (
          <div className="artifact-draft-empty">任务输出内容将在此展示</div>
        )}
        <div className="artifact-footer-info">{content.length} 字</div>
      </div>
    </div>
  );
}
