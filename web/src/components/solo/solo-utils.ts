import { ChatMessage, StepGroupData } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";

export const COMMANDS = [
  { cmd: "/plan", desc: "切换到规划模式" },
  { cmd: "/spec", desc: "切换到规格模式" },
  { cmd: "/review", desc: "强制审核检查点" },
  { cmd: "/pause", desc: "暂停执行" },
  { cmd: "/resume", desc: "恢复执行" },
  { cmd: "/skip", desc: "跳过当前步骤" },
  { cmd: "/reset", desc: "重置并开始新任务" },
  { cmd: "/help", desc: "显示可用命令" },
];

export const AGENT_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444", "#f97316",
  "#eab308", "#84cc16", "#22c55e", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#2563eb",
];

export const MODE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  react: { label: "ReAct", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  plan_execute: { label: "Plan-Execute", color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
  workflow: { label: "Workflow", color: "#14b8a6", bg: "rgba(20,184,166,0.12)" },
  solo: { label: "Solo", color: "#f43f5e", bg: "rgba(244,63,94,0.12)" },
  pipeline: { label: "Pipeline", color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  chain: { label: "Chain", color: "#eab308", bg: "rgba(234,179,8,0.12)" },
};

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getAgentColor(name: string): string {
  return AGENT_COLORS[hashString(name) % AGENT_COLORS.length];
}

export function getAgentInitials(name: string): string {
  if (!name) return "?";
  const parts = name.replace(/[_-]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const s = parts[0] || name;
  return s.slice(0, 2).toUpperCase();
}

export function getModeStyle(mode?: string) {
  if (!mode) return MODE_STYLES.solo;
  const key = mode.toLowerCase().replace(/[_-]/g, "_");
  return MODE_STYLES[key] || { label: mode, color: "#6b7280", bg: "rgba(107,114,128,0.12)" };
}

export function formatTs(ts: number | string): string {
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const mdCache = new Map<string, string>();
const MD_CACHE_MAX = 200;

export function detectFilePaths(text: string): Array<{path: string, line: string}> {
  if (!text) return [];
  const extPattern = /\.(py|ts|tsx|js|jsx|md|yaml|yml|json|css|html|toml|cfg|ini|sh|bat|ps1|sql|rb|go|rs|java|kt|swift|c|cpp|h|hpp|cs|php|vue|svelte|astro|env|lock|txt|log|xml|html|htm|scss|less)(?::\+(\d+)(?:-(\d+))?)?(?=[^a-zA-Z0-9_/.-]|$)/g;
  const results: Array<{path: string, line: string}> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = extPattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const beforeIdx = match.index;
    let pathStart = beforeIdx;
    while (pathStart > 0 && /[/\\a-zA-Z0-9_.-]/.test(text[pathStart - 1])) pathStart--;
    const rawPath = text.slice(pathStart, beforeIdx + fullMatch.length - (match[2] ? match[2].length + (match[3] ? match[3].length + 1 : 2) : 0));
    const linePart = match[2] ? `:+${match[2]}${match[3] ? `-${match[3]}` : ""}` : "";
    const key = rawPath + linePart;
    if (!seen.has(key) && rawPath.length > 1 && !rawPath.startsWith("http")) {
      seen.add(key);
      results.push({ path: rawPath, line: linePart });
    }
  }
  return results;
}

export function renderMarkdown(md: string): string {
  if (!md) return "";
  const cached = mdCache.get(md);
  if (cached !== undefined) return cached;
  let html = md;
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="md-code-block"><code class="lang-${lang || 'text'}">${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="md-inline-code">${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`);
    return `%%INLINECODE_${idx}%%`;
  });
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^\- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");
  html = `<p>${html}</p>`;
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`%%CODEBLOCK_${i}%%`, codeBlocks[i]);
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    html = html.replace(`%%INLINECODE_${i}%%`, inlineCodes[i]);
  }
  if (mdCache.size >= MD_CACHE_MAX) {
    const firstKey = mdCache.keys().next().value;
    if (firstKey !== undefined) mdCache.delete(firstKey);
  }
  mdCache.set(md, html);
  const fileExtRe = /\.(py|ts|tsx|js|jsx|md|yaml|yml|json|css|html|toml|cfg|ini|sh|bat|ps1|sql|rb|go|rs|java|kt|swift|c|cpp|h|hpp|cs|php|vue|svelte|astro|env|lock)(?::\+(\d+)(?:-(\d+))?)?(?=[^a-zA-Z0-9_/.\-<]|$)/g;
  html = html.replace(fileExtRe, (match) => {
    let pathStart = html.indexOf(match);
    if (pathStart === -1) return match;
    const searchStart = Math.max(0, pathStart - 120);
    const segment = html.slice(searchStart, pathStart + match.length);
    const localIdx = pathStart - searchStart;
    let pStart = localIdx;
    while (pStart > 0 && /[/\\a-zA-Z0-9_.\-]/.test(segment[pStart - 1])) pStart--;
    const rawPath = segment.slice(pStart, localIdx + match.length);
    if (rawPath.includes("<") || rawPath.startsWith("http")) return match;
    return `<span class="file-ref" data-path="${rawPath.replace(/"/g, "&quot;")}">${rawPath}</span>`;
  });
  return html;
}

export function getToolIcon(toolName?: string): string {
  const icons: Record<string, string> = {
    opensieve: "🔍", opensieve_search: "🔍", helixrag: "🔍", helixrag_search: "🔍", web_search: "🌐",
    scraper: "📄", llm: "🤖", llm_client: "🤖",
    shell_executor: "⌨", git_operations: "🔀",
    code_quality: "📐", security_scanner: "🔒",
    test_runner: "🧪", cicd_trigger: "🚀", monitoring: "📊",
  };
  return icons[toolName || ""] || "🔧";
}

export function getToolSummary(data: Record<string, any>): string {
  const toolName: string = data.tool_name || "";
  const nameLower = toolName.toLowerCase();
  if (nameLower.includes("search") || nameLower.includes("helixrag") || nameLower.includes("opensieve")) {
    return `搜索完成，找到 ${data.result?.data?.results?.length || data.result?.results?.length || 0} 条结果`;
  }
  if (nameLower.includes("llm") || nameLower.includes("generate")) {
    return "内容生成完成";
  }
  if (data.error) return `执行失败: ${data.error}`;
  return "执行完成";
}

export function truncateParams(params: any, maxLen = 120): string {
  if (!params) return "";
  const str = typeof params === "string" ? params : JSON.stringify(params, null, 0);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

export function truncateResult(result: any, maxLen = 200): string {
  if (!result) return "";
  const str = typeof result === "string" ? result : JSON.stringify(result, null, 0);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

export function entryToChatMessages(entry: any): ChatMessage[] {
  const base = { id: entry.id, timestamp: entry.timestamp, data: entry.data };
  switch (entry.type) {
    case "stage":
      const stageLabel = entry.data.label || entry.data.stage || entry.data.step || "";
      const isExit = entry.data._is_end === true
        || (entry.data._is_start == null && entry.data._is_end == null && entry.data.order == null);
      if (isExit && stageLabel) return [{ ...base, role: "system", content: `✓ ${stageLabel} 完成` }];
      if (stageLabel) return [{ ...base, role: "stage", content: stageLabel }];
      return [];
    case "llm-call":
      return [{
        ...base,
        role: "llm-call",
        content: entry.data.model || entry.data.model_name || "LLM",
        data: {
          ...entry.data,
          _llm_model: entry.data.model || entry.data.model_name || "",
          _llm_tokens: entry.data.total_tokens || entry.data.token_count || 0,
          _llm_duration_ms: entry.data.duration_ms || entry.data.latency_ms || null,
          _llm_agent: entry.data.agent_name || "",
          _llm_is_start: entry.data._is_start || false,
          _llm_is_end: entry.data._is_end || false,
        },
      }];
    case "tool-call":
      const tName = entry.data.tool_name || entry.data.tool || "工具调用";
      const tSuccess = entry.data.success !== undefined ? entry.data.success : (entry.type === "tool-call" && entry.id.includes("end"));
      return [{
        ...base,
        role: "tool",
        content: tName,
        data: {
          ...entry.data,
          tool_name: tName,
          _tool_success: tSuccess,
          _tool_result: entry.data.result || entry.data.output || null,
          _tool_input: entry.data.input || entry.data.params || entry.data.arguments || null,
          _tool_error: entry.data.error || null,
          _duration_ms: entry.data.duration_ms || null,
        },
      }];
    case "draft-file":
      return [{
        ...base,
        role: "ai",
        content: "",
        data: {
          ...entry.data,
          _agent_name: "FlowForge",
          _file_path: entry.data.file_path || `/api/v1/workspace/${entry.task_id}/files/output/${entry.data.filename}`,
          _file_name: entry.data.filename || "",
          _file_size: entry.data.size || 0,
          _is_file: true,
        },
      }];
    case "thinking":
      return [{ ...base, role: "ai", content: "", data: { ...entry.data, _thinking_content: entry.data.delta_text, _agent_name: entry.data.agent_name || "AI" } }];
    case "llm-stream":
      return [{ ...base, role: "ai", content: entry.data.delta_text || "", data: { ...entry.data, _streaming: true, _agent_name: entry.data.agent_name || "AI" } }];
    case "intermediate":
      return [{ ...base, role: "system", content: entry.data.step_name || "中间结果" }];
    case "review":
      return [{ ...base, role: "review", content: entry.data.draft_summary || "审核节点" }];
    case "gate":
      return [{ ...base, role: "gate", content: `${entry.data.is_passed ? "✓" : "✗"} ${entry.data.gate_id}` }];
    case "draft-update":
      if (entry.data.content || entry.data.file_path) {
        const isSaved = entry.data.saved_to_file || false;
        const preview = entry.data.content_preview || "";
        return [{
          ...base,
          role: "ai",
          content: isSaved ? preview : (entry.data.content || ""),
          data: {
            ...entry.data,
            _agent_name: entry.data.agent_name || "AI",
            _draft: true,
            _is_final_result: !entry.data.is_partial,
            _saved_to_file: isSaved,
            _content_full: entry.data.content,  // full content for expand
          },
        }];
      }
      return [];
    case "system":
      if (entry.data?.error_message) return [{ ...base, role: "system", content: `✗ ${entry.data.error_message}` }];
      if (entry.data?.published_urls) return [{ ...base, role: "system", content: "✓ 任务完成" }];
      if (entry.data?.result) {
        const resultStr = typeof entry.data.result === "string" ? entry.data.result : JSON.stringify(entry.data.result);
        if (resultStr && resultStr.length > 0) return [{ ...base, role: "ai", content: resultStr, data: { ...entry.data, _agent_name: entry.data.agent_name || "AI", _is_final_result: true } }];
        return [{ ...base, role: "system", content: "✓ 任务完成" }];
      }
      if (entry.data?.full_response) {
        const fr = typeof entry.data.full_response === "string" ? entry.data.full_response : JSON.stringify(entry.data.full_response);
        if (fr && fr.length > 0) return [{ ...base, role: "ai", content: fr, data: { ...entry.data, _agent_name: entry.data.agent_name || "AI", _is_final_result: true } }];
      }
      return [{ ...base, role: "system", content: "✓ 任务完成" }];
    default:
      return [];
  }
}

export function mergeStreamingMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let currentAI: ChatMessage | null = null;

  function pushCurrent() {
    if (currentAI) { result.push(currentAI); currentAI = null; }
  }

  for (const msg of messages) {
    const isAI = msg.role === "ai";
    const sameAgent = currentAI && currentAI.data?._agent_name === msg.data?._agent_name;

    if (isAI && msg.data?._thinking_content) {
      // Merge thinking into existing same-agent message, or start a new combined message
      if (sameAgent && currentAI && currentAI.data) {
        currentAI.data._thinking_content = (currentAI.data._thinking_content || "") + (msg.data._thinking_content || "");
      } else {
        pushCurrent();
        currentAI = { ...msg, role: "ai", content: "", data: { ...msg.data, _thinking_content: msg.data._thinking_content } };
      }
    } else if (isAI && msg.data?._streaming) {
      // Merge streaming delta into same-agent message (carries forward any thinking already merged)
      if (sameAgent && currentAI) {
        currentAI.content += msg.content;
      } else {
        pushCurrent();
        currentAI = { ...msg, data: { ...msg.data } };
      }
    } else if (isAI && msg.data?._draft) {
      // Draft-update replaces content for the same agent (keep accumulated thinking)
      if (sameAgent && currentAI) {
        currentAI.content = msg.content;
        currentAI.data = { ...currentAI.data, ...msg.data };
      } else {
        pushCurrent();
        currentAI = { ...msg };
      }
    } else if (isAI && msg.data?._is_final_result) {
      // Final result inline — merge into same agent
      if (sameAgent && currentAI) {
        currentAI.content = msg.content;
        currentAI.data = { ...currentAI.data, ...msg.data, _is_final_result: true };
      } else {
        pushCurrent();
        currentAI = { ...msg };
      }
    } else {
      pushCurrent();
      result.push(msg);
    }
  }

  if (currentAI) {
    result.push(currentAI);
  }
  return result;
}

export function groupMessagesIntoSteps(
  messages: ChatMessage[],
  phase: SoloTaskPhase
): (ChatMessage | StepGroupData)[] {
  const result: (ChatMessage | StepGroupData)[] = [];
  let currentGroup: StepGroupData | null = null;
  let stepCounter = 0;
  const isTerminal = (p: SoloTaskPhase): boolean => p === "completed" || p === "error" || p === "rejected" || p === "interrupted" || p === "idle";

  for (const msg of messages) {
    if (msg.role === "stage") {
      if (currentGroup) { currentGroup.status = "completed"; result.push(currentGroup); }
      stepCounter++;
      currentGroup = {
        id: `step-${stepCounter}`, stepNumber: stepCounter,
        stepLabel: msg.content, stageKey: msg.data?.stage || msg.content,
        status: "running", durationMs: null, entries: [], startTime: msg.timestamp,
      };
    } else if (currentGroup) {
      // User messages should NOT be absorbed into step groups; render standalone
      if (msg.role === "user") {
        if (currentGroup) { currentGroup.status = "completed"; result.push(currentGroup); currentGroup = null; }
        result.push(msg);
      } else {
        currentGroup.entries.push(msg);
        if (msg.role === "tool" && msg.data?.duration_ms) currentGroup.durationMs = (currentGroup.durationMs || 0) + msg.data.duration_ms;
        if (msg.role === "gate" && !msg.data?.is_passed) currentGroup.status = "error";
        if (msg.role === "system") {
          if (msg.content.startsWith("✗")) currentGroup.status = "error";
          else if (msg.content.startsWith("✓")) currentGroup.status = "completed";
        }
      }
    } else {
      result.push(msg);
    }
  }
  if (currentGroup) {
    if (currentGroup.status === "running") {
      if (isTerminal(phase)) currentGroup.status = phase === "completed" ? "completed" : "error";
    }
    currentGroup.entries = mergeStreamingMessages(currentGroup.entries);
    result.push(currentGroup);
  }
  if (isTerminal(phase)) {
    for (const item of result) {
      if ("status" in item && item.status === "running") {
        item.status = phase === "completed" ? "completed" : "error";
      }
    }
  }
  return result;
}

export function loadTaskHistory(brand: string): TaskHistoryItem[] {
  if (typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(`${brand}_solo_history`); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export function saveTaskHistory(brand: string, items: TaskHistoryItem[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`${brand}_solo_history`, JSON.stringify(items.slice(0, 20))); } catch {}
}

export function appendTaskHistory(brand: string, item: TaskHistoryItem, fromUser?: boolean): TaskHistoryItem[] {
  const existing = loadTaskHistory(brand);
  const existingIdx = existing.findIndex((h) => h.taskId === item.taskId);
  if (existingIdx >= 0) {
    // Update in place — preserve sort position unless fromUser
    const prev = existing[existingIdx];
    existing[existingIdx] = {
      ...prev,
      phase: item.phase,
      intent: item.intent || prev.intent,
      persona: item.persona || prev.persona,
      lastUserMessageAt: fromUser ? Date.now() : prev.lastUserMessageAt,
    };
  } else {
    // New task — add to top (user just created it)
    existing.unshift({ ...item, lastUserMessageAt: Date.now() });
  }
  const sorted = existing
    .sort((a, b) => (b.lastUserMessageAt || b.timestamp) - (a.lastUserMessageAt || a.timestamp))
    .slice(0, 20);
  saveTaskHistory(brand, sorted);
  return sorted;
}

export function loadDeletedIds(brand: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { const raw = localStorage.getItem(`${brand}_solo_deleted`); return raw ? new Set(JSON.parse(raw)) : new Set(); } catch { return new Set(); }
}

export function saveDeletedIds(brand: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`${brand}_solo_deleted`, JSON.stringify([...ids])); } catch {}
}

import { TaskHistoryItem } from "./solo-types";
