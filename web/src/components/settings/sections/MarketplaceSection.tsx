'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface MarketPackage {
  id: string;
  name: string;
  description?: string;
  type?: 'mcp' | 'skill' | 'plugin';
  installed?: boolean;
}

/**
 * MarketplaceSection — 能力市场
 *
 * 合并 /admin/marketplace。数据源：GET /api/v1/marketplace/installed。
 */
export function MarketplaceSection() {
  const [packages, setPackages] = useState<MarketPackage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/marketplace/installed').catch(() => null);
      if (!res || !res.ok) {
        setPackages([]);
        return;
      }
      const data = await res.json().catch(() => ({ plugins: [] }));
      const list = data?.plugins || [];
      setPackages(Array.isArray(list) ? list.map((p: any) => ({
        id: p.name || p.id,
        name: p.name || p.display_name || '未知',
        description: p.description,
        type: 'plugin',
        installed: true,
      })) : []);
    } catch {
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="能力市场"
      description="搜索和安装 MCP、Skill、插件等能力包。"
      badge={<SettingsBadge tone="slate" size="xxs">{packages.length}</SettingsBadge>}
    >
      {packages.length === 0 ? (
        <SettingsEmptyState
          icon={<Search size={32} color="var(--muted)" />}
          title="暂无能力包"
          description="市场接口尚未返回数据，或未连接到能力市场。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {packages.map((p) => (
            <SettingsRow
              key={p.id}
              icon={<Search size={16} color="var(--accent-2)" />}
              title={p.name}
              meta={p.description}
              badges={
                <>
                  {p.type && <SettingsBadge tone="purple" size="xxs">{p.type}</SettingsBadge>}
                  {p.installed !== undefined && (
                    <SettingsBadge tone={p.installed ? 'emerald' : 'slate'} size="xxs">
                      {p.installed ? '已安装' : '可安装'}
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
