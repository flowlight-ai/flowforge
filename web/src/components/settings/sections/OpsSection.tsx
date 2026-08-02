'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsHubLink,
  SettingsRow,
  SettingsSection,
  SettingsStatusStrip,
  SettingsText,
} from '../primitives';

interface ServiceHealth {
  id: string;
  name: string;
  status?: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs?: number;
  message?: string;
}

const statusTone: Record<NonNullable<ServiceHealth['status']>, 'emerald' | 'amber' | 'red' | 'slate'> = {
  healthy: 'emerald',
  degraded: 'amber',
  down: 'red',
  unknown: 'slate',
};

const statusLabel: Record<NonNullable<ServiceHealth['status']>, string> = {
  healthy: '健康',
  degraded: '降级',
  down: '故障',
  unknown: '未知',
};

/**
 * OpsSection — 运维监控
 *
 * 合并 /admin/observability。数据源：GET /api/v1/health/services。
 */
export function OpsSection() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/health/services').catch(() => null);
      if (!res || !res.ok) {
        setServices([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { services: [] } }));
      const list = data?.data?.services || data?.services || [];
      setServices(Array.isArray(list) ? list : []);
    } catch {
      setError('健康检查加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  const downCount = services.filter((s) => s.status === 'down').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;

  return (
    <SettingsSection
      title="运维监控"
      description="服务健康、可观测性和运行态观测。完整看板请前往 /admin/observability。"
      badge={<SettingsBadge tone="slate" size="xxs">{services.length}</SettingsBadge>}
    >
      {downCount > 0 && (
        <SettingsStatusStrip tone="error" style={{ marginBottom: '12px' }}>
          ⚠ {downCount} 个服务处于故障状态
        </SettingsStatusStrip>
      )}
      {downCount === 0 && degradedCount > 0 && (
        <SettingsStatusStrip tone="warn" style={{ marginBottom: '12px' }}>
          {degradedCount} 个服务降级运行
        </SettingsStatusStrip>
      )}
      {downCount === 0 && degradedCount === 0 && services.length > 0 && (
        <SettingsStatusStrip tone="success" style={{ marginBottom: '12px' }}>
          ✓ 全部服务运行正常
        </SettingsStatusStrip>
      )}

      {services.length === 0 ? (
        <SettingsEmptyState
          icon={<Activity size={32} color="var(--muted)" />}
          title="暂无健康数据"
          description="健康检查接口尚未返回数据。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {services.map((s) => {
            const tone = s.status ? statusTone[s.status] : 'slate';
            return (
              <SettingsRow
                key={s.id}
                icon={<Activity size={16} color="var(--info)" />}
                title={s.name}
                meta={s.message}
                badges={
                  <>
                    <SettingsBadge tone={tone} size="xxs">
                      {s.status ? statusLabel[s.status] : '未知'}
                    </SettingsBadge>
                    {s.latencyMs != null && (
                      <SettingsBadge tone="slate" size="xxs">{s.latencyMs}ms</SettingsBadge>
                    )}
                  </>
                }
                actions={
                  <SettingsHubLink
                    title="前往可观测性看板"
                    onClick={() => {
                      window.location.href = '/admin/observability';
                    }}
                  >
                    看板 →
                  </SettingsHubLink>
                }
              />
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
