'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface MemberAgent {
  name: string;
  display_name?: string;
  description?: string;
  default_mode?: string;
  mode_display_name?: string;
}

/**
 * MembersSection — 成员管理
 *
 * 合并 /admin/agents 的可进化智能体配置入口。
 * 数据源：GET /api/v1/graph/agents
 */
export function MembersSection() {
  const [agents, setAgents] = useState<MemberAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/graph/agents');
      const data = await res.json().catch(() => []);
      const list: MemberAgent[] = Array.isArray(data)
        ? data.map((a: MemberAgent & Record<string, unknown>) => ({
            name: a.name,
            display_name: a.display_name || a.name,
            description: a.description || '',
            default_mode: a.default_mode,
            mode_display_name: a.mode_display_name as string | undefined,
          }))
        : [];
      setAgents(list);
    } catch {
      setError('成员列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  return (
    <SettingsSection
      title="可进化智能体名册"
      description="已注册的可进化智能体（Forgekin）与默认协作对象。完整编辑请前往 /admin/agents。"
      badge={<SettingsBadge tone="slate" size="xxs">{agents.length}</SettingsBadge>}
    >
      {agents.length === 0 ? (
        <SettingsEmptyState title="暂无成员" description="尚未注册任何可进化智能体" />
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
                  <SettingsBadge tone="blue" size="xxs">
                    {a.mode_display_name || a.default_mode}
                  </SettingsBadge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
