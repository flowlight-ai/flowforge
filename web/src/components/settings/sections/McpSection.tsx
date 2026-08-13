'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, Plus } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsHubLink,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface McpServer {
  id: string;
  name: string;
  description?: string;
  tools?: number;
  enabled?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 320,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-elevated)',
  padding: '6px 10px',
  fontSize: '13px',
  color: 'var(--text-strong)',
  outline: 'none',
};

/**
 * McpSection — MCP 管理（可注册服务）
 *
 * 合并 /admin/mcp。数据源：GET/POST /api/v1/mcp/servers。
 */
export function McpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', url: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/mcp/servers').catch(() => null);
      if (!res || !res.ok) {
        setServers([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setServers(Array.isArray(list) ? list.map((item: any) => ({
        id: item.id || item.name,
        name: item.name,
        description: item.description,
        tools: item.tools,
        enabled: item.enabled,
      })) : []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          transport: form.transport,
          command: form.command.trim() || null,
          url: form.url.trim() || null,
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已注册 MCP 服务');
      setForm({ name: '', transport: 'stdio', command: '', url: '' });
      setShowForm(false);
      await fetchServers();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('注册失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="MCP 服务"
      description="MCP 服务、工具目录和浏览器自动化依赖。"
      badge={<SettingsBadge tone="slate" size="xxs">{servers.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!showForm && (
          <SettingsPrimaryButton onClick={() => setShowForm(true)} disabled={saving}>
            <Plus size={14} style={{ marginRight: 4 }} /> 注册 MCP 服务
          </SettingsPrimaryButton>
        )}
        {showForm && (
          <SettingsRow icon={<Box size={16} color="var(--accent-2)" />} title="注册 MCP 服务">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SettingsField label="服务名称">
                <input
                  style={inputStyle}
                  value={form.name}
                  placeholder="如 filesystem"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="传输方式">
                <select
                  style={inputStyle}
                  value={form.transport}
                  onChange={(e) => setForm({ ...form, transport: e.target.value })}
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="http">http</option>
                </select>
              </SettingsField>
              <SettingsField label="启动命令" hint="stdio 传输时的可执行命令">
                <input
                  style={inputStyle}
                  value={form.command}
                  placeholder="如 npx -y @modelcontextprotocol/server-filesystem"
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="服务 URL" hint="sse/http 传输时的端点地址">
                <input
                  style={inputStyle}
                  value={form.url}
                  placeholder="如 https://mcp.example.com/sse"
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton onClick={submit} disabled={saving || !form.name.trim()}>
                  {saving ? '注册中...' : '确认注册'}
                </SettingsPrimaryButton>
                <SettingsHubLink title="取消" onClick={() => setShowForm(false)}>取消</SettingsHubLink>
              </div>
            </div>
          </SettingsRow>
        )}
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
        {servers.length === 0 ? (
          <SettingsEmptyState
            icon={<Box size={32} color="var(--muted)" />}
            title="暂无 MCP 服务"
            description="点击上方按钮注册服务，或配置 plugins.yaml 内置服务。"
          />
        ) : (
          servers.map((s) => (
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
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
