export interface Command {
  id: string;
  label: string;
  description: string;
  icon?: string;
  shortcut?: string;
  group: "execution" | "mode" | "navigation" | "tool" | "help";
  keywords?: string[];
  disabled?: boolean;
}

export const COMMAND_GROUPS: Record<string, string> = {
  execution: "执行控制",
  mode: "模式切换",
  navigation: "导航",
  tool: "工具",
  help: "帮助",
};

export const BUILTIN_COMMANDS: Command[] = [
  // execution
  { id: "/pause", label: "/pause", description: "暂停执行", icon: "⏸", group: "execution", keywords: ["暂停", "挂起"] },
  { id: "/resume", label: "/resume", description: "恢复执行", icon: "▶", group: "execution", keywords: ["恢复", "继续"] },
  { id: "/skip", label: "/skip", description: "跳过当前步骤", icon: "⏭", group: "execution", keywords: ["跳过", "略过"] },
  { id: "/stop", label: "/stop", description: "停止执行", icon: "⏹", group: "execution", keywords: ["停止", "终止"] },

  // mode
  { id: "/plan", label: "/plan", description: "切换到规划模式", icon: "📋", group: "mode", keywords: ["规划", "计划"] },
  { id: "/spec", label: "/spec", description: "切换到规格模式", icon: "📐", group: "mode", keywords: ["规格", "规范"] },
  { id: "/react", label: "/react", description: "切换到 ReAct 模式", icon: "🔄", group: "mode", keywords: ["react", "反应"] },
  { id: "/auto", label: "/auto", description: "切换到全自动模式", icon: "🤖", group: "mode", keywords: ["自动", "全自动"] },

  // navigation
  { id: "/files", label: "/files", description: "打开文件面板", icon: "📁", group: "navigation", keywords: ["文件", "浏览"] },
  { id: "/settings", label: "/settings", description: "打开设置", icon: "⚙", group: "navigation", keywords: ["设置", "配置"] },
  { id: "/terminal", label: "/terminal", description: "打开终端", icon: "💻", group: "navigation", keywords: ["终端", "命令行"] },

  // tool
  { id: "/search", label: "/search", description: "搜索知识库", icon: "🔍", group: "tool", keywords: ["搜索", "检索"] },
  { id: "/scrape", label: "/scrape", description: "抓取网页内容", icon: "🌐", group: "tool", keywords: ["抓取", "爬取"] },
  { id: "/publish", label: "/publish", description: "发布内容", icon: "📤", group: "tool", keywords: ["发布", "推送"] },

  // help
  { id: "/help", label: "/help", description: "显示可用命令", icon: "❓", group: "help", keywords: ["帮助", "命令"] },
  { id: "/status", label: "/status", description: "查看当前状态", icon: "📊", group: "help", keywords: ["状态", "进度"] },
  { id: "/reset", label: "/reset", description: "重置并开始新任务", icon: "🔄", group: "help", keywords: ["重置", "清空"] },
];

export function fuzzyMatch(query: string, command: Command): number {
  const q = query.toLowerCase().replace(/^\//, "");
  const label = command.label.toLowerCase();
  const keywords = (command.keywords || []).map(k => k.toLowerCase());
  if (label.startsWith(q)) return 100;
  if (keywords.some(k => k.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  if (keywords.some(k => k.includes(q))) return 40;
  let qi = 0;
  for (const ch of label) { if (qi < q.length && ch === q[qi]) qi++; }
  if (qi === q.length) return 20;
  return 0;
}

export function filterAndSortCommands(commands: Command[], query: string): Command[] {
  if (!query) return commands;
  return commands
    .map(cmd => ({ cmd, score: fuzzyMatch(query, cmd) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ cmd }) => cmd);
}
