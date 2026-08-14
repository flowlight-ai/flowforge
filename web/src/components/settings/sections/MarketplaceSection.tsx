'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsHubLink,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSearchInput,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface MarketPackage {
  id: string;
  name: string;
  description?: string;
  version?: string;
  installed?: boolean;
}

/**
 * MarketplaceSection — 能力市场（可搜索/安装/卸载）
 *
 * 数据源：GET /api/v1/marketplace/installed、POST /api/v1/marketplace/install、uninstall。
 */
export function MarketplaceSection() {
  const [packages, setPackages] = useState<MarketPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketPackage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchInstalled = useCallback(async () => {
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
        version: p.version,
        installed: true,
      })) : []);
    } catch {
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstalled();
  }, [fetchInstalled]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/marketplace/search?q=${encodeURIComponent(query.trim())}`).catch(() => null);
      if (!res || !res.ok) {
        setResults([]);
        return;
      }
      const data = await res.json().catch(() => ({ plugins: [] }));
      const list = data?.plugins || [];
      setResults(Array.isArray(list) ? list.map((p: any) => ({
        id: p.name || p.id,
        name: p.name || p.display_name || '未知',
        description: p.description,
        version: p.version,
        installed: packages.some((x) => x.id === (p.name || p.id)),
      })) : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const install = async (name: string) => {
    setBusy(name);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已安装 ${name}`);
      setResults(null);
      await fetchInstalled();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage(`安装 ${name} 失败`);
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (name: string) => {
    setBusy(name);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/marketplace/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已卸载 ${name}`);
      await fetchInstalled();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage(`卸载 ${name} 失败`);
    } finally {
      setBusy(null);
    }
  };

  const update = async (name: string) => {
    setBusy(`update:${name}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/marketplace/update/${encodeURIComponent(name)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已更新 ${name}`);
      await fetchInstalled();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage(`更新 ${name} 失败（可能已是最新版本）`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="能力市场"
      description="搜索和安装 MCP、Skill、插件等能力包。"
      badge={<SettingsBadge tone="slate" size="xxs">{packages.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{ flex: 1, maxWidth: 320 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
          >
            <SettingsSearchInput
              value={query}
              onChange={setQuery}
              placeholder="搜索市场插件，如 web-search"
            />
          </div>
          <SettingsPrimaryButton onClick={search} disabled={searching || !query.trim()}>
            {searching ? '搜索中...' : '搜索'}
          </SettingsPrimaryButton>
        </div>
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}

        {results !== null && (
          <>
            <SettingsText as="p" variant="xs" tone="muted">
              搜索结果（{results.length}）：点击「安装」即可从市场安装
            </SettingsText>
            {results.length === 0 ? (
              <SettingsText as="p" variant="xs" tone="muted">没有匹配的插件</SettingsText>
            ) : (
              results.map((p) => (
                <SettingsRow
                  key={p.id}
                  icon={<Search size={16} color="var(--accent-2)" />}
                  title={p.name}
                  meta={p.description}
                  badges={
                    <>
                      {p.version && <SettingsBadge tone="slate" size="xxs">v{p.version}</SettingsBadge>}
                      {p.installed && <SettingsBadge tone="emerald" size="xxs">已安装</SettingsBadge>}
                    </>
                  }
                  actions={
                    !p.installed ? (
                      <SettingsPrimaryButton onClick={() => install(p.name)} disabled={busy === p.name}>
                        {busy === p.name ? '安装中...' : '安装'}
                      </SettingsPrimaryButton>
                    ) : undefined
                  }
                />
              ))
            )}
          </>
        )}

        <SettingsText as="p" variant="xs" tone="muted">已安装（{packages.length}）</SettingsText>
        {packages.length === 0 ? (
          <SettingsEmptyState
            icon={<Search size={32} color="var(--muted)" />}
            title="暂无能力包"
            description="在上方搜索并安装能力包。"
          />
        ) : (
          packages.map((p) => (
            <SettingsRow
              key={p.id}
              icon={<Search size={16} color="var(--accent-2)" />}
              title={p.name}
              meta={p.description}
              badges={
                <>
                  <SettingsBadge tone="purple" size="xxs">plugin</SettingsBadge>
                  {p.version && <SettingsBadge tone="slate" size="xxs">v{p.version}</SettingsBadge>}
                </>
              }
              actions={
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <SettingsHubLink
                    title={`更新 ${p.name} 到最新版本`}
                    onClick={() => update(p.name)}
                    style={{ opacity: busy === `update:${p.name}` ? 0.5 : 1 }}
                  >
                    {busy === `update:${p.name}` ? '更新中...' : '更新'}
                  </SettingsHubLink>
                  <SettingsPrimaryButton onClick={() => uninstall(p.name)} disabled={busy === p.name}>
                    {busy === p.name ? '卸载中...' : '卸载'}
                  </SettingsPrimaryButton>
                </div>
              }
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
