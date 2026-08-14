'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Workflow } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface MemberAgent {
  name: string;
  display_name?: string;
  description?: string;
  default_mode?: string;
  mode_display_name?: string;
  available?: boolean;
}

interface WorkflowDef {
  name: string;
  display_name?: string;
  description?: string;
  steps?: { name?: string; display_name?: string; agent?: string }[];
}

/**
 * MembersSection — 成员管理（复刻 clowder-ai CatOverviewTab）
 *
 * 功能对齐：
 *   - 成员名册卡片（头像首字、描述、默认模式、可用性徽章）
 *   - 可用性开关（PATCH /api/v1/graph/agents/{name}，持久化 roster 覆盖层）
 *   - 默认协作编排顺序（GET /api/v1/graph/workflows 步骤链）
 *
 * 数据源：GET /api/v1/graph/agents + GET /api/v1/graph/workflows
 */
export function MembersSection() {
  const [agents, setAgents] = useState<MemberAgent[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsRes, wfRes] = await Promise.all([
        fetch('/api/v1/graph/agents'),
        fetch('/api/v1/graph/workflows'),
      ]);
      const agentData = await agentsRes.json().catch(() => []);
      const list: MemberAgent[] = Array.isArray(agentData)
        ? agentData.map((a: MemberAgent) => ({
            name: a.name,
            display_name: a.display_name || a.name,
            description: a.description || '',
            default_mode: a.default_mode,
            mode_display_name: a.mode_display_name,
            available: a.available !== false,
          }))
        : [];
      setAgents(list);
      const wfData = await wfRes.json().catch(() => []);
      setWorkflows(Array.isArray(wfData) ? wfData : []);
    } catch {
      setError('成员列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleToggleAvailability = useCallback(
    async (agent: MemberAgent) => {
      setTogglingName(agent.name);
      setError(null);
      try {
        const res = await fetch(`/api/v1/graph/agents/${encodeURIComponent(agent.name)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ available: agent.available === false }),
        });
        if (!res.ok) {
          setError(`成员状态切换失败 (${res.status})`);
          return;
        }
        setAgents((prev) =>
          prev.map((a) => (a.name === agent.name ? { ...a, available: a.available === false } : a)),
        );
      } catch {
        setError('成员状态切换失败');
      } finally {
        setTogglingName(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <SettingsText as="p" tone="muted">
        加载中...
      </SettingsText>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {error && (
        <SettingsText as="p" tone="red">
          {error}
        </SettingsText>
      )}

      <SettingsSection
        title="可进化智能体名册"
        description="成员名册、默认协作对象与可用性。关闭可用性后该成员不再参与群聊路由。"
        badge={
          <SettingsBadge tone="slate" size="xxs">
            {agents.filter((a) => a.available !== false).length}/{agents.length}
          </SettingsBadge>
        }
      >
        {agents.length === 0 ? (
          <SettingsEmptyState title="暂无成员" description="尚未注册任何可进化智能体" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agents.map((a) => {
              const unavailable = a.available === false;
              const busy = togglingName === a.name;
              return (
                <SettingsRow
                  key={a.name}
                  icon={
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: unavailable ? 'var(--border)' : 'var(--accent)',
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 700,
                        opacity: unavailable ? 0.6 : 1,
                      }}
                    >
                      {(a.display_name || a.name).slice(0, 1)}
                    </span>
                  }
                  title={`${a.display_name || a.name} · ${a.name}`}
                  meta={a.description}
                  badges={
                    <>
                      {a.default_mode ? (
                        <SettingsBadge tone="blue" size="xxs">
                          {a.mode_display_name || a.default_mode}
                        </SettingsBadge>
                      ) : null}
                      <SettingsBadge tone={unavailable ? 'slate' : 'emerald'} size="xxs">
                        {unavailable ? '不可用' : '可用'}
                      </SettingsBadge>
                    </>
                  }
                  actions={
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleToggleAvailability(a)}
                      style={{
                        position: 'relative',
                        width: 36,
                        height: 20,
                        borderRadius: 10,
                        border: 'none',
                        cursor: busy ? 'wait' : 'pointer',
                        background: unavailable ? 'var(--border)' : 'var(--accent)',
                        transition: 'background 0.2s',
                        flexShrink: 0,
                      }}
                      title={unavailable ? '启用成员' : '停用成员'}
                      aria-label={unavailable ? '启用成员' : '停用成员'}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: unavailable ? 2 : 18,
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left 0.2s',
                        }}
                      />
                    </button>
                  }
                />
              );
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="默认协作编排顺序"
        description="已定义的工作流 SOP：成员按步骤顺序协作。"
        badge={
          <SettingsBadge tone="slate" size="xxs">
            {workflows.length}
          </SettingsBadge>
        }
      >
        {workflows.length === 0 ? (
          <SettingsEmptyState title="暂无工作流" description="config/workflows 目录下无 SOP 定义" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {workflows.map((wf) => (
              <SettingsRow
                key={wf.name}
                icon={<Workflow size={16} color="var(--accent)" />}
                title={wf.display_name || wf.name}
                meta={wf.description}
                badges={
                  (wf.steps?.length ?? 0) > 0 ? (
                    <SettingsBadge tone="amber" size="xxs">
                      {(wf.steps || [])
                        .map((s) => s.display_name || s.agent || s.name)
                        .filter(Boolean)
                        .join(' → ')}
                    </SettingsBadge>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
