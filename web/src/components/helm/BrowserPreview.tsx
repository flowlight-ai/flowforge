"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface BrowserPreviewProps {
  /** 初始 URL */
  url: string;
  /** 元素选择回调（元素选择器模式） */
  onElementSelect?: (selector: string, elementInfo: ElementInfo) => void;
  /** 导航回调 */
  onNavigate?: (url: string) => void;
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  selector: string;
  href?: string;
  type?: string;
  name?: string;
}

interface InspectElement extends ElementInfo {
  total?: number;
}

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_SIZES: Record<Viewport, { width: string; label: string }> = {
  desktop: { width: "100%", label: "桌面" },
  tablet: { width: "768px", label: "平板" },
  mobile: { width: "375px", label: "手机" },
};

/** 内置浏览器预览 — iframe 预览 + 真实 DOM 探测元素选择 + 响应式视口 */
export default function BrowserPreview({ url, onElementSelect, onNavigate }: BrowserPreviewProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [pickerMode, setPickerMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [inspectElements, setInspectElements] = useState<InspectElement[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(url);
  }, [url]);

  // 元素选择器模式：通过后端代理抓取当前页面 HTML 并提取可交互元素（真实 DOM 探测）
  const inspectPage = useCallback(async () => {
    setInspecting(true);
    setInspectError(null);
    try {
      const res = await fetch("/api/v1/browser/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: currentUrl, max_elements: 60 }),
      });
      const data = await res.json().catch(() => ({
        ok: false,
        error: "DOM 探测接口返回异常",
      }));
      if (!data?.ok) {
        setInspectError(data?.error || "DOM 探测失败");
        setInspectElements([]);
        return;
      }
      setInspectElements((data?.elements || []).map((e: any) => ({
        tagName: e.tagName,
        id: e.id,
        className: e.className,
        textContent: e.textContent,
        selector: e.selector,
        href: e.href,
        type: e.type,
        name: e.name,
      })));
    } catch {
      setInspectError("DOM 探测请求失败，请确认后端服务可用");
      setInspectElements([]);
    } finally {
      setInspecting(false);
    }
  }, [currentUrl]);

  const handlePickerClick = useCallback(() => {
    const next = !pickerMode;
    setPickerMode(next);
    setSelectedElement(null);
    if (next) {
      void inspectPage();
    }
  }, [pickerMode, inspectPage]);

  const handleElementPick = useCallback(
    (el: ElementInfo) => {
      setSelectedElement(el);
      onElementSelect?.(el.selector, el);
    },
    [onElementSelect],
  );

  const navigate = useCallback((newUrl: string) => {
    setCurrentUrl(newUrl);
    setInputUrl(newUrl);
    setIsLoading(true);
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(newUrl);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
    onNavigate?.(newUrl);
  }, [historyIndex, onNavigate]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      setIsLoading(true);
    }
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      setIsLoading(true);
    }
  }, [history, historyIndex]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      setIsLoading(true);
      iframeRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* URL bar */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        {/* Navigation buttons */}
        <button
          onClick={goBack}
          disabled={historyIndex <= 0}
          className="text-gray-500 hover:text-gray-200 disabled:opacity-30 p-1 rounded hover:bg-white/10 transition-colors"
          title="后退"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className="text-gray-500 hover:text-gray-200 disabled:opacity-30 p-1 rounded hover:bg-white/10 transition-colors"
          title="前进"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          onClick={refresh}
          className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-white/10 transition-colors"
          title="刷新"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        {/* URL input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputUrl.trim()) {
                navigate(inputUrl.trim());
              }
            }}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
            placeholder="输入 URL..."
          />
          {isLoading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
          )}
        </div>

        {/* Element picker */}
        <button
          onClick={handlePickerClick}
          className={`p-1.5 rounded transition-colors ${
            pickerMode
              ? "bg-indigo-600 text-white"
              : "text-gray-500 hover:text-gray-200 hover:bg-white/10"
          }`}
          title={pickerMode ? "退出元素选择" : "元素选择器"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 3h6v6" /><path d="M10 14L21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </button>

        {/* Viewport selector */}
        <div className="flex gap-0.5 bg-gray-800 rounded-lg p-0.5">
          {(["desktop", "tablet", "mobile"] as Viewport[]).map((vp) => (
            <button
              key={vp}
              onClick={() => setViewport(vp)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                viewport === vp
                  ? "bg-gray-700 text-gray-200"
                  : "text-gray-500 hover:text-gray-300"
              }`}
              title={VIEWPORT_SIZES[vp].label}
            >
              {vp === "desktop" ? "🖥" : vp === "tablet" ? "📱" : "📲"}
            </button>
          ))}
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 flex items-start justify-center overflow-auto bg-gray-950 p-2 min-h-0">
        <div
          style={{
            width: VIEWPORT_SIZES[viewport].width,
            maxWidth: "100%",
            height: "100%",
            transition: "width 0.3s ease",
          }}
          className="relative"
        >
          <iframe
            ref={iframeRef}
            src={currentUrl}
            onLoad={handleIframeLoad}
            className="w-full h-full border border-gray-700 rounded-lg bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title="浏览器预览"
          />
          {pickerMode && (
            <div className="absolute inset-0 border-2 border-indigo-500 rounded-lg pointer-events-none" style={{ boxShadow: "0 0 0 2000px rgba(99, 102, 241, 0.05)" }}>
              <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded font-medium">
                元素选择模式
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Element picker panel（真实 DOM 探测结果） */}
      {pickerMode && (
        <div className="border-t border-gray-800 bg-[#12131a] flex-shrink-0 max-h-48 overflow-y-auto">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {inspecting ? "正在探测页面元素..." : `可交互元素（${inspectElements.length}）· 点击选择`}
            </span>
            <button
              onClick={() => void inspectPage()}
              disabled={inspecting}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
            >
              重新探测
            </button>
          </div>
          {inspectError && (
            <div className="px-3 pb-2 text-[10px] text-red-400">{inspectError}</div>
          )}
          {!inspecting && inspectElements.length === 0 && !inspectError && (
            <div className="px-3 pb-2 text-[10px] text-gray-500">未探测到可交互元素</div>
          )}
          <div className="px-2 pb-2 space-y-1">
            {inspectElements.map((el, i) => (
              <button
                key={`${el.selector}-${i}`}
                onClick={() => handleElementPick(el)}
                className={`w-full text-left rounded px-2 py-1.5 transition-colors ${
                  selectedElement?.selector === el.selector
                    ? "bg-indigo-600/20 border border-indigo-500"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1 py-0.5 rounded bg-gray-800 text-gray-300 font-mono flex-shrink-0">
                    {el.tagName}
                  </span>
                  <span className="text-[11px] text-gray-200 truncate flex-1">
                    {el.textContent || el.name || el.href || el.id || el.selector}
                  </span>
                </div>
                <code className="text-[9px] text-indigo-400/80 font-mono block truncate mt-0.5">
                  {el.selector}
                </code>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected element info */}
      {selectedElement && (
        <div className="px-3 py-2 border-t border-gray-800 bg-[#12131a] flex items-center gap-3 flex-shrink-0">
          <span className="text-[10px] text-gray-500">选中:</span>
          <code className="text-[11px] text-indigo-400 font-mono flex-1 truncate">{selectedElement.selector}</code>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
            {selectedElement.tagName}
          </span>
          <button
            onClick={() => setSelectedElement(null)}
            className="text-gray-500 hover:text-gray-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
