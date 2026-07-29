'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsHubLink, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface ImConnector {
  id: string;
  name: string;
  platform?: string;
  configured?: boolean;
}

/**
 * ImSection — IM 对接
 *
 * 合并 /admin/im。数据源：GET /api/v1/connectors。
 */
export function ImSection() {
  const [connectors, setConnectors] = useState<ImConnector[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/connectors').catch(() => null);
      if (!res || !res.ok) {
        setConnectors([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { connectors: [] } }));
      const list = data?.data?.connectors || data?.connectors || [];
      setConnectors(Array.isArray(list) ? list : []);
    } catch {
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="IM 对接"
      description="飞书、钉钉、企微和外部消息入口。完整配置请前往 /admin/im。"
      badge={<SettingsBadge tone="slate" size="xxs">{connectors.length}</SettingsBadge>}
    >
      {connectors.length === 0 ? (
        <SettingsEmptyState
          icon={<Plug size={32} color="var(--muted)" />}
          title="暂无 IM 连接器"
          description="尚未配置飞书/钉钉/企微等 IM 入口。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {connectors.map((c) => (
            <SettingsRow
              key={c.id}
              icon={<Plug size={16} color="var(--accent-2)" />}
              title={c.name}
              meta={c.platform}
              badges={
                c.configured !== undefined ? (
                  <SettingsBadge tone={c.configured ? 'emerald' : 'amber'} size="xxs">
                    {c.configured ? '已连接' : '未连接'}
                  </SettingsBadge>
                ) : null
              }
              actions={
                <SettingsHubLink
                  title="前往 IM 管理"
                  onClick={() => {
                    window.location.href = '/admin/im';
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
