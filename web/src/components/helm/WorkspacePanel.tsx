"use client";

import { useState, useEffect, useCallback } from "react";

interface FileItem {
  name: string;
  path: string;
  size: number;
  modified: string;
  is_dir: boolean;
}

interface WorkspacePanelProps {
  taskId?: string | null;
  workspaceName?: string | null;
  onFileOpen?: (filePath: string, fileName: string) => void;
  highlightFilePath?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, string> = {
    md: "📝", txt: "📄", json: "📋", yaml: "⚙️", yml: "⚙️",
    py: "🐍", ts: "🔷", tsx: "⚛️", js: "📜", css: "🎨",
    html: "🌐", sh: "🖥️", sql: "🗃️", csv: "📊",
  };
  return icons[ext] || "📄";
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileItem;
}

function buildTree(files: FileItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      let existing = currentLevel.find((n) => n.name === part);

      if (!existing) {
        const node: TreeNode = {
          name: part,
          path: currentPath,
          isDir: !isLast || f.is_dir,
          children: [],
          file: isLast && !f.is_dir ? f : undefined,
        };
        currentLevel.push(node);
        existing = node;
      }

      if (!isLast) {
        currentLevel = existing.children;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map((n) => ({ ...n, children: sortNodes(n.children) }));
  };

  return sortNodes(root);
}

function TreeNodeItem({
  node,
  depth,
  activeFile,
  highlightPath,
  onFileOpen,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  highlightPath: string | null;
  onFileOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isHighlighted = highlightPath === node.path || (node.file && highlightPath === node.file.path);
  const isActive = activeFile === node.path;

  if (node.isDir) {
    return (
      <div>
        <div
          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs hover:bg-[var(--bg-hover)] rounded transition-colors ${
            isHighlighted ? "bg-accent-2-subtle" : "text-[var(--muted)]"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="flex-shrink-0 transition-transform duration-150"
            style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="flex-shrink-0">{expanded ? "📂" : "📁"}</span>
          <span className="truncate font-medium">{node.name}</span>
        </div>
        {expanded && node.children.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            highlightPath={highlightPath}
            onFileOpen={onFileOpen}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs rounded transition-colors ${
        isActive
          ? "bg-[var(--bg-hover)] text-white"
          : isHighlighted
          ? "bg-accent-2-subtle text-white"
          : "text-[var(--text)] hover:bg-[var(--bg-hover)]"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onClick={() => onFileOpen(node.path)}
    >
      <span className="flex-shrink-0">{getFileIcon(node.name, false)}</span>
      <span className="truncate flex-1 min-w-0">{node.name}</span>
      {node.file && (
        <span className="text-[var(--muted)] text-[10px] font-mono flex-shrink-0">
          {formatSize(node.file.size)}
        </span>
      )}
    </div>
  );
}

export default function WorkspacePanel({ taskId, workspaceName, onFileOpen, highlightFilePath }: WorkspacePanelProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchFiles = useCallback(() => {
    if (!taskId) {
      setFiles([]);
      return;
    }
    fetch(`/api/v1/workspace/${taskId}/files`)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((data) => setFiles(data.files || []))
      .catch(() => setFiles([]));
  }, [taskId]);

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, [fetchFiles]);

  const openFile = useCallback((path: string) => {
    setActiveFile(path);
    const fileName = path.split(/[/\\]/).pop() || path;
    onFileOpen?.(`/api/v1/workspace/${taskId}/files/${path}`, fileName);
  }, [taskId, onFileOpen]);

  const tree = buildTree(files);

  const filteredTree = searchQuery.trim()
    ? files.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-elevated)] border-l border-[var(--border)]">
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center gap-2 flex-shrink-0">
        <span className="text-xs font-semibold text-[var(--text)] uppercase tracking-wider">资源管理器</span>
        {workspaceName && (
          <>
            <span className="text-[var(--muted)] text-xs">/</span>
            <span className="text-xs text-[var(--muted)] truncate max-w-[120px]" title={workspaceName}>
              {workspaceName.length > 20 ? workspaceName.slice(0, 20) + "…" : workspaceName}
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={fetchFiles}
          className="text-[var(--muted)] hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
          title="刷新"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-[var(--border)] flex-shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索文件..."
          className="w-full bg-[var(--bg-elevated)] text-[var(--text)] text-xs px-2 py-1.5 rounded border border-[var(--border)] focus:border-[var(--cafe-accent)] focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {files.length === 0 ? (
          <div className="flex items-center justify-center text-[var(--muted)] text-xs p-4 h-full">
            {taskId ? "执行过程中生成的文件将显示在这里" : "请先创建任务"}
          </div>
        ) : filteredTree ? (
          filteredTree.length === 0 ? (
            <div className="flex items-center justify-center text-[var(--muted)] text-xs p-4">
              未找到匹配文件
            </div>
          ) : (
            filteredTree.map((f) => (
              <div
                key={f.path}
                className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs rounded transition-colors mx-1 ${
                  activeFile === f.path
                    ? "bg-[var(--bg-hover)] text-white"
                    : highlightFilePath && f.path === highlightFilePath
                    ? "bg-accent-2-subtle text-white"
                    : "text-[var(--text)] hover:bg-[var(--bg-hover)]"
                }`}
                onClick={() => openFile(f.path)}
              >
                <span>{getFileIcon(f.name, f.is_dir)}</span>
                <span className="truncate flex-1 min-w-0">{f.name}</span>
                <span className="text-[var(--muted)] text-[10px] font-mono flex-shrink-0">
                  {formatSize(f.size)}
                </span>
              </div>
            ))
          )
        ) : (
          tree.map((node) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              highlightPath={highlightFilePath ?? null}
              onFileOpen={openFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
