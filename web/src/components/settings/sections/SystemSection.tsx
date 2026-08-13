'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Box, Bot, FileKey, Settings as SettingsIcon, Wrench, Zap } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsFilterTabs,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

type SystemTab = 'workflows' | 'agents' | 'modes' | 'tools' | 'env' | 'config';

interface WorkflowItem {
  name: string;
  display_name: string;
  description: string;
  icon?: string;
  category?: string;
  steps?: number;
}

interface GraphItem {
  name: string;
  display_name?: string;
  description?: string;
  default_mode?: string;
  mode_display_name?: string;
  capabilities?: string[];
}

interface ToolItem {
  name: string;
  description?: string;
  enabled?: boolean;
  category?: string;
}

interface EnvFileItem {
  filename: string;
  path?: string;
  size?: number;
  lineCount?: number;
  modifiedAt?: string;
  maskedContent?: string;
}

/**
 * SystemSection — 系统配置
 *
 * 保留旧版 /admin/settings 的 workflows/agents/modes/tools 配置，
 * 并新增环境文件管理（对齐 clowder-ai HubEnvFilesTab）与运行配置视图。
 * 数据源：
 *   - GET /api/v1/workflows
 *   - GET /api/v1/graph/agents
 *   - GET /api/v1/graph/modes
 *   - GET /api/v1/system/tools
 *   - GET/PUT /api/v1/env/files
 *   - GET /api/v1/settings/config
 */
