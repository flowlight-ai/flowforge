import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface ShellConfig {
  brandName: string;
  brandShort: string;
  brandColor: string;
  brandSubtitle: string;
  version: string;
  navSections: NavSection[];
  /** 已弃用：helm 路径跳过 Shell（Phase 2 改为统一 Shell） */
  helmPaths?: string[];
  /** 无 Shell 的展示页路径（如 /showcase /story） */
  chromelessPaths?: string[];
  apiBaseUrl?: string;
  wsBaseUrl?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: string;
  workflow_type?: string;
  persona?: string;
  sop_name?: string;
  current_step?: string;
  current_gate?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  tags?: string[];
  [key: string]: any;
}

export interface GateResult {
  gate_id: string;
  task_id: string;
  status: string;
  overall_score: number;
  pass_threshold: number;
  is_passed: boolean;
  reviewer_feedback?: string;
  [key: string]: any;
}

export interface AuditLogEntry {
  id: number;
  task_id?: string | null;
  event_type: string;
  event_data: Record<string, any>;
  operator: string;
  timestamp: string;
}

export interface AgentGuardStatus {
  agent_name: string;
  circuit_state: string;
  failure_count: number;
  is_available: boolean;
  timeout_seconds: number;
}

export interface SystemStatus {
  status: string;
  uptime: number;
  active_tasks: number;
  total_tasks: number;
  version: string;
  [key: string]: any;
}
