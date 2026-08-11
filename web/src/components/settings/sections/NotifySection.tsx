'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsHubLink,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface NotifyChannel {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  target?: string;
}

/**
 * NotifySection — 通知
 *
 * 合并 /admin/notify。数据源：GET /api/v1/notify/subscriptions。
 */
export function NotifySection() {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/notify/subscriptions').catch(() => null);
      if (!res || !res.ok) {
        setChannels([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setChannels(Array.isArray(list) ? list.map((item: any, i: number) => ({
        id: item.id || `sub_${i}`,
        name: item.channel || item.target || `渠道 ${i + 1}`,
        type: item.channel,
        enabled: item.status === 'active',
        target: item.target,
      })) : []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="通知渠道"
      description="推送订阅、提醒策略与设备联动。完整管理请前往 /admin/notify。"
      badge={<SettingsBadge tone="slate" size="xxs">{channels.length}</SettingsBadge>}
    >
      {channels.length === 0 ? (
        <SettingsEmptyState
          icon={<Bell size={32} color="var(--muted)" />}
          title="暂无通知渠道"
          description="通知渠道接口尚未返回数据，或未配置任何渠道。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {channels.map((c) => (
            <SettingsRow
              key={c.id}
              icon={<Bell size={16} color="var(--info)" />}
              title={c.name}
              meta={c.target}
              badges={
                <>
                  {c.type && <SettingsBadge tone="blue" size="xxs">{c.type}</SettingsBadge>}
                  {c.enabled !== undefined && (
                    <SettingsBadge tone={c.enabled ? 'emerald' : 'slate'} size="xxs">
                      {c.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
              actions={
                <SettingsHubLink
                  title="前往通知管理"
                  onClick={() => {
                    window.location.href = '/admin/notify';
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
