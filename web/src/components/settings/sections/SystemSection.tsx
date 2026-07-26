'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Box, Bot, Wrench, Zap } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsFilterTabs,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

type SystemTab = 'workflows' | 'agents' | 'modes' | 'tools';

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

/**
 * SystemSection — 系统配置
 *
 * 保留旧版 /admin/settings 的 workflows/agents/modes/tools 配置。
 * 数据源：
 *   - GET /api/v1/workflows
 *   - GET /api/v1/graph/agents
 *   - GET /api/v1/graph/modes
 *   - GET /api/v1/system/tools
 */
export function SystemSection() {
  const [tab, setTab] = useState<SystemTab>('workflows');
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [agents, setAgents] = useState<GraphItem[]>([]);
  const [modes, setModes] = useState<GraphItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
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

  const tabs = [
    { key: 'workflows', label: '工作流', count: workflows.length },
    { key: 'agents', label: 'Agent', count: agents.length },
    { key: 'modes', label: '执行模式', count: modes.length },
    { key: 'tools', label: '工具', count: tools.length },
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
