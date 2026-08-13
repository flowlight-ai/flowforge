"use client";

import { useState, useCallback } from "react";

/** Figma 设计框架 */
export interface FigmaFrame {
  id: string;
  name: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  childrenCount: number;
}

interface FigmaImporterProps {
  /** 导入回调 — 返回解析的 Figma 数据 */
  onImport: (data: { fileKey: string; frames: FigmaFrame[] }) => void;
  /** 从选中框架生成代码 */
  onGenerateCode: (frameId: string, fileKey: string) => void;
}

/** Figma 导入组件 — 解析 Figma 文件并预览设计框架 */
export default function FigmaImporter({ onImport, onGenerateCode }: FigmaImporterProps) {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FigmaFrame[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState<string>("");
  const [imported, setImported] = useState(false);

  /** 从 Figma URL 中提取 file key */
  function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
    try {
      // Support formats:
      // https://www.figma.com/file/FILE_KEY/...
      // https://www.figma.com/design/FILE_KEY/...
      const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
      if (!match) return null;
      const nodeIdMatch = url.match(/node-id=([^&]+)/);
      return {
        fileKey: match[1],
        nodeId: nodeIdMatch ? decodeURIComponent(nodeIdMatch[1]) : undefined,
      };
    } catch {
      return null;
    }
  }

  const handleImport = useCallback(async () => {
    if (!figmaUrl.trim()) return;
    setError(null);

    const parsed = parseFigmaUrl(figmaUrl.trim());
    if (!parsed) {
      setError("无效的 Figma URL。请输入类似 https://www.figma.com/file/... 的链接");
      return;
    }

    setIsLoading(true);
    setFileKey(parsed.fileKey);

    // 真实后端 API：POST /api/v1/figma/import（读取 SecretStore 中的 FIGMA_TOKEN）
    try {
      const res = await fetch("/api/v1/figma/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: figmaUrl.trim(),
          node_id: parsed.nodeId || null,
        }),
      });
      const data = await res.json().catch(() => ({
        ok: false,
        code: "BAD_RESPONSE",
        error: "导入接口返回异常",
      }));

      if (!data?.ok) {
        const code = data?.code || "UNKNOWN";
        const hint =
          code === "NO_TOKEN"
            ? "未配置 Figma 令牌，请先在「设置 → 账号与密钥」中配置 FIGMA_TOKEN。"
            : code === "BAD_URL"
              ? "无效的 Figma 链接，需包含 figma.com/file/ 或 figma.com/design/。"
              : data?.error || "导入失败";
        setError(hint);
        setFrames([]);
        setImported(false);
        setIsLoading(false);
        return;
      }

      const framesData: FigmaFrame[] = (data?.frames || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        thumbnailUrl: f.thumbnailUrl,
        width: f.width,
        height: f.height,
        childrenCount: f.childrenCount,
      }));

      // URL 中带 node-id 时由后端过滤，若结果为空则提示
      setFrames(framesData);
      setImported(true);
      setIsLoading(false);
      onImport({ fileKey: parsed.fileKey, frames: framesData });
    } catch {
      setError("导入请求失败，请确认后端服务可用");
      setFrames([]);
      setImported(false);
      setIsLoading(false);
    }
  }, [figmaUrl, onImport]);

  const handleGenerate = useCallback(() => {
    if (selectedFrameId && fileKey) {
      onGenerateCode(selectedFrameId, fileKey);
    }
  }, [selectedFrameId, fileKey, onGenerateCode]);

  const reset = useCallback(() => {
    setFigmaUrl("");
    setFrames([]);
    setSelectedFrameId(null);
    setFileKey("");
    setImported(false);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span className="text-sm font-semibold text-gray-200">Figma 导入</span>
      </div>

      {/* URL input */}
      <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
              placeholder="粘贴 Figma 文件链接..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 pr-8"
              disabled={isLoading}
            />
            {figmaUrl && !isLoading && (
              <button
                onClick={() => setFigmaUrl("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={handleImport}
            disabled={!figmaUrl.trim() || isLoading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isLoading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            导入
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* URL format hint */}
        {!imported && !error && (
          <div className="mt-2 text-[11px] text-gray-600">
            支持 https://www.figma.com/file/... 或 https://www.figma.com/design/... 格式
          </div>
        )}
      </div>

      {/* Frame preview */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!imported ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="mx-auto mb-3 opacity-30">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <div>粘贴 Figma 链接以导入设计</div>
            </div>
          </div>
        ) : frames.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4">
            未找到设计框架
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">{frames.length} 个框架</span>
              <button
                onClick={reset}
                className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                重新导入
              </button>
            </div>

            {frames.map((frame) => (
              <div
                key={frame.id}
                onClick={() => setSelectedFrameId(frame.id)}
                className={`rounded-lg border p-3 cursor-pointer transition-all ${
                  selectedFrameId === frame.id
                    ? "border-indigo-500 bg-indigo-500/5"
                    : "border-gray-700 bg-gray-900/40 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail placeholder */}
                  <div className="w-20 h-14 rounded bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {frame.thumbnailUrl ? (
                      <img src={frame.thumbnailUrl} alt={frame.name} className="w-full h-full object-cover" />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-600">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-200 truncate">{frame.name}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-gray-500 font-mono">
                        {frame.width}×{frame.height}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {frame.childrenCount} 子元素
                      </span>
                    </div>
                  </div>

                  {/* Selection indicator */}
                  {selectedFrameId === frame.id && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate code action */}
      {imported && selectedFrameId && (
        <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={handleGenerate}
            className="w-full py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            从选中框架生成代码
          </button>
        </div>
      )}
    </div>
  );
}
