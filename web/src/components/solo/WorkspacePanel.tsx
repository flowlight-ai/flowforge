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
  onFileOpen?: (filePath: string, fileName: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export default function WorkspacePanel({ taskId, onFileOpen }: WorkspacePanelProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ name: string; path: string; matches: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState<string>("");
  const [viewMode, setViewMode] = useState<"tree" | "search">("tree");

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

  useEffect(() => {
    if (!taskId) return;
    if (taskId && activeFile) {
      fetch(`/api/v1/workspace/${taskId}/files/${encodeURIComponent(activeFile)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.content !== undefined) {
            setFileContent(data.content);
            setEditContent(data.content);
          }
        })
        .catch(() => setFileContent("加载失败"));
    }
  }, [taskId, activeFile]);

  const openFile = useCallback((path: string) => {
    setActiveFile(path);
    setIsEditing(false);
    const fileName = path.split(/[/\\]/).pop() || path;
    onFileOpen?.(`/api/v1/workspace/${taskId}/files/${path}`, fileName);
  }, [taskId, onFileOpen]);

  const handleSearch = useCallback(() => {
    if (!taskId || !searchQuery.trim()) return;
    setIsSearching(true);
    setViewMode("search");
    fetch(`/api/v1/workspace/${taskId}/search?query=${encodeURIComponent(searchQuery)}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((data) => setSearchResults(data.results || []))
      .catch(() => setSearchResults([]))
      .finally(() => setIsSearching(false));
  }, [taskId, searchQuery]);

  const handleSave = useCallback(async () => {
    if (!taskId || !activeFile) return;
    try {
      const r = await fetch(`/api/v1/workspace/${taskId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: activeFile, content: editContent }),
      });
      if (r.ok) {
        setFileContent(editContent);
        setIsEditing(false);
        fetchFiles();
      }
    } catch {}
  }, [taskId, activeFile, editContent, fetchFiles]);

  const handleDelete = useCallback(async (path: string) => {
    if (!taskId) return;
    try {
      const r = await fetch(`/api/v1/workspace/${taskId}/files/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (r.ok) {
        if (activeFile === path) {
          setActiveFile(null);
          setFileContent("");
        }
        fetchFiles();
      }
    } catch {}
  }, [taskId, activeFile, fetchFiles]);

  const buildFileTree = (files: FileItem[]) => {
    const tree: Record<string, FileItem[]> = {};
    const rootFiles: FileItem[] = [];
    for (const f of files) {
      const parts = f.path.split("/");
      if (parts.length <= 1) {
        rootFiles.push(f);
      } else {
        const dir = parts[0];
        if (!tree[dir]) tree[dir] = [];
        tree[dir].push(f);
      }
    }
    return { tree, rootFiles };
  };

  const { tree, rootFiles } = buildFileTree(files);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-200 flex-1">工作区文件</h3>
        <button
          onClick={fetchFiles}
          className="text-gray-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-gray-800"
          title="刷新"
        >
          ↻
        </button>
      </div>

      <div className="px-3 py-2 border-b border-gray-800 flex gap-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索文件内容..."
          className="flex-1 bg-gray-800 text-gray-200 text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={isSearching}
          className="text-xs px-2 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50"
        >
          {isSearching ? "..." : "搜索"}
        </button>
      </div>

      <div className="flex border-b border-gray-800">
        <button
          className={`flex-1 px-2 py-1.5 text-xs ${viewMode === "tree" ? "text-white border-b-2 border-indigo-500" : "text-gray-400"}`}
          onClick={() => setViewMode("tree")}
        >
          文件树
        </button>
        <button
          className={`flex-1 px-2 py-1.5 text-xs ${viewMode === "search" ? "text-white border-b-2 border-indigo-500" : "text-gray-400"}`}
          onClick={() => setViewMode("search")}
        >
          搜索结果{searchResults.length > 0 ? ` (${searchResults.length})` : ""}
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {viewMode === "tree" ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="overflow-y-auto" style={{ maxHeight: activeFile ? "40%" : "100%", minHeight: 80 }}>
              {files.length === 0 ? (
                <div className="flex items-center justify-center text-gray-500 text-xs p-4 h-full">
                  {taskId ? "执行过程中生成的文件将显示在这里" : "请先创建任务"}
                </div>
              ) : (
                <div className="py-1">
                  {rootFiles.map((f) => (
                    <div
                      key={f.path}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-gray-800 ${activeFile === f.path ? "bg-gray-800 text-white" : "text-gray-300"}`}
                      onClick={() => openFile(f.path)}
                    >
                      <span>{getFileIcon(f.name)}</span>
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-gray-500 text-[10px]">{formatSize(f.size)}</span>
                    </div>
                  ))}
                  {Object.entries(tree).map(([dir, dirFiles]) => (
                    <div key={dir}>
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
                        <span>📁</span>
                        <span className="font-medium">{dir}/</span>
                      </div>
                      {dirFiles.map((f) => (
                        <div
                          key={f.path}
                          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-gray-800 pl-7 ${activeFile === f.path ? "bg-gray-800 text-white" : "text-gray-300"}`}
                          onClick={() => openFile(f.path)}
                        >
                          <span>{getFileIcon(f.name)}</span>
                          <span className="flex-1 truncate">{f.name}</span>
                          <span className="text-gray-500 text-[10px]">{formatSize(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {activeFile && (
              <div className="flex-1 flex flex-col border-t border-gray-800 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-850 border-b border-gray-800">
                  <span className="text-xs text-gray-300 flex-1 truncate">{activeFile}</span>
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-500"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => { setEditContent(fileContent); setIsEditing(false); }}
                        className="text-[10px] px-2 py-0.5 bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="text-[10px] px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(activeFile)}
                        className="text-[10px] px-2 py-0.5 bg-red-600/50 text-red-300 rounded hover:bg-red-600"
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
                <div className="flex-1 overflow-auto p-3">
                  {isEditing ? (
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full h-full bg-gray-950 text-gray-200 text-xs font-mono p-2 rounded border border-gray-700 focus:border-indigo-500 focus:outline-none resize-none"
                    />
                  ) : (
                    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{fileContent}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto py-1">
            {searchResults.length === 0 ? (
              <div className="flex items-center justify-center text-gray-500 text-xs p-4 h-full">
                {searchQuery ? "未找到匹配结果" : "输入关键词搜索文件内容"}
              </div>
            ) : (
              searchResults.map((r) => (
                <div
                  key={r.path}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-gray-800 text-gray-300"
                  onClick={() => { openFile(r.path); setViewMode("tree"); }}
                >
                  <span>{getFileIcon(r.name)}</span>
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-gray-500 text-[10px]">{r.matches} 处匹配</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
