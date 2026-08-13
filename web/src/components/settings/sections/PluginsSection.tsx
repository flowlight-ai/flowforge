'use client';

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, Plus, RefreshCw } from 'lucide-react';
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

interface Plugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
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
 * PluginsSection — 插件集成（可安装/卸载/重载）
 *
 * 合并 /admin/plugins。数据源：GET /api/v1/plugins + POST /install + DELETE /{name}。
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [packageName, setPackageName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const install = async () => {
    if (!packageName.trim()) return;
    setBusy('install');
    setMessage(null);
    try {
      const res = await fetch('/api/v1/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: packageName.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已安装 ${packageName.trim()}`);
      setPackageName('');
      setShowForm(false);
      await fetchPlugins();
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setMessage('安装失败（请确认包名正确）');
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (name: string) => {
    setBusy(name);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已卸载 ${name}`);
      await fetchPlugins();
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setMessage(`卸载 ${name} 失败`);
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    setBusy('reload');
    setMessage(null);
    try {
      const res = await fetch('/api/v1/plugins/reload', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('插件已重载');
      await fetchPlugins();
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setMessage('重载失败');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="插件集成"
      description="插件状态、外部集成以及安装结果。"
      badge={<SettingsBadge tone="slate" size="xxs">{plugins.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!showForm && (
            <SettingsPrimaryButton onClick={() => setShowForm(true)} disabled={busy !== null}>
              <Plus size={14} style={{ marginRight: 4 }} /> 安装插件
            </SettingsPrimaryButton>
          )}
          <SettingsHubLink title="重载插件" onClick={reload} style={busy === 'reload' ? { opacity: 0.5 } : undefined}>
            <RefreshCw size={12} style={{ marginRight: 4 }} /> 重载
          </SettingsHubLink>
        </div>
        {showForm && (
          <SettingsRow icon={<Puzzle size={16} color="var(--accent-2)" />} title="安装 Python 插件包">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SettingsField label="包名" hint="通过 pip 安装，如 flowforge-plugin-demo">
                <input
                  style={inputStyle}
                  value={packageName}
                  placeholder="如 flowforge-plugin-demo"
                  onChange={(e) => setPackageName(e.target.value)}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton onClick={install} disabled={busy !== null || !packageName.trim()}>
                  {busy === 'install' ? '安装中...' : '确认安装'}
                </SettingsPrimaryButton>
                <SettingsHubLink title="取消" onClick={() => setShowForm(false)}>取消</SettingsHubLink>
              </div>
            </div>
          </SettingsRow>
        )}
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
        {plugins.length === 0 ? (
          <SettingsEmptyState
            icon={<Puzzle size={32} color="var(--muted)" />}
            title="暂无插件"
            description="点击上方按钮安装插件。"
          />
        ) : (
          plugins.map((p) => (
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
                  title={`卸载 ${p.name}`}
                  onClick={() => uninstall(p.name)}
                  style={busy === p.name ? { opacity: 0.5 } : undefined}
                >
                  {busy === p.name ? '卸载中...' : '卸载'}
                </SettingsHubLink>
              }
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
