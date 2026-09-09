"use client";

/**
 * LiveTerminalPanel — 基于 @xterm/xterm 的实时终端面板（T8.4 真实接入）
 *
 * 架构对齐批次 57 的 `@flowforge/terminal-panel` seam：
 * - `TerminalViewLike` 适配层把 xterm 渲染收敛为可注入 seam；
 * - `TerminalPanelController` 订阅 `TerminalOutputStream` 帧并应用到视图；
 * - 输出流缺省用「workspace/exec 桥」：`sendInput` 把回车命令 POST 到
 *   `/api/v1/workspace/exec`，其 stdout/stderr 反哺为 `output` 帧；
 *   无法连接后端时下发 mock CLI 输出（满足「终端面板可显示 mock CLI 输出」验收）。
 * - 组合根在组件挂载/卸载时 attach/dispose，严格模式双挂载幂等。
 *
 * 依赖：@flowforge/terminal-panel（workspace，Next transpilePackages 编 src）
 *      + @xterm/xterm（真实渲染）。真实 limb NDJSON 流中继归 EP2 后续 socket 组合根。
 */

import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  TerminalPanelController,
  type TerminalFrame,
  type TerminalOutputStream,
  type TerminalViewLike,
} from "@flowforge/terminal-panel/src/index.ts";

/** mock CLI 会话（后端不可达时下推，保证面板必有可见输出）。 */
const MOCK_OUTPUT: string[] = [
  "FlowForge 终端已就绪",
  "工作区: default",
  "> 输入命令开始...",
  "提示: 当前为离线演示输出，'sendInput' 会在后端可达时转发到 workspace/exec。",
];

interface LiveTerminalPanelProps {
  /** 输出流 seam；缺省用 workspace/exec 桥（含 mock 回退）。 */
  stream?: TerminalOutputStream;
  /** 是否在无输出流时仍下推 mock 输出（默认 true）。 */
  mockFallback?: boolean;
}

export default function LiveTerminalPanel({
  stream: externalStream,
  mockFallback = true,
}: LiveTerminalPanelProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<TerminalPanelController | null>(null);

  // workspace/exec 桥：把用户命令上送并反哺输出帧，供终端消费。
  const builtinStream = useCallback(
    (emit: (frame: TerminalFrame) => void): TerminalOutputStream => {
      const execCommand = async (command: string) => {
        emit({ kind: "output", data: `\r\n$ ${command}\r\n` });
        try {
          const res = await fetch("/api/v1/workspace/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const parts: string[] = [
            ...(data.stdout || "").split(/\r?\n/),
            ...(data.stderr || "").split(/\r?\n/),
          ].filter((l: string) => l !== "");
          if (data.status === "timeout") parts.push("⚠ 命令执行超时");
          if (data.exit_code !== undefined) parts.push(`(exit ${data.exit_code})`);
          emit({ kind: "output", data: `${(parts.length ? parts.join("\r\n") : "")}\r\n` });
        } catch (err) {
          emit({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      // 初次订阅：先下推 mock CLI 输出（离线演示），让面板立即可见。
      if (mockFallback) {
        for (const line of MOCK_OUTPUT) emit({ kind: "output", data: `\r\n${line}` });
        emit({ kind: "title", text: "FlowForge 终端" });
      }

      return {
        subscribe(listener) {
          emit = listener;
          return () => {
            emit = () => {};
          };
        },
        sendInput: (data) => {
          // 只处理回车触发的整行命令，过滤控制/方向字符。
          if (data.length === 1 && data.charCodeAt(0) === 13) {
            // 换行交给 xterm；命令由跨行缓冲需要额外状态，此桥简化：无持久输入缓冲。
            emit({ kind: "output", data: "" });
            return;
          }
          const line = data.trim();
          if (line) void execCommand(line);
        },
        resize: (_cols, _rows) => {
          /* 尺寸已由 xterm.view 直接同步到 term，无需额外上送 */
        },
        close: () => {
          /* 无服务端长连接，无需显式断开 */
        },
      };
    },
    [mockFallback],
  );

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    // xterm 视图 seam 适配层。
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--mono), monospace",
      fontSize: 12,
      theme: {
        background: "#0b0e14",
        foreground: "#d4d4d4",
        cursor: "#3f81ff",
        selectionBackground: "#3f81ff55",
      },
    });

    const view: TerminalViewLike = {
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      setTitle: (text) => {
        if (typeof document !== "undefined" && text) {
          document.title = `${text} - FlowForge`;
        }
      },
      setExitStatus: () => {
        /* 退出态由宿主/状态条呈现，这里保持 xterm 画布可重连 */
      },
      dispose: () => term.dispose(),
    };

    term.open(mountEl);

    // 输出流 seam（外部注入优先，否则用内置 workspace/exec 桥）。
    let frameListener: (frame: TerminalFrame) => void = () => {};
    const stream: TerminalOutputStream = externalStream ?? builtinStream((frame) => frameListener(frame));

    const controller = new TerminalPanelController({
      view,
      stream,
      onError: (message) => {
        term.write(`\r\n⚠ ${message}\r\n`);
      },
    });
    controller.attach();
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
      if (externalStream) externalStream.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalStream, builtinStream]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0b0e14",
        padding: "6px 4px 4px",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={mountRef}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      />
    </div>
  );
}