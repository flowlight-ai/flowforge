'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsField, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface ConciergeConfig {
  enabled?: boolean;
  persona?: string;
  proactive?: boolean;
  dutyRoster?: string;
}

/**
 * ConciergeSection — 管家配置
 *
 * 管家形象、人设、值班策略和主动性配置。
 * 数据源：GET /api/v1/concierge/config。
 */
export function ConciergeSection() {
  const [config, setConfig] = useState<ConciergeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/concierge/config').catch(() => null);
      if (!res || !res.ok) {
        setConfig(null);
        return;
      }
      const data = await res.json().catch(() => ({ data: { config: {} } }));
      setConfig(data?.data?.config || data?.config || {});
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (!config) {
    return (
      <SettingsEmptyState
        icon={<Bell size={32} color="var(--muted)" />}
        title="管家未配置"
        description="管家配置接口尚未返回数据。"
      />
    );
  }

  return (
    <SettingsSection
      title="管家配置"
      description="管家形象、人设、值班策略和主动性配置。"
      badge={
        <SettingsBadge tone={config.enabled ? 'emerald' : 'slate'} size="xxs">
          {config.enabled ? '已启用' : '已停用'}
        </SettingsBadge>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <SettingsRow
          icon={<Bell size={16} color="var(--accent-2)" />}
          title="启用状态"
          badges={<SettingsBadge tone={config.enabled ? 'emerald' : 'slate'} size="xxs">{config.enabled ? 'ON' : 'OFF'}</SettingsBadge>}
        >
          <SettingsField
            label="主动性策略"
            hint="开启后管家将主动发起会话与提醒"
            inline
            compact
            badge={<SettingsBadge tone={config.proactive ? 'emerald' : 'amber'} size="xxs">{config.proactive ? '主动' : '被动'}</SettingsBadge>}
          >
            <span>{config.proactive ? '已开启' : '已关闭'}</span>
          </SettingsField>
        </SettingsRow>
        {config.persona && (
          <SettingsRow
            title="人设"
            meta={config.persona}
          />
        )}
        {config.dutyRoster && (
          <SettingsRow
            title="值班表"
            meta={config.dutyRoster}
          />
        )}
      </div>
    </SettingsSection>
  );
}
