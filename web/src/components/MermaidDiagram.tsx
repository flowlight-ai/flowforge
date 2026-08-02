"use client";

/**
 * MermaidDiagram — Mermaid 图表渲染
 *
 * 懒加载渲染 Mermaid 图表；解析失败时展示原始源码。
 *
 * 注意：依赖 mermaid 包，运行时动态 import；若包未安装则降级展示源码。
 *       当 mermaid 包未安装时，通过下方 declare module shim 让 TS 编译通过。
 */

import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  readonly source: string;
  readonly id?: string;
  readonly theme?: "default" | "dark" | "forest" | "neutral";
  readonly height?: number;
}

interface MermaidModule {
  readonly render: (id: string, source: string) => Promise<{ svg: string }>;
  readonly initialize: (config: Record<string, unknown>) => void;
}

let mermaidLoader: Promise<MermaidModule | null> | null = null;

async function loadMermaid(): Promise<MermaidModule | null> {
  if (mermaidLoader) return mermaidLoader;
  mermaidLoader = (async () => {
    try {
      // mermaid 包可能未安装；动态 import 失败时降级展示源码。
      // @ts-ignore — 缺少 mermaid 类型声明时跳过检查
      const mod = await import("mermaid");
      const m = (mod as unknown as { default?: MermaidModule }).default ?? (mod as unknown as MermaidModule);
      return m;
    } catch {
      return null;
    }
  })();
  return mermaidLoader;
}

let renderCounter = 0;

export function MermaidDiagram({ source, id, theme = "default", height }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagramId] = useState(() => id ?? `mermaid-${++renderCounter}-${Date.now()}`);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvg("");

    loadMermaid().then((m) => {
      if (cancelled || !m) {
        if (!cancelled) {
          setError("Mermaid 模块未安装");
          setLoading(false);
        }
        return;
      }
      try {
        m.initialize({ startOnLoad: false, theme, securityLevel: "loose" });
      } catch {
        // 初始化失败时忽略，继续尝试渲染
      }
      m.render(diagramId, source)
        .then((result) => {
          if (cancelled) return;
          setSvg(result.svg);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [source, diagramId, theme]);

  if (loading) {
    return (
      <div
        data-mermaid="loading"
        ref={containerRef}
        style={{
          padding: "20px",
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "12px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          height,
        }}
      >
        渲染图表中...
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-mermaid="error"
        style={{
          padding: "12px",
          background: "var(--danger-subtle)",
          border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
          borderRadius: "var(--radius-sm)",
          color: "var(--danger)",
          fontSize: "12px",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "6px" }}>图表渲染失败：{error}</div>
        <pre
          data-mermaid="source"
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "monospace",
            fontSize: "11px",
            color: "var(--muted)",
          }}
        >
          {source}
        </pre>
      </div>
    );
  }

  return (
    <div
      data-mermaid="root"
      data-mermaid-id={diagramId}
      ref={containerRef}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px",
        overflow: "auto",
        height,
        textAlign: "center",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
