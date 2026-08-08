"use client";

/**
 * HubCommandsTab — 斜杠命令与快捷键参考 Tab
 *
 * 移植自 clowder-ai HubCommandsTab，适配 FlowForge 命令体系。
 * 用于 /admin/settings?s=rules，展示：
 *   - 斜杠命令清单（按 category 分组：general/memory/knowledge/task/forgekin/council）
 *   - 全局快捷键清单（如 Cmd+K 命令面板、Cmd+/ 斜杠触发等）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量。
 * 独立性：内联命令清单，不依赖外部 registry 配置文件。
 *
 * 注：原 clowder-ai 版本从 @/config/command-registry 与 @/config/shortcut-registry
 * 导入，FlowForge 暂未建立这两个 registry，故在此内联一份精简版清单。
 * 后续若建立 registry，可平滑迁移。
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* 类型与常量                                                          */
/* ------------------------------------------------------------------ */

type CommandCategory =
  | "general"
  | "memory"
  | "knowledge"
  | "task"
  | "forgekin"
  | "council";

interface CommandDef {
  name: string;
  usage: string;
  description: string;
  category: CommandCategory;
}

interface ShortcutDef {
  keys: string;
  description: string;
  /** 上下文：全局 / Helm Studio / 群聊工作室 */
  context: string;
}

const COMMAND_CATEGORIES: Record<CommandCategory, string> = {
  general: "通用",
  memory: "记忆",
  knowledge: "知识",
  task: "任务",
  forgekin: "可进化智能体",
  council: "群聊",
};

const COMMANDS: CommandDef[] = [
  // 通用
  { name: "help", usage: "/help", description: "显示可用命令清单", category: "general" },
  { name: "clear", usage: "/clear", description: "清空当前会话消息流", category: "general" },
  { name: "reset", usage: "/reset", description: "重置智能体上下文状态", category: "general" },
  { name: "model", usage: "/model <name>", description: "切换当前会话使用的 LLM 模型", category: "general" },
  { name: "theme", usage: "/theme <light|dark>", description: "切换主题", category: "general" },

  // 记忆
  { name: "remember", usage: "/remember <text>", description: "将文本写入 EchoStore 长期记忆", category: "memory" },
  { name: "forget", usage: "/forget <id>", description: "按 ID 删除 EchoStore 记忆条目", category: "memory" },
  { name: "recall", usage: "/recall <query>", description: "从 EchoStore 检索相关记忆", category: "memory" },

  // 知识
  { name: "index", usage: "/index <path>", description: "将文档加入 OpenSieve 索引", category: "knowledge" },
  { name: "search", usage: "/search <query>", description: "通过 OpenSieve 检索文档", category: "knowledge" },

  // 任务
  { name: "task", usage: "/task <description>", description: "创建新任务并分配给智能体", category: "task" },
  { name: "tasks", usage: "/tasks", description: "列出当前工作区所有任务", category: "task" },
  { name: "cancel", usage: "/cancel <id>", description: "取消正在执行的任务", category: "task" },

  // 可进化智能体
  { name: "forgekin", usage: "/forgekin list", description: "列出所有 Forgekin 花名册", category: "forgekin" },
  { name: "evolve", usage: "/evolve <forgekin-id>", description: "触发指定 Forgekin 的进化流程", category: "forgekin" },
  { name: "awaken", usage: "/awaken <forgekin-id>", description: "触发指定 Forgekin 的觉醒流程", category: "forgekin" },

  // 群聊
  { name: "council", usage: "/council start", description: "启动群聊会话", category: "council" },
  { name: "rounds", usage: "/rounds <n>", description: "设置群聊讨论轮数", category: "council" },
  { name: "mention", usage: "@<forgekin-name>", description: "在群聊中 @ 指定 Forgekin 发言", category: "council" },
];

const SHORTCUTS: ShortcutDef[] = [
  { keys: "Cmd+K / Ctrl+K", description: "打开命令面板", context: "全局" },
  { keys: "Cmd+/ / Ctrl+/", description: "聚焦聊天输入框并触发斜杠命令", context: "Helm Studio" },
  { keys: "Cmd+Enter / Ctrl+Enter", description: "发送当前消息", context: "Helm Studio" },
  { keys: "Shift+Enter", description: "换行（不发送）", context: "Helm Studio" },
  { keys: "Cmd+B / Ctrl+B", description: "切换左侧导航栏显隐", context: "全局" },
  { keys: "Cmd+J / Ctrl+J", description: "切换右侧上下文面板", context: "群聊工作室" },
  { keys: "Escape", description: "关闭模态框 / 抽屉", context: "全局" },
  { keys: "Tab", description: "在表单字段间切换焦点", context: "全局" },
  { keys: "Cmd+, / Ctrl+,", description: "打开设置中心", context: "全局" },
  { keys: "Backspace（输入框为空时）", description: "删除最后一个标签", context: "标签编辑器" },
];

const CATEGORY_ORDER: CommandCategory[] = [
  "general",
  "memory",
  "knowledge",
  "task",
  "forgekin",
  "council",
];

/* ------------------------------------------------------------------ */
/* 内联原语                                                            */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--cafe-border,#2a2c3a)",
        background: "var(--cafe-surface-elevated,#15151c)",
      }}
      data-commands-section={title}
    >
      <h3
        className="text-xs font-semibold mb-2"
        style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function CommandGroup({ category, label }: { category: CommandCategory; label: string }) {
  const cmds = COMMANDS.filter((c) => c.category === category);
  if (cmds.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0" data-command-group={category}>
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-1.5"
        style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
      >
        {label}
      </p>
      <div className="space-y-1">
        {cmds.map((cmd) => (
          <div
            key={cmd.name + cmd.usage}
            className="flex items-baseline gap-3 text-xs"
            data-command={cmd.name}
          >
            <code
              className="font-mono px-1.5 py-0.5 rounded shrink-0"
              style={{
                color: "var(--semantic-info,#3b82f6)",
                background: "var(--conn-blue-bg,rgba(59,130,246,0.12))",
              }}
            >
              {cmd.usage}
            </code>
            <span style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}>
              {cmd.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HubCommandsTab 主组件                                                */
/* ------------------------------------------------------------------ */

export function HubCommandsTab() {
  return (
    <div className="space-y-3" data-hub-commands-tab="root">
      <Section title="斜杠命令">
        {CATEGORY_ORDER.map((cat) => (
          <CommandGroup key={cat} category={cat} label={COMMAND_CATEGORIES[cat]} />
        ))}
      </Section>

      <Section title="快捷键">
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-baseline gap-3 text-xs"
              data-shortcut={s.keys}
            >
              <kbd
                className="font-mono px-1.5 py-0.5 rounded shrink-0"
                style={{
                  color: "var(--cafe-text-secondary,#9ca3af)",
                  background: "var(--cafe-surface,#1e1f26)",
                }}
              >
                {s.keys}
              </kbd>
              <span style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}>
                {s.description}
              </span>
              {s.context !== "全局" && (
                <span
                  className="ml-auto text-[10px]"
                  style={{ color: "var(--cafe-text-muted,#6b7280)" }}
                >
                  ({s.context})
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default HubCommandsTab;
