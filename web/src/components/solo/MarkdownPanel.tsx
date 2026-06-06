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

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, string> = {
    md: "📝", txt: "📄", json: "📋", yaml: "⚙️", yml: "⚙️",
    py: "🐍", ts: "🔷", tsx: "⚛️", js: "📜", css: "🎨",
    html: "🌐", sh: "🖥️", sql: "🗃️", csv: "📊",
  };
  return icons[ext] || "📄";
}

export interface OpenTab {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  type?: "editor" | "diff" | "settings";
}

interface MarkdownPanelProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  phase: SoloTaskPhase;
  showSettings?: boolean;
  onCloseSettings?: () => void;
  panelVisibility?: { chat: boolean; editor: boolean; explorer: boolean };
  onTogglePanel?: (panel: "editor" | "explorer") => void;
  onOpenSettings?: () => void;
  collapsed?: boolean;
}

function computeDiff(original: string, current: string) {
  const origLines = original.split("\n");
  const curLines = current.split("\n");
  const maxLen = Math.max(origLines.length, curLines.length);
  const result: { origLine: string | null; curLine: string | null; type: "removed" | "added" | "unchanged" }[] = [];

  // Simple line-by-line diff
  let oi = 0, ci = 0;
  while (oi < origLines.length || ci < curLines.length) {
    if (oi < origLines.length && ci < curLines.length) {
      if (origLines[oi] === curLines[ci]) {
        result.push({ origLine: origLines[oi], curLine: curLines[ci], type: "unchanged" });
        oi++; ci++;
      } else {
        // Check if the current line was added
        let foundInOrig = false;
        for (let k = oi + 1; k < Math.min(oi + 5, origLines.length); k++) {
          if (origLines[k] === curLines[ci]) { foundInOrig = true; break; }
        }
        if (foundInOrig) {
          result.push({ origLine: origLines[oi], curLine: null, type: "removed" });
          oi++;
        } else {
          result.push({ origLine: null, curLine: curLines[ci], type: "added" });
          ci++;
        }
      }
    } else if (oi < origLines.length) {
      result.push({ origLine: origLines[oi], curLine: null, type: "removed" });
      oi++;
    } else {
      result.push({ origLine: null, curLine: curLines[ci], type: "added" });
      ci++;
    }
  }
  return result;
}

