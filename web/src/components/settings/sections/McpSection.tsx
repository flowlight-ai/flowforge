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
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  tools?: number;
  enabled?: boolean;
  tags?: string[];
  isBuiltin: boolean;
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

/** 拼接 transport 子信息（对齐 clowder-ai McpManageContent 的 `stdio · cmd args` 展示） */
function transportMeta(s: McpServer): string | undefined {
  if (!s.transport) return undefined;
  if (s.transport === 'stdio' && s.command) {
    const args = Array.isArray(s.args) && s.args.length > 0 ? ` ${s.args.join(' ')}` : '';
    return `stdio · ${s.command}${args}`;
  }
  if ((s.transport === 'http' || s.transport === 'sse') && s.url) {
    return `${s.transport} · ${s.url}`;
  }
  return s.transport;
}

/**
 * McpSection — MCP 管理（对齐 clowder-ai McpManageContent）
 *
 * 数据源：GET/POST /api/v1/mcp/servers、PUT /servers/{id}（开关）、DELETE /servers/{id}（仅 custom）。
 */
export function McpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', args: '', url: '' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
        transport: item.transport,
        command: item.command,
        args: item.args,
        url: item.url,
        tools: item.tools,
        enabled: item.enabled,
        tags: item.tags,
        // 内置条目 id 形如 plugin:xxx / mcp:xxx；自定义为 mcp_时间戳
        isBuiltin: typeof item.id === 'string' && (item.id.startsWith('plugin:') || item.id.startsWith('mcp:')),
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
          args: form.args.split(' ').map((s) => s.trim()).filter(Boolean),
          url: form.url.trim() || null,
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已注册 MCP 服务');
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '' });
      setShowForm(false);
      await fetchServers();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('注册失败');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: McpServer) => {
    setBusy(s.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(s.enabled ? `已禁用 ${s.name}` : `已启用 ${s.name}`);
      await fetchServers();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('切换失败');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: McpServer) => {
    setBusy(s.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已删除 MCP 服务');
      await fetchServers();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('删除失败（内置服务不可删除）');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <SettingsSection
      title="MCP 服务"
      description="MCP 服务、工具目录和浏览器自动化依赖。"
      badge={<SettingsBadge tone="slate" size="xxs">{servers.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <SettingsText as="p" variant="xs" tone="muted">
          共 {servers.length} 个服务 · 启用 {enabledCount}
        </SettingsText>
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
                  placeholder="如 npx"
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="命令参数" hint="空格分隔，如 -y @modelcontextprotocol/server-filesystem">
                <input
                  style={inputStyle}
                  value={form.args}
                  placeholder="如 -y @modelcontextprotocol/server-filesystem"
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
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
              meta={transportMeta(s) || s.description}
              badges={
                <>
                  {s.transport && <SettingsBadge tone="blue" size="xxs">{s.transport}</SettingsBadge>}
                  {s.tools != null && s.tools > 0 && <SettingsBadge tone="purple" size="xxs">{s.tools} 工具</SettingsBadge>}
                  {s.isBuiltin && <SettingsBadge tone="slate" size="xxs">内置</SettingsBadge>}
                  {s.enabled !== undefined && (
                    <SettingsBadge tone={s.enabled ? 'emerald' : 'slate'} size="xxs">
                      {s.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
              actions={
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <SettingsHubLink
                    title={s.enabled ? '禁用该 MCP 服务' : '启用该 MCP 服务'}
                    onClick={() => toggle(s)}
                    style={busy === s.id ? { opacity: 0.5 } : undefined}
                  >
                    {busy === s.id ? '处理中...' : s.enabled ? '禁用' : '启用'}
                  </SettingsHubLink>
                  {!s.isBuiltin && (
                    <SettingsHubLink
                      title="删除该 MCP 服务"
                      onClick={() => remove(s)}
                      style={{ color: 'var(--danger)', opacity: busy === s.id ? 0.5 : 1 }}
                    >
                      删除
                    </SettingsHubLink>
                  )}
                </div>
              }
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
