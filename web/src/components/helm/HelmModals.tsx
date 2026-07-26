"use client";

/**
 * HelmModals — 模态框集合（Phase 3 拆分）
 *
 * 从 HelmLayout 拆出，包含：
 *   - Settings 设置面板（全屏覆盖）
 *   - MCP 服务器配置（右侧滑入）
 *   - Figma 导入器（居中弹窗）
 *   - DirBrowser 目录浏览器（选择工作区目录）
 *   - StaticGraphModal 静态图谱（保留兼容，当前无触发入口）
 *
 * 状态来源：useHelmPanelStore + useHelmWorkspaceStore（zustand 单例 stores）
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { useHelmPanelStore } from "../../stores/helmPanelStore";
import { useHelmWorkspaceStore } from "../../stores/helmWorkspaceStore";
import StaticGraphModal from "./StaticGraphModal";

const SettingsPanel = dynamic(() => import("./SettingsPanel"), { ssr: false });
const MCPConfigPanel = dynamic(() => import("./MCPConfigPanel"), { ssr: false });
const FigmaImporter = dynamic(() => import("./FigmaImporter"), { ssr: false });

interface HelmModalsProps {
  selectedModel: string;
}

export default function HelmModals({ selectedModel }: HelmModalsProps) {
  const panels = useHelmPanelStore();
  const workspace = useHelmWorkspaceStore();

  // StaticGraphModal 状态（保留兼容，当前无触发入口）
  const [graphModal, setGraphModal] = useState<{
    type: "workflow" | "agent" | "mode";
    name: string;
  } | null>(null);

  return (
    <>
      {/* Settings 全屏覆盖模态框 */}
      {panels.showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => panels.setShowSettings(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] bg-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsPanel
              config={{
                general: {
                  language: "zh-CN",
                  theme: "dark",
                  autoSave: true,
                },
                models: {
                  primary: selectedModel,
                  fallback: "auto",
                  temperature: 0.7,
                  maxTokens: 4096,
                },
                apiKeys: {},
                advanced: { maxRetries: 3, timeoutMs: 60000, verbose: false },
              }}
              onSave={() => panels.setShowSettings(false)}
              onReset={() => {}}
            />
            <div className="flex justify-end px-4 py-3 border-t border-gray-700">
              <button
                className="px-4 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
                onClick={() => panels.setShowSettings(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MCP 服务器配置（右侧滑入） */}
      {panels.showMCPConfig && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => panels.setShowMCPConfig(false)}
        >
          <div
            className="w-full max-w-md h-full bg-[#1e1e2e] shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-semibold text-gray-200">
                MCP 服务器配置
              </span>
              <button
                className="text-gray-400 hover:text-gray-200"
                onClick={() => panels.setShowMCPConfig(false)}
              >
                ✕
              </button>
            </div>
            <MCPConfigPanel
              servers={[]}
              onAdd={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
              onTest={() => {}}
            />
          </div>
        </div>
      )}

      {/* Figma 导入器 */}
      {panels.showFigmaImporter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => panels.setShowFigmaImporter(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] bg-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-semibold text-gray-200">
                Figma 导入
              </span>
              <button
                className="text-gray-400 hover:text-gray-200"
                onClick={() => panels.setShowFigmaImporter(false)}
              >
                ✕
              </button>
            </div>
            <FigmaImporter onImport={() => {}} onGenerateCode={() => {}} />
          </div>
        </div>
      )}

      {/* 目录浏览器模态框 */}
      {workspace.showDirBrowser && (
        <div
          className="dir-browser-overlay"
          onClick={() => workspace.setShowDirBrowser(false)}
        >
          <div
            className="dir-browser-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dir-browser-header">
              <span>选择工作区目录</span>
              <button
                className="dir-browser-close"
                onClick={() => workspace.setShowDirBrowser(false)}
              >
                ✕
              </button>
            </div>
            <div className="dir-browser-path">
              <span className="dir-browser-path-label">当前路径：</span>
              <span className="dir-browser-path-value">
                {workspace.dirBrowserPath || "根目录"}
              </span>
            </div>
            <div className="dir-browser-list">
              {workspace.dirBrowserPath && (
                <div
                  className="dir-browser-item dir-browser-parent"
                  onClick={() => {
                    const parent = workspace.dirBrowserPath.replace(
                      /[/\\][^/\\]+$/,
                      ""
                    );
                    if (parent && parent !== workspace.dirBrowserPath) {
                      fetch("/api/v1/system/list-directory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: parent }),
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          workspace.setDirBrowserItems(data.items || []);
                          workspace.setDirBrowserPath(parent);
                        })
                        .catch(() => {});
                    } else {
                      fetch("/api/v1/system/browse-directory", {
                        method: "POST",
                      })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((data) => {
                          workspace.setDirBrowserItems(data?.roots || []);
                          workspace.setDirBrowserPath("");
                        })
                        .catch(() => {});
                    }
                  }}
                >
                  📁 ..
                </div>
              )}
              {workspace.dirBrowserItems.map((item) => (
                <div
                  key={item.path}
                  className={`dir-browser-item${
                    item.is_dir ? " dir-browser-dir" : ""
                  }`}
                  onClick={() => {
                    if (item.is_dir) {
                      fetch("/api/v1/system/list-directory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: item.path }),
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          workspace.setDirBrowserItems(data.items || []);
                          workspace.setDirBrowserPath(item.path);
                        })
                        .catch(() => {});
                    }
                  }}
                  onDoubleClick={() => {
                    if (item.is_dir) {
                      workspace.setNewWorkspaceName(item.path);
                      workspace.setShowDirBrowser(false);
                    }
                  }}
                >
                  {item.is_dir ? "📁" : "📄"} {item.name}
                </div>
              ))}
            </div>
            <div className="dir-browser-footer">
              <button
                className="dir-browser-select-btn"
                onClick={() => {
                  if (workspace.dirBrowserPath) {
                    workspace.setNewWorkspaceName(workspace.dirBrowserPath);
                  }
                  workspace.setShowDirBrowser(false);
                }}
                disabled={!workspace.dirBrowserPath}
              >
                选择此目录
              </button>
              <button
                className="dir-browser-cancel-btn"
                onClick={() => workspace.setShowDirBrowser(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 静态图谱模态框（保留兼容） */}
      {graphModal && (
        <StaticGraphModal
          type={graphModal.type}
          name={graphModal.name}
          onClose={() => setGraphModal(null)}
        />
      )}
    </>
  );
}
