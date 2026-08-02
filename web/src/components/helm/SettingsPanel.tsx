"use client";

import { useState, useCallback, useEffect } from "react";

/** 应用配置 */
export interface AppConfig {
  general: {
    language: string;
    theme: "dark" | "light" | "system";
    autoSave: boolean;
  };
  models: {
    primary: string;
    fallback: string;
    temperature: number;
    maxTokens: number;
  };
  apiKeys: Record<string, string>;
  advanced: {
    maxRetries: number;
    timeoutMs: number;
    verbose: boolean;
  };
}

interface SettingsPanelProps {
  /** 当前配置 */
  config: AppConfig;
  /** 保存配置 */
  onSave: (config: AppConfig) => void;
  /** 重置为默认配置 */
  onReset: () => void;
}

type TabKey = "general" | "models" | "apikeys" | "advanced";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "general", label: "通用", icon: "⚙️" },
  { key: "models", label: "模型", icon: "🤖" },
  { key: "apikeys", label: "API 密钥", icon: "🔑" },
  { key: "advanced", label: "高级", icon: "🔧" },
];

/** 设置面板 — 分 Tab 管理应用配置 */
export default function SettingsPanel({ config, onSave, onReset }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [draft, setDraft] = useState<AppConfig>(config);
  const [hasChanges, setHasChanges] = useState(false);
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft(config);
    setHasChanges(false);
  }, [config]);

  const updateDraft = useCallback((updates: Partial<AppConfig>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
    setHasChanges(true);
  }, []);

  const updateGeneral = useCallback((updates: Partial<AppConfig["general"]>) => {
    setDraft((prev) => ({ ...prev, general: { ...prev.general, ...updates } }));
    setHasChanges(true);
  }, []);

  const updateModels = useCallback((updates: Partial<AppConfig["models"]>) => {
    setDraft((prev) => ({ ...prev, models: { ...prev.models, ...updates } }));
    setHasChanges(true);
  }, []);

  const updateAdvanced = useCallback((updates: Partial<AppConfig["advanced"]>) => {
    setDraft((prev) => ({ ...prev, advanced: { ...prev.advanced, ...updates } }));
    setHasChanges(true);
  }, []);

  const updateApiKey = useCallback((provider: string, value: string) => {
    setDraft((prev) => ({ ...prev, apiKeys: { ...prev.apiKeys, [provider]: value } }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    onSave(draft);
    setHasChanges(false);
  }, [draft, onSave]);

  const handleReset = useCallback(() => {
    onReset();
    setHasChanges(false);
  }, [onReset]);

  return (
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="text-sm font-semibold text-gray-200">设置</span>
        {hasChanges && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="有未保存的更改" />}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? "text-indigo-400 border-indigo-500"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {/* General */}
        {activeTab === "general" && (
          <div className="space-y-4">
            <SettingField label="语言">
              <select
                value={draft.general.language}
                onChange={(e) => updateGeneral({ language: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </SettingField>
            <SettingField label="主题">
              <div className="flex gap-2">
                {(["dark", "light", "system"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => updateGeneral({ theme: t })}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      draft.general.theme === t
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {t === "dark" ? "深色" : t === "light" ? "浅色" : "跟随系统"}
                  </button>
                ))}
              </div>
            </SettingField>
            <SettingField label="自动保存">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    draft.general.autoSave ? "bg-indigo-500" : "bg-gray-700"
                  }`}
                  onClick={() => updateGeneral({ autoSave: !draft.general.autoSave })}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      draft.general.autoSave ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </div>
                <span className="text-xs text-gray-400">编辑后自动保存</span>
              </label>
            </SettingField>
          </div>
        )}

        {/* Models */}
        {activeTab === "models" && (
          <div className="space-y-4">
            <SettingField label="主模型">
              <input
                type="text"
                value={draft.models.primary}
                onChange={(e) => updateModels({ primary: e.target.value })}
                placeholder="gpt-4o / claude-3.5-sonnet"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </SettingField>
            <SettingField label="回退模型">
              <input
                type="text"
                value={draft.models.fallback}
                onChange={(e) => updateModels({ fallback: e.target.value })}
                placeholder="gpt-4o-mini"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </SettingField>
            <SettingField label={`Temperature: ${draft.models.temperature}`}>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={draft.models.temperature}
                onChange={(e) => updateModels({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>精确</span>
                <span>创意</span>
              </div>
            </SettingField>
            <SettingField label={`Max Tokens: ${draft.models.maxTokens.toLocaleString()}`}>
              <input
                type="range"
                min="256"
                max="32768"
                step="256"
                value={draft.models.maxTokens}
                onChange={(e) => updateModels({ maxTokens: parseInt(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </SettingField>
          </div>
        )}

        {/* API Keys */}
        {activeTab === "apikeys" && (
          <div className="space-y-3">
            {Object.entries(draft.apiKeys).map(([provider, key]) => (
              <SettingField key={provider} label={provider}>
                <div className="relative">
                  <input
                    type={showKeyMap[provider] ? "text" : "password"}
                    value={key}
                    onChange={(e) => updateApiKey(provider, e.target.value)}
                    placeholder={`输入 ${provider} API 密钥`}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500 pr-8"
                  />
                  <button
                    onClick={() => setShowKeyMap((prev) => ({ ...prev, [provider]: !prev[provider] }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      {showKeyMap[provider] ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </SettingField>
            ))}
            {Object.keys(draft.apiKeys).length === 0 && (
              <div className="text-xs text-gray-600 text-center py-4">暂无 API 密钥配置</div>
            )}
          </div>
        )}

        {/* Advanced */}
        {activeTab === "advanced" && (
          <div className="space-y-4">
            <SettingField label="最大重试次数">
              <input
                type="number"
                min="0"
                max="10"
                value={draft.advanced.maxRetries}
                onChange={(e) => updateAdvanced({ maxRetries: parseInt(e.target.value) || 0 })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              />
            </SettingField>
            <SettingField label={`超时时间: ${(draft.advanced.timeoutMs / 1000).toFixed(0)}s`}>
              <input
                type="range"
                min="5000"
                max="300000"
                step="5000"
                value={draft.advanced.timeoutMs}
                onChange={(e) => updateAdvanced({ timeoutMs: parseInt(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </SettingField>
            <SettingField label="详细日志">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    draft.advanced.verbose ? "bg-indigo-500" : "bg-gray-700"
                  }`}
                  onClick={() => updateAdvanced({ verbose: !draft.advanced.verbose })}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      draft.advanced.verbose ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </div>
                <span className="text-xs text-gray-400">输出详细调试信息</span>
              </label>
            </SettingField>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-gray-800 flex justify-end gap-2 flex-shrink-0">
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-white/5 transition-colors"
        >
          重置默认
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className="px-4 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          保存
        </button>
      </div>
    </div>
  );
}

/** 通用设置字段布局 */
function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
