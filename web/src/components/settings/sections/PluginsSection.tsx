'use client';

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, Plus, RefreshCw, HeartPulse } from 'lucide-react';
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
  name: string;
  category?: string;
  status?: string;
  transport?: string;
  tags?: string[];
  description?: string;
}

interface PluginHealth {
  state: string;
  message?: string;
  latency_ms?: number;
  last_check?: string;
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

/** 健康状态 → 徽章色调 */
function healthTone(state?: string): 'emerald' | 'amber' | 'red' | 'slate' {
  if (!state) return 'slate';
  if (state === 'healthy' || state === 'loaded' || state === 'running') return 'emerald';
  if (state === 'degraded' || state === 'starting') return 'amber';
  if (state === 'error' || state === 'failed' || state === 'crashed') return 'red';
  return 'slate';
}

/**
 * PluginsSection — 插件集成（对齐 clowder-ai PluginsContent）
 *
 * 数据源：GET /api/v1/plugins、GET /plugins/{name}/health、
 * POST /install、DELETE /{name}、POST /reload。
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [packageName, setPackageName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 展开的健康检查详情（对齐 clowder-ai PluginsContent 的展开配置区）
  const [expanded, setExpanded] = useState<string | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, PluginHealth | 'error'>>({});

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

  /** 展开/收起健康详情，展开时拉取最新健康数据 */
  const toggleHealth = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    try {
      const res = await fetch(`/api/v1/plugins/${encodeURIComponent(name)}/health`).catch(() => null);
      if (!res || !res.ok) {
        setHealthMap((m) => ({ ...m, [name]: 'error' }));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setHealthMap((m) => ({ ...m, [name]: data?.data || 'error' }));
    } catch {
      setHealthMap((m) => ({ ...m, [name]: 'error' }));
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  const healthyCount = plugins.filter((p) => healthTone(p.status) === 'emerald').length;

  return (
    <SettingsSection
      title="插件集成"
      description="插件状态、外部集成以及安装结果。"
      badge={<SettingsBadge tone="slate" size="xxs">{plugins.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <SettingsText as="p" variant="xs" tone="muted">
          共 {plugins.length} 个插件 · 健康 {healthyCount}
        </SettingsText>
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
          plugins.map((p) => {
            const health = healthMap[p.name];
            return (
              <SettingsRow
                key={p.name}
                icon={<Puzzle size={16} color="var(--accent-2)" />}
                title={p.name}
                meta={p.description}
                badges={
                  <>
                    {p.category && <SettingsBadge tone="blue" size="xxs">{p.category}</SettingsBadge>}
                    {p.transport && <SettingsBadge tone="purple" size="xxs">{p.transport}</SettingsBadge>}
                    <SettingsBadge tone={healthTone(p.status)} size="xxs">{p.status || 'unknown'}</SettingsBadge>
                  </>
                }
                expanded={expanded === p.name}
                onToggle={() => toggleHealth(p.name)}
                actions={
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <SettingsHubLink
                      title={`检查 ${p.name} 健康状态`}
                      onClick={() => toggleHealth(p.name)}
                      style={{ color: 'var(--accent)' }}
                    >
                      <HeartPulse size={12} style={{ marginRight: 4 }} />
                      {expanded === p.name ? '收起' : '健康检查'}
                    </SettingsHubLink>
                    <SettingsHubLink
                      title={`卸载 ${p.name}`}
                      onClick={() => uninstall(p.name)}
                      style={{ color: 'var(--danger)', opacity: busy === p.name ? 0.5 : 1 }}
                    >
                      {busy === p.name ? '卸载中...' : '卸载'}
                    </SettingsHubLink>
                  </div>
                }
              >
                {health === 'error' && (
                  <SettingsText as="p" variant="xs" tone="red">健康检查不可用（插件未注册到 Registry）</SettingsText>
                )}
                {health && health !== 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <SettingsText as="p" variant="xs">
                      状态：<SettingsBadge tone={healthTone(health.state)} size="xxs">{health.state}</SettingsBadge>
                    </SettingsText>
                    {health.message && <SettingsText as="p" variant="xs" tone="muted">{health.message}</SettingsText>}
                    {health.latency_ms != null && (
                      <SettingsText as="p" variant="xs" tone="muted">延迟：{health.latency_ms} ms</SettingsText>
                    )}
                    {health.last_check && (
                      <SettingsText as="p" variant="xs" tone="muted">最近检查：{health.last_check}</SettingsText>
                    )}
                    {Array.isArray(p.tags) && p.tags.length > 0 && (
                      <SettingsText as="p" variant="xs" tone="muted">标签：{p.tags.join('、')}</SettingsText>
                    )}
                  </div>
                )}
              </SettingsRow>
            );
          })
        )}
      </div>
    </SettingsSection>
  );
}
