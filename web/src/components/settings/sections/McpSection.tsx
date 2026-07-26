'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsHubLink, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface McpServer {
  id: string;
  name: string;
  description?: string;
  tools?: number;
  enabled?: boolean;
}

/**
 * McpSection — MCP 管理
 *
 * 合并 /admin/mcp。数据源：GET /api/v1/mcp/servers。
 */
export function McpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/mcp/servers').catch(() => null);
      if (!res || !res.ok) {
        setServers([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { servers: [] } }));
      const list = data?.data?.servers || data?.servers || [];
      setServers(Array.isArray(list) ? list : []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="MCP 服务"
      description="MCP 服务、工具目录和浏览器自动化依赖。完整管理请前往 /admin/mcp。"
      badge={<SettingsBadge tone="slate" size="xxs">{servers.length}</SettingsBadge>}
    >
      {servers.length === 0 ? (
        <SettingsEmptyState
          icon={<Box size={32} color="var(--muted)" />}
          title="暂无 MCP 服务"
          description="尚未配置任何 MCP 服务。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {servers.map((s) => (
            <SettingsRow
              key={s.id}
              icon={<Box size={16} color="var(--accent-2)" />}
              title={s.name}
              meta={s.description}
              badges={
                <>
                  {s.tools != null && <SettingsBadge tone="blue" size="xxs">{s.tools} 工具</SettingsBadge>}
                  {s.enabled !== undefined && (
                    <SettingsBadge tone={s.enabled ? 'emerald' : 'slate'} size="xxs">
                      {s.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
              actions={
                <SettingsHubLink
                  title="前往 MCP 管理"
                  onClick={() => {
                    window.location.href = '/admin/mcp';
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
