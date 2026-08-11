"use client";

/**
 * WorkspaceDevPanel — 开发工作区
 *
 * 文件树 + 文件查看器 + 代码变更 + Git操作 + 终端 + 浏览器预览
 * 对应 clowder-ai 的 dev 模块
 */

import { useState, useEffect, useCallback } from "react";
import { GitPanel } from "./GitPanel";
import { BrowserPanel } from "./BrowserPanel";

// ── 类型定义 ───────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

interface FileContent {
  path: string;
  content: string;
  language?: string;
}

// ── 文件树组件 ─────────────────────────────────────────────────────

function FileTreeItem({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDir = node.type === "directory";

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px 2px 0",
          paddingLeft: `${depth * 16 + 8}px`,
          width: "100%",
          border: "none",
          background: isSelected ? "var(--accent-subtle)" : "transparent",
          color: isSelected ? "var(--accent)" : "var(--text)",
          cursor: "pointer",
          fontSize: "12px",
          borderRadius: "var(--radius-sm, 4px)",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        {isDir && (
          <span style={{ fontSize: "10px", width: "12px", color: "var(--muted)" }}>
            {isExpanded ? "▾" : "▸"}
          </span>
        )}
        {!isDir && <span style={{ width: "12px", fontSize: "10px", color: "var(--muted)" }}>📄</span>}
        {isDir && (
          <span style={{ fontSize: "12px" }}>{isExpanded ? "📂" : "📁"}</span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
      </button>
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
          {node.children.length === 0 && (
            <div
              style={{
                paddingLeft: `${(depth + 1) * 16 + 24}px`,
                fontSize: "11px",
                color: "var(--muted)",
                padding: "4px 0 4px 40px",
              }}
            >
              空目录
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 文件树主组件 ──────────────────────────────────────────────────

function FileTreePanel({
  onFileSelect,
}: {
  onFileSelect: (path: string, content: string) => void;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/workspace/tree?depth=3");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTree(data.tree ?? data.nodes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载文件树失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      try {
        const res = await fetch(`/api/v1/workspace/file?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        onFileSelect(path, data.content ?? "");
      } catch {
        onFileSelect(path, "// 无法加载文件内容");
      }
    },
    [onFileSelect],
  );

  if (loading) {
    return (
      <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>
        加载文件树...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "16px", fontSize: "12px", color: "var(--destructive)", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>
        <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>📁</div>
        <div>暂无文件</div>
        <div style={{ fontSize: "11px", marginTop: "4px" }}>
          请先创建工作区
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          marginBottom: "4px",
        }}
      >
        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          文件树
        </span>
        <button
          type="button"
          onClick={fetchTree}
          style={{
            fontSize: "10px",
            color: "var(--accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          刷新
        </button>
      </div>
      {tree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggle={handleToggle}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}

// ── 文件查看组件 ──────────────────────────────────────────────────

function FileViewerPanel({
  filePath,
  content,
  onClose,
}: {
  filePath: string | null;
  content: string;
  onClose: () => void;
}) {
  if (!filePath) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: "12px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>📝</div>
          <div>选择文件以查看内容</div>
        </div>
      </div>
    );
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(fileName);
  const isLong = content.length > 5000;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderTop: "1px solid var(--border)",
      }}
    >
      {/* 文件头 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontSize: "12px",
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fileName}
        </span>
        <span style={{ fontSize: "10px", color: "var(--muted)" }}>{filePath}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            padding: "0 4px",
            fontFamily: "inherit",
          }}
        >
          ×
        </button>
      </div>

      {/* 文件内容 */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
        {isImage ? (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
            图片预览: {filePath}
          </div>
        ) : isLong ? (
          <pre
            style={{
              margin: 0,
              fontSize: "11px",
              lineHeight: 1.5,
              fontFamily: "var(--mono)",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {content.slice(0, 5000)}
            {content.length > 5000 && (
              <span style={{ color: "var(--muted)", display: "block", marginTop: "8px" }}>
                ... 内容过长，仅显示前 5000 字符
              </span>
            )}
          </pre>
        ) : (
          <pre
            style={{
              margin: 0,
              fontSize: "11px",
              lineHeight: 1.5,
              fontFamily: "var(--mono)",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── 开发模块子 Tab 切换 ──────────────────────────────────────────

type DevSubTab = "files" | "changes" | "git" | "terminal" | "browser";

const DEV_SUB_TABS: { id: DevSubTab; label: string }[] = [
  { id: "files", label: "文件" },
  { id: "changes", label: "变更" },
  { id: "git", label: "Git" },
  { id: "terminal", label: "终端" },
  { id: "browser", label: "预览" },
];

// ── 变更面板 ──────────────────────────────────────────────────────

function ChangesPanel({ worktreeId }: { worktreeId?: string }) {
  const [changes, setChanges] = useState<Array<{ path: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (worktreeId) params.set("worktreeId", worktreeId);
    fetch(`/api/v1/git/status?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          const all = [
            ...(data.staged || []).map((f: any) => ({ ...f, status: `staged:${f.status}` })),
            ...(data.unstaged || []).map((f: any) => ({ ...f, status: `modified:${f.status}` })),
            ...(data.untracked || []).map((f: any) => ({ ...f, status: "untracked" })),
          ];
          setChanges(all);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [worktreeId]);

  if (loading) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>加载变更...</div>;
  }

  if (changes.length === 0) {
    return (
      <div style={{ padding: "24px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>
        <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>✓</div>
        <div>工作区干净，无未跟踪变更</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ padding: "4px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
        变更 ({changes.length})
      </div>
      {changes.map((c) => (
        <div
          key={c.path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 12px",
            fontSize: "12px",
            fontFamily: "var(--mono)",
          }}
        >
          <span
            style={{
              padding: "1px 4px",
              borderRadius: "3px",
              fontSize: "10px",
              fontWeight: 600,
              background: c.status.startsWith("staged") ? "var(--ok-subtle)" : c.status === "untracked" ? "var(--bg-elevated)" : "var(--warn-subtle)",
              color: c.status.startsWith("staged") ? "var(--ok)" : c.status === "untracked" ? "var(--muted)" : "var(--warn)",
            }}
          >
            {c.status}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
        </div>
      ))}
    </div>
  );
}

// ── 终端面板 ──────────────────────────────────────────────────────

function TerminalPanel({ worktreeId }: { worktreeId?: string }) {
  const [history, setHistory] = useState<string[]>([
    "> 终端已就绪",
    `> 工作区: ${worktreeId || "default"}`,
    "> 输入命令开始...",
  ]);
  const [cmd, setCmd] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    setHistory((prev) => [...prev, `$ ${cmd}`, `> 命令已发送: ${cmd}`]);
    setCmd("");
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        fontFamily: "var(--mono)",
        fontSize: "12px",
      }}
    >
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {history.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.startsWith("$") ? "var(--accent)" : "var(--text)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "6px 12px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--accent)" }}>$</span>
        <input
          type="text"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="输入命令..."
          style={{
            flex: 1,
            background: "none",
            border: "none",
            color: "var(--text)",
            fontSize: "12px",
            fontFamily: "var(--mono)",
            outline: "none",
          }}
        />
      </form>
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface DevPanelProps {
  threadId?: string | null;
}

export default function WorkspaceDevPanel({ threadId }: DevPanelProps) {
  const [subTab, setSubTab] = useState<DevSubTab>("files");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");

  const handleFileSelect = useCallback((path: string, content: string) => {
    setSelectedFile(path);
    setFileContent(content);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 子 Tab 导航 */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {DEV_SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            style={{
              flex: 1,
              padding: "6px 4px",
              fontSize: "11px",
              fontWeight: subTab === tab.id ? 600 : 500,
              color: subTab === tab.id ? "var(--accent)" : "var(--muted)",
              background: "none",
              border: "none",
              borderBottom: subTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {subTab === "files" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <div style={{ overflow: "auto", flex: selectedFile ? "0 0 auto" : 1, maxHeight: selectedFile ? "40%" : "100%" }}>
              <FileTreePanel onFileSelect={handleFileSelect} />
            </div>
            {selectedFile && (
              <FileViewerPanel
                filePath={selectedFile}
                content={fileContent}
                onClose={() => setSelectedFile(null)}
              />
            )}
          </div>
        )}
        {subTab === "changes" && <ChangesPanel />}
        {subTab === "git" && <GitPanel />}
        {subTab === "terminal" && <TerminalPanel />}
        {subTab === "browser" && <BrowserPanel />}
      </div>
    </div>
  );
}