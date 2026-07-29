"use client";

/**
 * useHelmCommands — 命令处理 Hook（Phase 3 拆分）
 *
 * 封装 HelmLayout 中 handleCommand 的 switch-case 逻辑。
 *
 * 替代 HelmLayout 中的 handleCommand useCallback。
 */

import { useCallback } from "react";
import { ChatMessage } from "../helm-types";
import { BUILTIN_COMMANDS } from "../commands";
import type { Plan } from "../PlanPanel";
import type { Attachment } from "../AttachmentPreview";
import type { DiffFile } from "../DiffViewer";
import type { PanelVisibility } from "../../../stores/helmPanelStore";
import type { useHelmWebSocket } from "../../../hooks/useHelmWebSocket";

type HelmWS = ReturnType<typeof useHelmWebSocket>;

interface UseHelmCommandsDeps {
  helm: HelmWS;
  panelVisibility: PanelVisibility;
  togglePanel: (panel: "chat" | "editor" | "explorer") => void;
  showPanel: (panel: "chat" | "editor" | "explorer") => void;
  setShowSettings: (show: boolean) => void;
  setShowSpecPanel: (show: boolean) => void;
  setShowAgentOrchestrator: (show: boolean) => void;
  setShowWorktreePanel: (show: boolean) => void;
  attachments: Attachment[];
  diffFiles: DiffFile[];
  setDiffFiles: React.Dispatch<React.SetStateAction<DiffFile[]>>;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  setUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setCurrentPlan: (plan: Plan | null) => void;
  setPlanLoading: (loading: boolean) => void;
}

export function useHelmCommands(deps: UseHelmCommandsDeps) {
  const {
    helm,
    panelVisibility,
    togglePanel,
    showPanel,
    setShowSettings,
    setShowSpecPanel,
    setShowAgentOrchestrator,
    setShowWorktreePanel,
    attachments,
    diffFiles,
    setDiffFiles,
    setAttachments,
    setUserMessages,
    setCurrentPlan,
    setPlanLoading,
  } = deps;

  const handleCommand = useCallback(
    (cmd: string) => {
      const addSystemMsg = (content: string) => {
        const msg: ChatMessage = {
          id: `system-${Date.now()}`,
          role: "system",
          content,
          timestamp: Date.now(),
        };
        setUserMessages((prev) => [...prev, msg]);
      };

      switch (cmd) {
        case "/pause":
          helm.pause();
          break;
        case "/resume":
          helm.resume();
          break;
        case "/skip":
          helm.skipCurrent();
          break;
        case "/reset":
          helm.resetState();
          setUserMessages([]);
          setDiffFiles([]);
          setAttachments([]);
          break;
        case "/review":
          if (helm.taskId)
            helm.submitReview("pass", "通过 /review 命令强制审核");
          break;
        case "/plan": {
          helm.setInteractionMode("helm");
          setShowSpecPanel(true);
          if (helm.taskId && helm.intent) {
            setPlanLoading(true);
            fetch(`/api/v1/tasks/${helm.taskId}/plan`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent: helm.intent }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data?.data) setCurrentPlan(data.data);
                setPlanLoading(false);
              })
              .catch(() => setPlanLoading(false));
          }
          addSystemMsg("已切换到规划模式");
          break;
        }
        case "/spec": {
          setShowSpecPanel(true);
          showPanel("editor");
          addSystemMsg("已打开 Spec 面板");
          break;
        }
        case "/react": {
          helm.setInteractionMode("helm");
          addSystemMsg("已切换到 ReAct 模式");
          break;
        }
        case "/auto": {
          helm.setInteractionMode("auto");
          addSystemMsg("已切换到全自动模式");
          break;
        }
        case "/files": {
          togglePanel("explorer");
          addSystemMsg(panelVisibility.explorer ? "已关闭文件面板" : "已打开文件面板");
          break;
        }
        case "/settings": {
          setShowSettings(true);
          addSystemMsg("已打开设置面板");
          break;
        }
        case "/search": {
          addSystemMsg("请在输入框中输入搜索关键词，例如：搜索 量子计算最新进展");
          break;
        }
        case "/terminal": {
          setShowAgentOrchestrator(false);
          setShowWorktreePanel(false);
          showPanel("explorer");
          addSystemMsg("已打开终端面板");
          break;
        }
        case "/status": {
          const statusInfo = [
            `任务ID: ${helm.taskId || "无"}`,
            `阶段: ${helm.phase}`,
            `意图: ${helm.intent || "无"}`,
            `模式: ${helm.interactionMode}`,
            `附件: ${attachments.length} 个`,
            `变更文件: ${diffFiles.length} 个`,
          ].join("\n");
          addSystemMsg(statusInfo);
          break;
        }
        case "/scrape": {
          addSystemMsg("请在输入框中输入抓取 URL，例如：抓取 https://example.com");
          break;
        }
        case "/publish": {
          addSystemMsg("请在输入框中输入发布指令，例如：发布到微信公众号");
          break;
        }
        case "/help": {
          const helpMsg: ChatMessage = {
            id: `system-help-${Date.now()}`,
            role: "system",
            content: `可用命令: ${BUILTIN_COMMANDS.map((c) => c.id).join(", ")}`,
            timestamp: Date.now(),
          };
          setUserMessages((prev) => [...prev, helpMsg]);
          break;
        }
        default: {
          const userMsg: ChatMessage = {
            id: `user-cmd-${Date.now()}`,
            role: "user",
            content: `${cmd} 切换模式`,
            timestamp: Date.now(),
          };
          setUserMessages((prev) => [...prev, userMsg]);
        }
      }
    },
    [
      helm,
      panelVisibility.explorer,
      attachments.length,
      diffFiles.length,
      togglePanel,
      showPanel,
      setShowSettings,
      setShowSpecPanel,
      setShowAgentOrchestrator,
      setShowWorktreePanel,
      setDiffFiles,
      setAttachments,
      setUserMessages,
      setCurrentPlan,
      setPlanLoading,
    ]
  );

  return { handleCommand };
}
