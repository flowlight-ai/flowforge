"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface BrowserTab {
  id: string;
  port: number;
  path: string;
  title: string;
}

interface BrowserPanelProps {
  /** Initial port to preview (e.g. from port discovery toast) */
  initialPort?: number;
  /** Initial path for deep-linking (e.g. "/dashboard" from auto-open) */
  initialPath?: string;
  /** Hide toolbar/tabs/status — used in focus mode */
  previewOnly?: boolean;
  /** Called when user navigates to a new port/path — keeps parent state in sync */
  onNavigate?: (port: number, path: string) => void;
}

interface ParsedPreviewUrl {
  valid: boolean;
  port?: number;
  path?: string;
  error?: string;
  warning?: string;
}

/**
 * Simplified localhost URL parser.
 * Accepts forms like:
 *   - localhost:3000
 *   - localhost:3000/dashboard
 *   - http://localhost:3000/foo?bar=1
 *   - 127.0.0.1:5173
 */
function parsePreviewUrl(input: string): ParsedPreviewUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: "请输入 localhost URL（例如 localhost:5173）" };
  }

  let candidate = trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  const match = candidate.match(/^([\w.-]+):(\d+)(\/[^\s]*)?$/);
  if (!match) {
    return { valid: false, error: "URL 格式不正确，期望 localhost:端口[/路径]" };
  }
  const [, host, portStr, path] = match;
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { valid: false, error: "端口号无效（1-65535）" };
  }

  if (!/^localhost$/i.test(host) && host !== "127.0.0.1") {
    return {
      valid: true,
      port,
      path: path ?? "/",
      warning: `仅推荐预览 localhost，当前 host: ${host}`,
    };
  }
  return { valid: true, port, path: path ?? "/" };
}

/**
 * Embedded Browser Panel — 预览 localhost 开发服务器。
 * 简化版：通过 iframe 直接加载，不含 gateway / HMR / console bridge。
 */