export default function MarkdownPanel({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onContentChange,
  phase,
  showSettings,
  onCloseSettings,
  panelVisibility,
  onTogglePanel,
  onOpenSettings,
  collapsed,
}: MarkdownPanelProps) {
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [primaryTab, setPrimaryTab] = useState<"editor" | "diff" | "settings" | "terminal">("editor");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [terminalHistory, setTerminalHistory] = useState<{cmd: string; output: string; timestamp: number}[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [modelProviders, setModelProviders] = useState<{name: string; base_url: string; key_configured: boolean; key_masked: string}[]>([]);
  const [modelAssignments, setModelAssignments] = useState<{key: string; primary: string; fallbacks: string[]}[]>([]);
  const [workspaceInfo, setWorkspaceInfo] = useState<{name: string; display_name: string; path: string; task_count: number}[]>([]);

  // Auto-switch to settings tab when showSettings becomes true
  useEffect(() => {
    if (showSettings) {
      setPrimaryTab("settings");
    }
  }, [showSettings]);

  // Fetch settings data when settings tab is active
  useEffect(() => {
    if (primaryTab !== "settings") return;
    fetch("/api/v1/settings/providers")
      .then((r) => r.json())
      .then((data) => {
        const providers = data?.data?.providers || data?.providers || [];
        setModelProviders(providers);
      })
      .catch(() => {});
    fetch("/api/v1/admin/models/assignments")
      .then((r) => r.json())
      .then((data) => {
        const assignments = data?.data?.assignments || data?.assignments || [];
        setModelAssignments(assignments);
      })
      .catch(() => {});
    fetch("/api/v1/workspace/named")
      .then((r) => r.json())
      .then((data) => {
        const workspaces = data?.workspaces || data?.data?.workspaces || [];
        setWorkspaceInfo(workspaces);
      })
      .catch(() => {});
  }, [primaryTab]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const content = activeTab?.content || "";
  const filePath = activeTab?.filePath || "";
  const fileType = filePath ? detectFileType(filePath) : content ? "markdown" : "text";

  useEffect(() => {
    if (activeTab) {
      setEditBuffer(activeTab.content);
      setEditMode(false);
    }
  }, [activeTabId]);

  useEffect(() => {
    if (activeTab) {
      setEditBuffer(activeTab.content);
    }
  }, [activeTab?.content]);

  // Close plus menu on outside click
  useEffect(() => {
    if (!plusMenuOpen && !moreMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [plusMenuOpen, moreMenuOpen]);

  const handleEditChange = useCallback((val: string) => {
    setEditBuffer(val);
    setSaveStatus("idle");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (activeTabId) {
        onContentChange(activeTabId, val);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      }
    }, 800);
  }, [activeTabId, onContentChange]);

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath?.split(/[/\\]/).pop() || "output.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = () => {
    if (activeTabId) {
      onContentChange(activeTabId, editBuffer);
      setEditMode(false);
      setSaveStatus("idle");
    }
  };

  const handleCancelEdit = () => {
    setEditBuffer(content);
    setEditMode(false);
    setSaveStatus("idle");
  };

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onTabClose(tabId);
  };

  const handleOpenDiffTab = useCallback(() => {
    if (!activeTab || !activeTab.isDirty) return;
    // Find if a diff tab already exists for this file
    const diffTabId = `diff-${activeTab.id}`;
    const existingDiffTab = tabs.find((t) => t.id === diffTabId);
    if (existingDiffTab) {
      onTabSelect(diffTabId);
      return;
    }
    // Create a new diff tab - we need to add it via the parent
    // Since we can't add tabs directly, we'll switch the current tab type
    // For now, we'll just toggle the type on the active tab
    // The parent component manages tabs, so we use onContentChange to signal
    // Actually, let's just change the active tab's type property
    // We need a way to update tab type - let's use onContentChange with same content
    // to trigger a re-render, and store the diff mode locally
    setPlusMenuOpen(false);
  }, [activeTab, tabs, onTabSelect]);

  const handleRevertToOriginal = useCallback(() => {
    if (!activeTab || !activeTab.originalContent) return;
    onContentChange(activeTab.id, activeTab.originalContent);
    setEditBuffer(activeTab.originalContent);
  }, [activeTab, onContentChange]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Track which tabs are in diff mode locally
  const [diffTabIds, setDiffTabIds] = useState<Set<string>>(new Set());

  const openDiffForActiveTab = useCallback(() => {
    if (!activeTab || !activeTab.isDirty) return;
    setDiffTabIds((prev) => new Set(prev).add(activeTab.id));
    setPlusMenuOpen(false);
  }, [activeTab]);

  const closeDiffMode = useCallback(() => {
    if (!activeTab) return;
    setDiffTabIds((prev) => {
      const next = new Set(prev);
      next.delete(activeTab.id);
      return next;
    });
  }, [activeTab]);

  const isDiffMode = activeTab ? diffTabIds.has(activeTab.id) : false;

  // When switching to diff primary tab, auto-enable diff mode
  const handlePrimaryTabChange = useCallback((tab: "editor" | "diff" | "settings") => {
    setPrimaryTab(tab);
    if (tab === "diff" && activeTab && activeTab.isDirty) {
      setDiffTabIds((prev) => new Set(prev).add(activeTab.id));
    }
    if (tab === "editor") {
      closeDiffMode();
      if (onCloseSettings) onCloseSettings();
    }
    if (tab === "settings") {
      // settings mode
    }
  }, [activeTab, closeDiffMode, onCloseSettings]);

  return (
    <div className="solo-artifact-panel">
      {/* Primary tab bar - always visible even when collapsed */}
      <div className="editor-primary-tabs">
        <div className={`editor-primary-tab-wrapper${primaryTab === "editor" ? " active" : ""}`}>
          <div className="editor-primary-tab" onClick={() => handlePrimaryTabChange("editor")} title="编辑器">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {!collapsed && <span className="editor-primary-tab-label">编辑器</span>}
          </div>
          <button className="editor-primary-tab-close" onClick={() => onTogglePanel?.("editor")} title="关闭编辑器">✕</button>
        </div>
        <div className={`editor-primary-tab-wrapper${primaryTab === "diff" ? " active" : ""}${!activeTab || !activeTab.isDirty ? " disabled" : ""}`}>
          <div className="editor-primary-tab" onClick={() => { if (activeTab?.isDirty) handlePrimaryTabChange("diff"); }} title="查看变更">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.5" /><path d="M8 17l4-4 4 4" />
            </svg>
            {!collapsed && <span className="editor-primary-tab-label">查看变更</span>}
          </div>
          <button className="editor-primary-tab-close" onClick={() => handlePrimaryTabChange("editor")} title="关闭变更">✕</button>
        </div>
        <div className={`editor-primary-tab-wrapper${primaryTab === "settings" ? " active" : ""}`}>
          <div className="editor-primary-tab" onClick={() => handlePrimaryTabChange("settings")} title="设置">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {!collapsed && <span className="editor-primary-tab-label">设置</span>}
          </div>
          <button className="editor-primary-tab-close" onClick={() => { onCloseSettings?.(); handlePrimaryTabChange("editor"); }} title="关闭设置">✕</button>
        </div>
        <div className="editor-primary-tabs-spacer" />
        <div className="editor-primary-more" ref={moreMenuRef} style={{ position: "relative" }}>
          <button
            className="editor-primary-tab"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            title="更多工具"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {moreMenuOpen && (
            <div className="editor-plus-dropdown">
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { handlePrimaryTabChange("diff"); setMoreMenuOpen(false); }}
                disabled={!activeTab || !activeTab.isDirty}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.5" /><path d="M8 17l4-4 4 4" />
                </svg>
                查看变更
              </button>
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { onOpenSettings?.(); setMoreMenuOpen(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                设置
              </button>
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { handlePrimaryTabChange("settings"); setMoreMenuOpen(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                终端
              </button>
              <div className="editor-plus-dropdown-divider" />
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { setMoreMenuOpen(false); }}
              >
                🔍 搜索工具
              </button>
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { setMoreMenuOpen(false); }}
              >
                📤 发布工具
              </button>
              <div className="editor-plus-dropdown-divider" />
              <button
                className={`editor-plus-dropdown-item${panelVisibility?.editor ? " active" : ""}`}
                onClick={() => { onTogglePanel?.("editor"); setMoreMenuOpen(false); }}
              >
                📝 编辑器
                {panelVisibility?.editor && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>}
              </button>
              <button
                className={`editor-plus-dropdown-item${panelVisibility?.explorer ? " active" : ""}`}
                onClick={() => { onTogglePanel?.("explorer"); setMoreMenuOpen(false); }}
              >
                📁 资源管理器
                {panelVisibility?.explorer && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>}
              </button>
              <div className="editor-plus-dropdown-divider" />
              <button
                className="editor-plus-dropdown-item"
                onClick={() => { onOpenSettings?.(); setMoreMenuOpen(false); }}
              >
                ⚙️ 设置
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Secondary file tabs (only shown in editor primary tab) */}
      {primaryTab === "editor" && !collapsed && (
      <div className="editor-tab-bar">
        <div className="editor-tab-scroll">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`editor-file-tab ${tab.id === activeTabId ? "active" : ""}${diffTabIds.has(tab.id) ? " diff-tab" : ""}`}
              onClick={() => onTabSelect(tab.id)}
              title={tab.filePath}
            >
              <span className="editor-file-tab-icon">{diffTabIds.has(tab.id) ? "🔀" : getFileIcon(tab.fileName)}</span>
              <span className="editor-file-tab-name">{diffTabIds.has(tab.id) ? `变更: ${tab.fileName}` : tab.fileName}</span>
              {tab.isDirty && !diffTabIds.has(tab.id) && <span className="editor-file-tab-dot" />}
              <button
                className="editor-file-tab-close"
                onClick={(e) => handleTabClose(e, tab.id)}
                title="关闭"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="editor-tab-actions">
          {activeTab && !isDiffMode && (
            <>
              {editMode ? (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={handleSaveEdit}>保存</button>
                  <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>取消</button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditMode(true)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    编辑
                  </button>
                  {activeTab.isDirty && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handlePrimaryTabChange("diff")} title="查看变更">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.5" /><path d="M8 17l4-4 4 4" />
                      </svg>
                      查看变更
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(content)}>复制</button>
                  <button className="btn btn-ghost btn-sm" onClick={handleExport}>导出</button>
                </>
              )}
            </>
          )}
          {activeTab && isDiffMode && (
            <button className="btn btn-ghost btn-sm" onClick={closeDiffMode}>
              返回编辑
            </button>
          )}
          {saveStatus === "saved" && <span className="artifact-save-status">已保存</span>}
        </div>
      </div>
      )}
      {!collapsed && (
      <>
        <div className="artifact-body">
          {primaryTab === "settings" ? (
            <div className="settings-in-editor" style={{ padding: 16, overflowY: "auto", height: "100%" }}>
              {/* 模型配置区域 */}
              <div className="settings-section" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>
                  模型配置
                </h3>
                {modelProviders.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>加载中...</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {modelProviders.map((p) => (
                      <div key={p.name} style={{ background: "var(--bg-secondary, #1e1e2e)", borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)", minWidth: 80 }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base_url}</span>
                        <span style={{ fontSize: 11, color: p.key_configured ? "#a6e3a1" : "#f38ba8", fontWeight: 500 }}>
                          {p.key_configured ? "✓ 已配置" : "✗ 未配置"}
                        </span>
                        {p.key_masked && <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{p.key_masked}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {modelAssignments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg)", marginBottom: 6 }}>模型分配</div>
                    {modelAssignments.map((a) => (
                      <div key={a.key} style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 500, color: "var(--fg)", minWidth: 60 }}>{a.key}</span>
                        <span>→</span>
                        <span style={{ color: "#89b4fa" }}>{a.primary}</span>
                        {a.fallbacks.length > 0 && <span style={{ color: "var(--muted)" }}>(回退: {a.fallbacks.join(", ")})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 工作区信息区域 */}
              <div className="settings-section" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  工作区
                </h3>
                {workspaceInfo.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>加载中...</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {workspaceInfo.map((ws) => (
                      <div key={ws.name} style={{ background: "var(--bg-secondary, #1e1e2e)", borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{ws.display_name || ws.name}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ws.path}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{ws.task_count} 任务</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 终端命令区域 */}
              <div className="settings-section" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                  终端命令
                </h3>
                <div className="terminal-output" style={{ background: "#1e1e2e", color: "#cdd6f4", fontFamily: "monospace", padding: 12, borderRadius: 6, maxHeight: 300, overflowY: "auto", fontSize: 12, minHeight: 80 }}>
                  {terminalHistory.length === 0 && (
                    <div style={{ color: "#6c7086", fontSize: 11 }}>在下方输入命令执行...</div>
                  )}
                  {terminalHistory.map((item, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ color: "#a6e3a1" }}>$ {item.cmd}</div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#cdd6f4" }}>{item.output}</pre>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <span style={{ color: "#a6e3a1", fontFamily: "monospace", fontSize: 12 }}>$</span>
                  <input
                    style={{ flex: 1, background: "#1e1e2e", border: "1px solid #45475a", borderRadius: 4, color: "#cdd6f4", fontFamily: "monospace", fontSize: 12, outline: "none", padding: "4px 8px" }}
                    value={terminalInput}
                    onChange={(e) => setTerminalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && terminalInput.trim()) {
                        const cmd = terminalInput.trim();
                        setTerminalInput("");
                        setTerminalRunning(true);
                        fetch("/api/v1/system/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ command: cmd }),
                        })
                          .then(r => r.json())
                          .then(data => {
                            setTerminalHistory(prev => [...prev, { cmd, output: data.output || data.error || "（无输出）", timestamp: Date.now() }]);
                            setTerminalRunning(false);
                          })
                          .catch((err) => {
                            setTerminalHistory(prev => [...prev, { cmd, output: `错误: ${err.message}`, timestamp: Date.now() }]);
                            setTerminalRunning(false);
                          });
                      }
                    }}
                    placeholder="输入命令..."
                    disabled={terminalRunning}
                  />
                </div>
              </div>

              {/* 关于区域 */}
              <div className="settings-section" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  关于
                </h3>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.8 }}>
                  <div>FlowForge <span style={{ color: "var(--fg)", fontWeight: 500 }}>v0.1.0</span></div>
                  <div>AI Agent 智能内容创作与分发系统</div>
                </div>
              </div>
            </div>
          ) : primaryTab === "diff" && activeTab && activeTab.isDirty ? (
            <DiffViewer
              original={activeTab.originalContent}
              current={activeTab.content}
              onRevert={handleRevertToOriginal}
            />
          ) : activeTab && isDiffMode ? (
            <DiffViewer
              original={activeTab.originalContent}
              current={activeTab.content}
              onRevert={handleRevertToOriginal}
            />
          ) : activeTab ? (
            editMode ? (
              <textarea
                className="artifact-edit-area"
                value={editBuffer}
                onChange={(e) => handleEditChange(e.target.value)}
              />
            ) : fileType === "image" && filePath ? (
              <div className="artifact-image-preview">
                <img src={filePath} alt={filePath.split(/[/\\]/).pop()} className="artifact-preview-img" />
              </div>
            ) : fileType === "code" && filePath ? (
              <pre className="artifact-code-preview"><code>{content}</code></pre>
            ) : (
              <div className="artifact-draft-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
            )
          ) : (
            <div className="artifact-draft-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, opacity: 0.4 }}>
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              <div>点击文件打开编辑器</div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>从对话中的文件链接或右侧资源管理器选择文件</div>
            </div>
          )}
        </div>
        {activeTab && (
          <div className="editor-status-bar">
            <span>{activeTab.filePath}</span>
            <span>{content.length} 字</span>
            <span>{fileType}</span>
            {activeTab.isDirty && <span className="text-amber-400">未保存</span>}
          </div>
        )}
      </>
      )}
    </div>
  );
}

function DiffViewer({ original, current, onRevert }: { original: string; current: string; onRevert: () => void }) {
  const diff = computeDiff(original, current);

  return (
    <div className="diff-viewer">
      <div className="diff-pane">
        <div className="diff-pane-header">
          <span>原始版本</span>
          <button className="diff-revert-btn" onClick={onRevert}>回退到此版本</button>
        </div>
        {diff.map((line, i) => (
          <div
            key={i}
            className={`diff-line ${line.origLine !== null ? (line.type === "removed" ? "diff-line-removed" : "diff-line-unchanged") : ""}`}
          >
            {line.origLine !== null ? line.origLine : ""}
          </div>
        ))}
      </div>
      <div className="diff-pane">
        <div className="diff-pane-header">
          <span>当前版本</span>
        </div>
        {diff.map((line, i) => (
          <div
            key={i}
            className={`diff-line ${line.curLine !== null ? (line.type === "added" ? "diff-line-added" : "diff-line-unchanged") : ""}`}
          >
            {line.curLine !== null ? line.curLine : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
