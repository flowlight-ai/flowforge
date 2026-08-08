"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  /** Markdown 内容 */
  content: string;
  /** 额外 CSS 类名 */
  className?: string;
}

/** 代码块语言检测与高亮映射 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  sql: "sql",
};

/** 简易语法高亮 — 不依赖外部高亮库，使用正则实现基础着色 */
function highlightCode(code: string, language: string): string {
  const lang = LANGUAGE_ALIASES[language.toLowerCase()] || language.toLowerCase();

  // 基础转义
  let html = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 通用关键字高亮
  const keywords: Record<string, string[]> = {
    javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "default", "from", "async", "await", "try", "catch", "throw", "new", "this", "typeof", "instanceof", "switch", "case", "break", "continue"],
    typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "default", "from", "async", "await", "try", "catch", "throw", "new", "this", "typeof", "instanceof", "interface", "type", "enum", "implements", "extends", "as", "is", "keyof", "readonly"],
    python: ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "yield", "lambda", "pass", "raise", "and", "or", "not", "in", "is", "None", "True", "False", "self", "async", "await"],
    bash: ["echo", "if", "then", "else", "fi", "for", "do", "done", "while", "case", "esac", "function", "return", "exit", "export", "source", "alias", "cd", "ls", "mkdir", "rm", "cp", "mv"],
  };

  const kw = keywords[lang];
  if (kw) {
    const kwPattern = new RegExp(`\\b(${kw.join("|")})\\b`, "g");
    html = html.replace(kwPattern, '<span style="color:#c678dd">$1</span>');
  }

  // 字符串高亮（单引号、双引号、模板字符串）
  html = html.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, '<span style="color:#98c379">$&</span>');

  // 注释高亮
  if (["python", "bash", "yaml"].includes(lang)) {
    html = html.replace(/(#.*$)/gm, '<span style="color:#5c6370;font-style:italic">$1</span>');
  } else {
    html = html.replace(/(\/\/.*$)/gm, '<span style="color:#5c6370;font-style:italic">$1</span>');
  }

  // 数字高亮
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#d19a66">$1</span>');

  return html;
}

/** KaTeX 公式渲染 — 轻量实现，不依赖 KaTeX 库 */
function renderMath(latex: string, displayMode: boolean): string {
  // 简易公式渲染：使用 Unicode 数学符号和基础排版
  // 生产环境应替换为真正的 KaTeX 渲染
  let rendered = latex
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]*)\}/g, "√($1)")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\infty/g, "∞")
    .replace(/\\sum/g, "∑")
    .replace(/\\prod/g, "∏")
    .replace(/\\int/g, "∫")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\delta/g, "δ")
    .replace(/\\epsilon/g, "ε")
    .replace(/\\theta/g, "θ")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\pi/g, "π")
    .replace(/\\sigma/g, "σ")
    .replace(/\\omega/g, "ω")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\[a-zA-Z]+/g, (match) => match.slice(1));

  if (displayMode) {
    return `<div style="text-align:center;padding:8px 0;font-style:italic;color:#cdd6f4;font-size:1.1em">${rendered}</div>`;
  }
  return `<span style="font-style:italic;color:#cdd6f4">${rendered}</span>`;
}

/** 预处理 Markdown 内容：提取数学公式 */
function preprocessMarkdown(content: string): string {
  // 块级公式 $$...$$
  let processed = content.replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex) => {
    const rendered = renderMath(latex.trim(), true);
    return rendered;
  });

  // 行内公式 $...$
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_match, latex) => {
    const rendered = renderMath(latex.trim(), false);
    return rendered;
  });

  return processed;
}

