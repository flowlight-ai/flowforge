"use client";

import { useState, useEffect } from "react";

interface FileItem {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface WorkspacePanelProps {
  taskId?: string | null;
}

export default function WorkspacePanel({ taskId }: WorkspacePanelProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");

  useEffect(() => {
    fetch("/api/v1/workspace/files")
      .then((r) => r.json())
      .then((data) => setFiles(data.files || []))
      .catch(() => {});
  }, [taskId]);

  const openFile = async (path: string) => {
    setActiveFile(path);
    try {
      const resp = await fetch(`/api/v1/workspace/files/${encodeURIComponent(path)}`);
      const data = await resp.json();
      setFileContent(data.content || "");
    } catch {
      setFileContent("加载失败");
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 border-l border-gray-800">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-gray-200">工作区文件</h3>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          执行过程中生成的文件将显示在这里
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex border-b border-gray-800 overflow-x-auto">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => openFile(f.path)}
                className={`px-3 py-2 text-xs whitespace-nowrap border-r border-gray-800 transition-colors ${
                  activeFile === f.path
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {activeFile ? (
              <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">{fileContent}</pre>
            ) : (
              <div className="text-gray-500 text-sm text-center mt-8">点击文件标签查看内容</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
