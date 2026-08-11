/**
 * 灵智训练营（Bootcamp）类型定义
 *
 * 参考 clowder-ai BootcampStateV1（packages/api/src/domains/cats/services/
 * stores/ports/ThreadStore.ts:286-297）
 *
 * 12 阶段状态机（与后端 bootcamp.py PHASE_ORDER 一致）：
 *   phase-1-intro → phase-11-farewell
 */

/** 训练营阶段枚举 */
export type BootcampPhase =
  | "phase-1-intro"
  | "phase-2-env-check"
  | "phase-3-config-help"
  | "phase-4-task-select"
  | "phase-5-kickoff"
  | "phase-6-design"
  | "phase-7-dev"
  | "phase-7.5-add-teammate"
  | "phase-8-collab"
  | "phase-9-complete"
  | "phase-10-retro"
  | "phase-11-farewell";

/** 训练营阶段顺序（与后端 PHASE_ORDER 对应） */
export const PHASE_ORDER: BootcampPhase[] = [
  "phase-1-intro",
  "phase-2-env-check",
  "phase-3-config-help",
  "phase-4-task-select",
  "phase-5-kickoff",
  "phase-6-design",
  "phase-7-dev",
  "phase-7.5-add-teammate",
  "phase-8-collab",
  "phase-9-complete",
  "phase-10-retro",
  "phase-11-farewell",
];

/** 阶段中文标签（与后端 PHASE_LABELS 对应） */
export const PHASE_LABELS: Record<BootcampPhase, string> = {
  "phase-1-intro": "自我介绍",
  "phase-2-env-check": "环境检测",
  "phase-3-config-help": "配置帮助",
  "phase-4-task-select": "选择任务",
  "phase-5-kickoff": "确认需求",
  "phase-6-design": "设计",
  "phase-7-dev": "开发",
  "phase-7.5-add-teammate": "添加队友",
  "phase-8-collab": "多智能体协作",
  "phase-9-complete": "完成",
  "phase-10-retro": "回顾",
  "phase-11-farewell": "毕业",
};

/** 训练营状态（与后端 bootcamp_state 对应） */
export interface BootcampState {
  v: number;
  phase: BootcampPhase;
  leadForgekinId?: string;
  selectedTaskId?: string | null;
  envCheck?: Record<string, ToolCheckResult>;
  startedAt: number;
  completedAt?: number | null;
}

/** 单个工具检测结果 */
export interface ToolCheckResult {
  ok: boolean;
  version: string;
  note: string;
}

/** 环境检测结果 */
export interface EnvCheckResult {
  tools: Record<string, ToolCheckResult>;
  all_core_ok: boolean;
}

/** 训练营会话（Thread + bootcamp_state） */
export interface BootcampThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  bootcamp_state: BootcampState;
}

/** 获取阶段进度百分比 */
export function getPhaseProgress(phase: BootcampPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / PHASE_ORDER.length) * 100);
}

/** 获取阶段序号（1-12） */
export function getPhaseIndex(phase: BootcampPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx === -1 ? 0 : idx + 1;
}
