'use client';

import { useCallback, useEffect, useState } from 'react';
import { Key } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface ProviderAccount {
  id: string;
  name: string;
  provider?: string;
  model?: string;
  configured?: boolean;
}

/**
 * AccountsSection — 账户与密钥
 *
 * 合并 /admin/models 的 providers。
 * 数据源：GET /api/v1/models/providers（回退到 /api/v1/models）。
 */
export function AccountsSection() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/models/providers').catch(() => null);
      if (!res || !res.ok) {
        const fallback = await fetch('/api/v1/models').catch(() => null);
        if (!fallback || !fallback.ok) {
          setAccounts([]);
          return;
        }
        const data = await fallback.json().catch(() => ({ data: { providers: [] } }));
        const list = data?.data?.providers || data?.providers || [];
        setAccounts(Array.isArray(list) ? list : []);
        return;
      }
      const data = await res.json().catch(() => ({ data: { providers: [] } }));
      const list = data?.data?.providers || data?.providers || [];
      setAccounts(Array.isArray(list) ? list : []);
    } catch {
      setError('账户列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  return (
    <SettingsSection
      title="模型 Provider 与密钥"
      description="模型账户、API Key 与执行身份归属。完整管理请前往 /admin/models。"
      badge={<SettingsBadge tone="slate" size="xxs">{accounts.length}</SettingsBadge>}
    >
      {accounts.length === 0 ? (
        <SettingsEmptyState
          icon={<Key size={32} color="var(--muted)" />}
          title="暂无 Provider"
          description="尚未配置任何模型 Provider。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {accounts.map((a) => (
            <SettingsRow
              key={a.id}
              icon={<Key size={16} color="var(--accent)" />}
              title={a.name}
              meta={a.model ? `模型: ${a.model}` : a.provider}
              badges={
                a.configured !== undefined ? (
                  <SettingsBadge tone={a.configured ? 'emerald' : 'amber'} size="xxs">
                    {a.configured ? '已配置' : '未配置'}
                  </SettingsBadge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