export function BrowserPanel({ initialPort, initialPath, previewOnly, onNavigate }: BrowserPanelProps) {
  const [targetPort, setTargetPort] = useState(initialPort ?? 0);
  const [targetPath, setTargetPath] = useState(initialPath ?? "/");
  const [urlInput, setUrlInput] = useState(
    initialPort ? `localhost:${initialPort}${initialPath && initialPath !== "/" ? initialPath : ""}` : "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tabIdCounter = useRef(0);

  const activateView = useCallback((port: number, path: string) => {
    setTargetPort(port);
    setTargetPath(path);
    setUrlInput(port ? `localhost:${port}${path !== "/" ? path : ""}` : "");
  }, []);

  useEffect(() => {
    if (onNavigate) onNavigate(targetPort, targetPath);
  }, [targetPort, targetPath, onNavigate]);

  // Initialize tab from initialPort.
  useEffect(() => {
    if (!initialPort) return;
    const path = initialPath ?? "/";
    const title = `localhost:${initialPort}${path !== "/" ? path : ""}`;
    setTabs((prev) => {
      const existing = prev.find((t) => t.port === initialPort);
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      const id = `tab-${++tabIdCounter.current}`;
      setActiveTabId(id);
      return [...prev, { id, port: initialPort, path, title }];
    });
    activateView(initialPort, path);
  }, [initialPort, initialPath, activateView]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewUrl = (() => {
    if (!targetPort) return "";
    const qIdx = targetPath.indexOf("?");
    let pathname = targetPath;
    let search = "";
    if (qIdx >= 0) {
      pathname = targetPath.slice(0, qIdx);
      search = targetPath.slice(qIdx);
    }
    return `http://localhost:${targetPort}${pathname}${search}`;
  })();

  const handleNavigate = useCallback(() => {
    setError(null);
    setWarning(null);
    const parsed = parsePreviewUrl(urlInput);
    if (!parsed.valid || !parsed.port) {
      setError(parsed.error ?? "请输入有效的 localhost URL（例如 localhost:5173）");
      return;
    }
    if (parsed.warning) setWarning(parsed.warning);
    const port = parsed.port;
    const path = parsed.path ?? "/";
    setTargetPort(port);
    setTargetPath(path);
    setIsLoading(true);
    if (activeTabId) {
      const title = `localhost:${port}${path !== "/" ? path : ""}`;
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, port, path, title } : t)));
    }
  }, [urlInput, activeTabId]);

  const handleBack = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // cross-origin fallback — no-op
    }
  }, []);

  const handleForward = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // cross-origin fallback — no-op
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      setIsLoading(true);
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      });
    }
  }, [previewUrl]);

  const handleTabSelect = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      setActiveTabId(tabId);
      activateView(tab.port, tab.path);
    },
    [tabs, activateView],
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = next[next.length - 1];
          if (fallback) {
            setActiveTabId(fallback.id);
            activateView(fallback.port, fallback.path);
          } else {
            setActiveTabId(null);
            activateView(0, "/");
          }
        }
        return next;
      });
    },
    [activeTabId, activateView],
  );

  const handleTabAdd = useCallback(() => {
    const id = `tab-${++tabIdCounter.current}`;
    setTabs((prev) => [...prev, { id, port: 0, path: "/", title: "New Tab" }]);
    setActiveTabId(id);
    activateView(0, "/");
  }, [activateView]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-elevated)]">
      {/* Toolbar */}
      {!previewOnly && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
          <button
            type="button"
            onClick={handleBack}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--muted)] text-sm"
            title="后退"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={handleForward}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--muted)] text-sm"
            title="前进"
          >
            ›
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--muted)] text-sm"
            title="刷新"
          >
            ↻
          </button>

          <div className="flex-1 flex items-center">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNavigate();
              }}
              placeholder="localhost:3000"
              className="w-full px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] focus:outline-none focus:border-[var(--cafe-accent)] placeholder:text-[var(--muted)]"
            />
          </div>

          <button
            type="button"
            onClick={handleNavigate}
            className="px-2.5 py-1 text-xs rounded bg-[var(--cafe-accent)] text-[var(--bg-elevated)] hover:opacity-90 transition-colors"
          >
            Go
          </button>
        </div>
      )}

      {/* Tab bar — only show when there are tabs */}
      {!previewOnly && tabs.length > 0 && (
        <div className="flex items-center bg-[var(--bg-elevated)] border-b border-[var(--border)] overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabSelect(tab.id)}
                className={`group flex items-center gap-1 px-3 py-1.5 text-xs border-r border-[var(--border)] shrink-0 max-w-[180px] transition-colors ${
                  isActive
                    ? "bg-[var(--bg-elevated)] text-[var(--text)] font-medium"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="truncate">{tab.title}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTabClose(tab.id);
                  }}
                  className="ml-1 opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--text)]"
                  role="button"
                  tabIndex={-1}
                  onKeyDown={() => {}}
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleTabAdd}
            className="px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
            title="新建标签页"
          >
            +
          </button>
        </div>
      )}

      {error && (
        <div className="px-3 py-1.5 text-xs text-[var(--cafe-accent)] bg-[var(--bg-hover)] border-b border-[var(--border)]">
          {error}
        </div>
      )}
      {warning && !error && (
        <div className="px-3 py-1.5 text-xs text-[var(--muted)] bg-[var(--bg-hover)] border-b border-[var(--border)]">
          {warning}
        </div>
      )}

      {previewUrl ? (
        <div className="relative flex-1">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-elevated)]/80 z-10">
              <div className="text-xs text-[var(--muted)]">Loading preview...</div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={previewUrl}
            sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-same-origin"
            referrerPolicy="no-referrer"
            className="w-full h-full border-0 bg-white"
            title="Preview"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setError("Failed to load preview");
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm text-center">
          <div>
            <div className="text-3xl mb-3 opacity-30">🌐</div>
            <p>Enter a localhost URL to preview</p>
          </div>
        </div>
      )}

      {!previewOnly && (
        <div className="flex items-center px-2 py-0.5 text-micro text-[var(--muted)] bg-[var(--bg-elevated)] border-t border-[var(--border)]">
          {targetPort ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cafe-accent)] inline-block" />
              localhost:{targetPort}
            </span>
          ) : (
            <span>No preview</span>
          )}
        </div>
      )}
    </div>
  );
}

export default BrowserPanel;
