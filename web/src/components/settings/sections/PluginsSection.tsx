'use client';

import { useCallback, useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsHubLink, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface Plugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
}

/**
 * PluginsSection — 插件集成
 *
 * 合并 /admin/plugins。数据源：GET /api/v1/plugins。
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/plugins').catch(() => null);
      if (!res || !res.ok) {
        setPlugins([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { plugins: [] } }));
      const list = data?.data?.plugins || data?.plugins || [];
      setPlugins(Array.isArray(list) ? list : []);
    } catch {
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="插件集成"
      description="插件状态、外部集成以及安装结果。完整管理请前往 /admin/plugins。"
      badge={<SettingsBadge tone="slate" size="xxs">{plugins.length}</SettingsBadge>}
    >
      {plugins.length === 0 ? (
        <SettingsEmptyState
          icon={<Puzzle size={32} color="var(--muted)" />}
          title="暂无插件"
          description="尚未安装任何插件。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {plugins.map((p) => (
            <SettingsRow
              key={p.id}
              icon={<Puzzle size={16} color="var(--accent-2)" />}
              title={p.name}
              meta={p.description}
              badges={
                <>
                  {p.version && <SettingsBadge tone="slate" size="xxs">v{p.version}</SettingsBadge>}
                  {p.enabled !== undefined && (
                    <SettingsBadge tone={p.enabled ? 'emerald' : 'amber'} size="xxs">
                      {p.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
              actions={
                <SettingsHubLink
                  title="前往插件管理"
                  onClick={() => {
                    window.location.href = '/admin/plugins';
                  }}
                >
                  管理 →
                </SettingsHubLink>
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