export function SystemSection() {
  const [tab, setTab] = useState<SystemTab>('workflows');
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [agents, setAgents] = useState<GraphItem[]>([]);
  const [modes, setModes] = useState<GraphItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [envFiles, setEnvFiles] = useState<EnvFileItem[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<Record<string, unknown> | null>(null);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState('');
  const [envSaving, setEnvSaving] = useState(false);
  const [envMessage, setEnvMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTab = useCallback(async (t: SystemTab) => {
    setLoading(true);
    setError(null);
    try {
      if (t === 'workflows') {
        const data = await fetch('/api/v1/workflows').then((r) => r.json()).catch(() => ({ data: { workflows: [] } }));
        setWorkflows(data?.data?.workflows || []);
      } else if (t === 'agents') {
        const d = await fetch('/api/v1/graph/agents').then((r) => r.json()).catch(() => []);
        setAgents(Array.isArray(d) ? d : []);
      } else if (t === 'modes') {
        const d = await fetch('/api/v1/graph/modes').then((r) => r.json()).catch(() => []);
        setModes(Array.isArray(d) ? d : []);
      } else if (t === 'tools') {
        const d = await fetch('/api/v1/system/tools').then((r) => r.json()).then((d) => d?.tools || []).catch(() => []);
        setTools(Array.isArray(d) ? d : []);
      } else if (t === 'env') {
        const d = await fetch('/api/v1/env/files').then((r) => r.json()).catch(() => ({ items: [] }));
        const list = d?.items || [];
        setEnvFiles(Array.isArray(list) ? list : []);
      } else if (t === 'config') {
        const d = await fetch('/api/v1/settings/config').then((r) => r.json()).catch(() => ({ data: { config: {} } }));
        setRuntimeConfig(d?.data?.config || d?.config || {});
      }
    } catch {
      setError('数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTab(tab);
  }, [tab, fetchTab]);

  const saveEnvFile = async (filename: string) => {
    setEnvSaving(true);
    setEnvMessage(null);
    try {
      const res = await fetch('/api/v1/env/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: envDraft, merge: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEnvMessage(`已保存 ${filename}`);
      setExpandedEnv(null);
      await fetchTab('env');
      setTimeout(() => setEnvMessage(null), 3000);
    } catch {
      setEnvMessage('保存失败');
    } finally {
      setEnvSaving(false);
    }
  };

  const tabs = [
    { key: 'workflows', label: '工作流', count: workflows.length },
    { key: 'agents', label: 'Agent', count: agents.length },
    { key: 'modes', label: '执行模式', count: modes.length },
    { key: 'tools', label: '工具', count: tools.length },
    { key: 'env', label: '环境文件', count: envFiles.length },
    { key: 'config', label: '运行配置', count: runtimeConfig ? Object.keys(runtimeConfig).length : 0 },
  ];

  return (
    <SettingsSection
      title="系统配置"
      description="工作流、Agent、执行模式与工具的运行时总开关。"
    >
      <div style={{ marginBottom: '12px' }}>
        <SettingsFilterTabs tabs={tabs} activeKey={tab} onTabChange={(k) => setTab(k as SystemTab)} />
      </div>

      {loading ? (
        <SettingsText as="p" tone="muted">加载中...</SettingsText>
      ) : error ? (
        <SettingsText as="p" tone="red">{error}</SettingsText>
      ) : tab === 'workflows' ? (
        workflows.length === 0 ? (
          <SettingsEmptyState title="暂无工作流" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {workflows.map((w) => (
              <SettingsRow
                key={w.name}
                icon={<span style={{ fontSize: '18px' }}>{w.icon || '📋'}</span>}
                title={w.display_name}
                meta={w.description}
                badges={
                  <>
                    {w.category && <SettingsBadge tone="slate" size="xxs">{w.category}</SettingsBadge>}
                    {w.steps != null && <SettingsBadge tone="blue" size="xxs">{w.steps} 步</SettingsBadge>}
                  </>
                }
              />
            ))}
          </div>
        )
      ) : tab === 'agents' ? (
        agents.length === 0 ? (
          <SettingsEmptyState title="暂无 Agent" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agents.map((a) => (
              <SettingsRow
                key={a.name}
                icon={<Bot size={16} color="var(--accent)" />}
                title={a.display_name || a.name}
                meta={a.description}
                badges={
                  a.default_mode ? (
                    <SettingsBadge tone="blue" size="xxs">{a.mode_display_name || a.default_mode}</SettingsBadge>
                  ) : null
                }
              />
            ))}
          </div>
        )
      ) : tab === 'modes' ? (
        modes.length === 0 ? (
          <SettingsEmptyState title="暂无执行模式" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {modes.map((m) => (
              <SettingsRow
                key={m.name}
                icon={<Zap size={16} color="var(--accent-2)" />}
                title={m.display_name || m.name}
                meta={m.description}
                badges={
                  m.capabilities && m.capabilities.length > 0 ? (
                    <SettingsBadge tone="purple" size="xxs">{m.capabilities.length} 能力</SettingsBadge>
                  ) : null
                }
              />
            ))}
          </div>
        )
      ) : tab === 'env' ? (
        <>
          {envMessage && (
            <SettingsText as="p" variant="xs" tone={envMessage.includes('失败') ? 'red' : 'muted'}>{envMessage}</SettingsText>
          )}
          {envFiles.length === 0 ? (
            <SettingsEmptyState title="暂无环境文件" description="项目根目录未发现 .env 类文件。" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {envFiles.map((f) => (
                <SettingsRow
                  key={f.filename}
                  icon={<FileKey size={16} color="var(--info)" />}
                  title={f.filename}
                  meta={f.path}
                  badges={
                    <>
                      {f.lineCount != null && <SettingsBadge tone="blue" size="xxs">{f.lineCount} 行</SettingsBadge>}
                      {f.size != null && <SettingsBadge tone="slate" size="xxs">{f.size} B</SettingsBadge>}
                    </>
                  }
                  expanded={expandedEnv === f.filename}
                  onToggle={() => {
                    if (expandedEnv === f.filename) {
                      setExpandedEnv(null);
                    } else {
                      setExpandedEnv(f.filename);
                      setEnvDraft(f.maskedContent || '');
                    }
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <SettingsText as="p" variant="xs" tone="muted">
                      内容已脱敏；编辑后按行合并写入。最后修改：{f.modifiedAt || '未知'}
                    </SettingsText>
                    <textarea
                      value={envDraft}
                      onChange={(e) => setEnvDraft(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '120px',
                        padding: '8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-strong)',
                        fontSize: '12px',
                        fontFamily: 'var(--mono)',
                        lineHeight: 1.6,
                        resize: 'vertical',
                        outline: 'none',
                      }}
                    />
                    <div>
                      <SettingsPrimaryButton onClick={() => saveEnvFile(f.filename)} disabled={envSaving}>
                        {envSaving ? '保存中...' : '合并保存'}
                      </SettingsPrimaryButton>
                    </div>
                  </div>
                </SettingsRow>
              ))}
            </div>
          )}
        </>
      ) : tab === 'config' ? (
        !runtimeConfig || Object.keys(runtimeConfig).length === 0 ? (
          <SettingsEmptyState title="暂无运行配置" description="models.yaml 未加载到配置项。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(runtimeConfig).map(([key, value]) => (
              <SettingsRow
                key={key}
                icon={<SettingsIcon size={16} color="var(--accent)" />}
                title={key}
                meta={typeof value === 'object' ? `对象（${Object.keys(value as object).length} 项）` : String(value)}
              >
                <SettingsField label="当前值" hint="只读；如需修改请通过密钥库或直接编辑 models.yaml">
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-strong)',
                      fontSize: '11px',
                      fontFamily: 'var(--mono)',
                      maxHeight: '200px',
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(value, null, 2)}
                  </pre>
                </SettingsField>
              </SettingsRow>
            ))}
          </div>
        )
      ) : tools.length === 0 ? (
        <SettingsEmptyState title="暂无工具" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tools.map((t) => (
            <SettingsRow
              key={t.name}
              icon={<Wrench size={16} color="var(--info)" />}
              title={t.name}
              meta={t.description}
              badges={
                <>
                  {t.category && <SettingsBadge tone="slate" size="xxs">{t.category}</SettingsBadge>}
                  {t.enabled !== undefined && (
                    <SettingsBadge tone={t.enabled ? 'emerald' : 'amber'} size="xxs">
                      {t.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
