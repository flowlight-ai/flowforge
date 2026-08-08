"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** 斜杠命令定义 */
export interface SlashCommand {
  /** 命令名（不含 /），例如 "clear" */
  name: string;
  /** 命令描述 */
  description: string;
  /** 参数提示（可选），例如 "<轮数 1-3>" */
  argsHint?: string;
  /** 快捷别名 */
  aliases?: string[];
  /** 图标（emoji 或 SVG 路径） */
  icon?: string;
}

/** 群聊支持的斜杠命令清单 */
export const COUNCIL_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "清空当前会话所有消息",
    icon: "🗑",
  },
  {
    name: "vote",
    description: "发起投票（打开投票配置弹窗）",
    icon: "🗳",
  },
  {
    name: "rounds",
    description: "设置灵议轮数",
    argsHint: "<1-3>",
    icon: "🔄",
  },
  {
    name: "help",
    description: "显示所有可用命令",
    icon: "❓",
  },
  {
    name: "agents",
    description: "列出当前可用的智能体",
    icon: "👥",
  },
  {
    name: "refresh",
    description: "刷新智能体花名册",
    icon: "⟳",
  },
  {
    name: "all",
    description: "@all — 提及所有智能体参与讨论",
    icon: "◎",
  },
];

interface SlashCommandMenuProps {
  /** 是否显示 */
  show: boolean;
  /** 当前过滤词（不含 /） */
  filter: string;
  /** 当前选中索引 */
  selectedIdx: number;
  /** 选中索引变化回调 */
  onSelectIdx: (idx: number) => void;
  /** 选中某个命令 */
  onSelect: (cmd: SlashCommand) => void;
  /** 关闭菜单 */
  onClose: () => void;
  /** 容器 ref（用于外部点击检测） */
  menuRef?: React.RefObject<HTMLDivElement>;
}

/**
 * SlashCommandMenu — 斜杠命令菜单
 *
 * 用途：在输入框输入 / 时弹出命令列表，支持键盘导航
 *
 * 键盘交互：
 *   - ↑↓ 选择
 *   - Enter 确认
 *   - Esc 关闭
 *   - Tab 也可以确认
 *
 * 视觉与 @mention 弹窗保持一致
 */
export function SlashCommandMenu({
  show,
  filter,
  selectedIdx,
  onSelectIdx,
  onSelect,
  onClose,
  menuRef,
}: SlashCommandMenuProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // 过滤命令
  const filteredCommands = COUNCIL_SLASH_COMMANDS.filter((cmd) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      cmd.name.toLowerCase().includes(f) ||
      cmd.description.toLowerCase().includes(f) ||
      cmd.aliases?.some((a) => a.toLowerCase().includes(f))
    );
  });

  // 滚动指示器检测
  useEffect(() => {
    if (!show) {
      setCanScrollDown(false);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollDown(el.scrollHeight > el.clientHeight + el.scrollTop + 4);
    };
    check();
    el.addEventListener("scroll", check);
    const timer = setTimeout(check, 50);
    return () => {
      el.removeEventListener("scroll", check);
      clearTimeout(timer);
    };
  }, [show, filteredCommands.length]);

  // 选中项滚动到视图
  const selectedRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, []);

  if (!show || filteredCommands.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-4 mb-2 rounded-lg shadow-xl overflow-hidden min-w-[280px] z-10 max-h-80 flex flex-col"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
      data-council="slash-menu"
    >
      <div
        className="text-[10px] px-3 py-1.5 border-b"
        style={{
          color: "var(--muted)",
          borderColor: "var(--border)",
        }}
      >
        斜杠命令 {filteredCommands.length > 0 && `· ${filteredCommands.length} 个匹配`}
      </div>
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        {filteredCommands.map((cmd, i) => {
          const isSelected = i === selectedIdx;
          return (
            <button
              key={cmd.name}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => onSelectIdx(i)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors"
              style={{
                background: isSelected
                  ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))"
                  : "transparent",
                border: "none",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <span
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-base"
                style={{
                  background: "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))",
                  border: "1px solid var(--accent)",
                }}
              >
                {cmd.icon || "⌘"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text)" }}
                  >
                    /{cmd.name}
                  </span>
                  {cmd.argsHint && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background: "var(--bg)",
                        color: "var(--muted)",
                      }}
                    >
                      {cmd.argsHint}
                    </span>
                  )}
                </div>
                <div
                  className="text-xs truncate"
                  style={{ color: "var(--muted)" }}
                >
                  {cmd.description}
                </div>
              </div>
              {isSelected && (
                <span style={{ color: "var(--accent)", fontSize: "12px" }}>↵</span>
              )}
            </button>
          );
        })}
      </div>
      {canScrollDown && (
        <div
          className="px-3 py-1 text-[10px] text-center border-t"
          style={{
            color: "var(--muted)",
            borderColor: "var(--border)",
            background: "linear-gradient(to top, var(--bg-elevated), transparent)",
          }}
        >
          ↓ 还有更多命令
        </div>
      )}
      <div
        className="px-3 py-1.5 text-[10px] border-t"
        style={{
          color: "var(--muted)",
          borderColor: "var(--border)",
          background: "var(--bg)",
        }}
      >
        ↑↓ 选择 · Enter 确认 · Esc 关闭
      </div>
      <button
        type="button"
        onClick={onClose}
        className="sr-only"
        aria-label="关闭斜杠命令菜单"
      />
    </div>
  );
}

export default SlashCommandMenu;
