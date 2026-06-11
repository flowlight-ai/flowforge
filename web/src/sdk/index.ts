/**
 * FlowForge SDK — 业务项目唯一依赖入口
 *
 * 业务项目通过 `import { xxx } from "@flowforge/sdk"` 导入，
 * 不再使用跨目录相对路径导入。
 *
 * 路径别名配置：
 * - tsconfig.json:  "@flowforge/sdk" → "../../flowforge/web/src/sdk"
 * - next.config.js: webpack alias   → "../../flowforge/web/src/sdk"
 */

// ─── HTTP Client ────────────────────────────────────────────
export { FlowForgeClient, createFlowForgeClient } from "../lib/flowforge-client";

// ─── Shell Components ───────────────────────────────────────
export { default as ShellWrapper } from "../components/ShellWrapper";
export { default as Sidebar } from "../components/Sidebar";

// ─── Shell Config (Provider + Hook, 不含默认配置) ───────────
export { ShellConfigProvider, useShellConfig } from "../lib/shell-config";

// ─── Types ──────────────────────────────────────────────────
export type {
  NavItem,
  NavSection,
  ShellConfig,
  TaskItem,
  GateResult,
  AuditLogEntry,
  AgentGuardStatus,
  SystemStatus,
} from "../lib/types";

// ─── Helm Types ─────────────────────────────────────────────
export type {
  HelmEventType,
  HelmWSEvent,
  StreamEntryType,
  StreamEntry,
  HelmTaskPhase,
  HelmTaskState,
  HelmWSOptions,
} from "../lib/helm-types";

// ─── Hooks ──────────────────────────────────────────────────
export { useHelmWebSocket } from "../hooks/useHelmWebSocket";

// ─── Plugin System ──────────────────────────────────────────
export type { PluginFrontendMeta } from "../lib/plugin-registry";
export { PluginRegistry } from "../lib/plugin-registry";
