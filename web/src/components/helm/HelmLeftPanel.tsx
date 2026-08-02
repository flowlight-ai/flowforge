"use client";

/**
 * HelmLeftPanel — 左侧任务列表面板（Phase 3 拆分）
 *
 * 从 HelmLayout 拆出，封装 TaskListPanel 及其外层容器。
 */

import TaskListPanel from "./TaskListPanel";
import type { ChatMessage } from "./helm-types";
import type { HelmTaskPhase } from "../../lib/helm-types";

interface HelmLeftPanelProps {
  phase: HelmTaskPhase;
  intent: string;
  taskId: string | null;
  elapsed: number;
  workspaceName: string;
  onNewTask: () => void;
  onRestoreChat: (msgs: ChatMessage[]) => void;
  onSwitchTask: (
    taskId: string,
    intent: string,
    persona: string,
    phase: HelmTaskPhase
  ) => void;
  refreshTrigger: number;
  workspaceRefreshKey: number;
}

export default function HelmLeftPanel({
  phase,
  intent,
  taskId,
  elapsed,
  workspaceName,
  onNewTask,
  onRestoreChat,
  onSwitchTask,
  refreshTrigger,
  workspaceRefreshKey,
}: HelmLeftPanelProps) {
  return (
    <div className="helm-tasklist-column">
      <TaskListPanel
        phase={phase}
        intent={intent}
        taskId={taskId}
        elapsed={elapsed}
        workspaceName={workspaceName}
        onNewTask={onNewTask}
        onRestoreChat={onRestoreChat}
        onSwitchTask={onSwitchTask}
        refreshTrigger={refreshTrigger}
        workspaceRefreshKey={workspaceRefreshKey}
      />
    </div>
  );
}