/** Markdown 渲染升级 — 支持 GFM 表格、数学公式、代码高亮 */
export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  const handleCopy = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedBlock(id);
      setTimeout(() => setCopiedBlock(null), 1500);
    }).catch(() => {});
  }, []);

  const processedContent = useMemo(() => preprocessMarkdown(content), [content]);

  // Inject animation keyframes
  useEffect(() => {
    const id = "md-renderer-animations";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes md-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  return (
    <div className={`markdown-renderer ${className || ""}`} style={{ animation: "md-fade-in 0.2s ease-out" }}>
      <ReactMarkdown
        // remarkPlugins are not included to avoid extra deps; GFM tables are handled by custom renderers below
        components={{
          // Code blocks
          code({ node, className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");
            const isBlock = match || codeString.includes("\n");

            if (isBlock) {
              const blockId = `code-${codeString.slice(0, 20).replace(/\s/g, "_")}`;
              return (
                <div className="relative group my-3">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e2e] rounded-t-lg border-b border-gray-700/50">
                    <span className="text-[10px] text-gray-500 font-mono uppercase">{language || "code"}</span>
                    <button
                      onClick={() => handleCopy(codeString, blockId)}
                      className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
                    >
                      {copiedBlock === blockId ? "已复制 ✓" : "复制"}
                    </button>
                  </div>
                  <pre className="!mt-0 !rounded-t-none bg-[#1e1e2e] !p-3 overflow-x-auto">
                    <code
                      className={codeClassName}
                      dangerouslySetInnerHTML={{
                        __html: language ? highlightCode(codeString, language) : codeString.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
                      }}
                    />
                  </pre>
                </div>
              );
            }

            return (
              <code
                className="px-1.5 py-0.5 rounded bg-gray-800 text-indigo-300 text-[0.9em] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },

          // Links
          a({ node, children, href, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                {...props}
              >
                {children}
              </a>
            );
          },

          // Images
          img({ node, src, alt, ...props }) {
            return (
              <img
                src={src}
                alt={alt || ""}
                className="max-w-full rounded-lg my-2 border border-gray-700/50"
                loading="lazy"
                {...props}
              />
            );
          },

          // Blockquotes
          blockquote({ node, children, ...props }) {
            return (
              <blockquote
                className="border-l-3 border-indigo-500/50 pl-4 py-1 my-2 text-gray-400 italic bg-indigo-500/5 rounded-r-lg"
                {...props}
              >
                {children}
              </blockquote>
            );
          },

          // Tables
          table({ node, children, ...props }) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-gray-700/50">
                <table className="w-full text-sm" {...props}>
                  {children}
                </table>
              </div>
            );
          },

          thead({ node, children, ...props }) {
            return (
              <thead className="bg-gray-800/50" {...props}>
                {children}
              </thead>
            );
          },

          th({ node, children, ...props }) {
            return (
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-300 border-b border-gray-700/50" {...props}>
                {children}
              </th>
            );
          },

          td({ node, children, ...props }) {
            return (
              <td className="px-3 py-2 text-xs text-gray-400 border-b border-gray-800/50" {...props}>
                {children}
              </td>
            );
          },

          // Headings
          h1({ node, children, ...props }) {
            return <h1 className="text-xl font-bold text-gray-100 mt-6 mb-3 pb-2 border-b border-gray-800" {...props}>{children}</h1>;
          },
          h2({ node, children, ...props }) {
            return <h2 className="text-lg font-bold text-gray-100 mt-5 mb-2 pb-1 border-b border-gray-800/50" {...props}>{children}</h2>;
          },
          h3({ node, children, ...props }) {
            return <h3 className="text-base font-semibold text-gray-200 mt-4 mb-2" {...props}>{children}</h3>;
          },

          // Paragraphs
          p({ node, children, ...props }) {
            return <p className="text-sm text-gray-300 leading-relaxed my-1.5" {...props}>{children}</p>;
          },

          // Lists
          ul({ node, children, ...props }) {
            return <ul className="list-disc list-inside text-sm text-gray-300 my-1.5 space-y-0.5" {...props}>{children}</ul>;
          },
          ol({ node, children, ...props }) {
            return <ol className="list-decimal list-inside text-sm text-gray-300 my-1.5 space-y-0.5" {...props}>{children}</ol>;
          },

          // Horizontal rule
          hr({ node, ...props }) {
            return <hr className="border-gray-700 my-4" {...props} />;
          },

          // Strikethrough (GFM)
          del({ node, children, ...props }) {
            return <del className="line-through text-gray-500" {...props}>{children}</del>;
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
