'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface CapabilityProfile {
  id: string;
  label: string;
  model?: string;
  source?: string;
  signals?: string[];
}

/**
 * ProfilesSection — 能力画像
 *
 * CapabilityProfile 路由信号与来源追溯。
 * 数据源：GET /api/v1/capability/profiles（如未实现则展示空状态）。
 */
export function ProfilesSection() {
  const [profiles, setProfiles] = useState<CapabilityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/capability/profiles');
      if (!res.ok) {
        setProfiles([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { profiles: [] } }));
      const list: CapabilityProfile[] = data?.data?.profiles || data?.profiles || [];
      setProfiles(Array.isArray(list) ? list : []);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  return (
    <SettingsSection
      title="能力画像"
      description="按模型分组的能力画像、路由信号与来源追溯。"
      badge={<SettingsBadge tone="slate" size="xxs">{profiles.length}</SettingsBadge>}
    >
      {profiles.length === 0 ? (
        <SettingsEmptyState
          icon={<FileText size={32} color="var(--muted)" />}
          title="暂无能力画像"
          description="CapabilityProfile 接口尚未返回数据，或未配置画像。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {profiles.map((p) => (
            <SettingsRow
              key={p.id}
              icon={<FileText size={16} color="var(--accent-2)" />}
              title={p.label}
              meta={p.model ? `模型: ${p.model}` : undefined}
              badges={
                p.source ? (
                  <SettingsBadge tone="purple" size="xxs">{p.source}</SettingsBadge>
                ) : null
              }
            >
              {p.signals && p.signals.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {p.signals.map((s) => (
                    <SettingsBadge key={s} tone="slate" size="xxs">{s}</SettingsBadge>
                  ))}
                </div>
              )}
            </SettingsRow>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
