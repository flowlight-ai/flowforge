'use client';

import { useCallback, useEffect, useState } from 'react';
import { Key } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface ProviderAccount {
  name: string;
  base_url?: string;
  api_key_env?: string;
  key_configured?: boolean;
  key_masked?: string;
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
 * AccountsSection — 账户与密钥（可配置密钥）
 *
 * 数据源：GET /api/v1/settings/providers + POST /api/v1/settings/secrets。
 */
export function AccountsSection() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings/providers').catch(() => null);
      if (!res || !res.ok) {
        setAccounts([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { providers: [] } }));
      const list = data?.data?.providers || [];
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

  const saveKey = async (account: ProviderAccount) => {
    const envName = account.api_key_env?.trim() || `${account.name.toUpperCase()}_API_KEY`;
    if (!keyValue.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/settings/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: envName,
          value: keyValue.trim(),
          category: 'api_key',
          description: `${account.name} API Key`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已保存 ${account.name} 密钥`);
      setKeyValue('');
      setEditing(null);
      await fetchAccounts();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('密钥保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  return (
    <SettingsSection
      title="模型 Provider 与密钥"
      description="模型账户、API Key 与执行身份归属。"
      badge={<SettingsBadge tone="slate" size="xxs">{accounts.length}</SettingsBadge>}
    >
      {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
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
              key={a.name}
              icon={<Key size={16} color="var(--accent)" />}
              title={a.name}
              meta={a.base_url}
              badges={
                <SettingsBadge tone={a.key_configured ? 'emerald' : 'amber'} size="xxs">
                  {a.key_configured ? '已配置' : '未配置'}
                </SettingsBadge>
              }
              actions={
                <SettingsPrimaryButton onClick={() => setEditing(editing === a.name ? null : a.name)}>
                  {editing === a.name ? '取消' : a.key_configured ? '更新密钥' : '配置密钥'}
                </SettingsPrimaryButton>
              }
            >
              {editing === a.name && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <SettingsField label="环境变量名" hint={`写入 ${a.api_key_env || `${a.name.toUpperCase()}_API_KEY`} 到密钥存储`}>
                    <SettingsText as="span" variant="xs" tone="muted" style={{ fontFamily: 'var(--mono)' }}>
                      {a.api_key_env || `${a.name.toUpperCase()}_API_KEY`}
                    </SettingsText>
                  </SettingsField>
                  <SettingsField label="API Key">
                    <input
                      type="password"
                      style={inputStyle}
                      value={keyValue}
                      placeholder="粘贴新的 API Key"
                      onChange={(e) => setKeyValue(e.target.value)}
                    />
                  </SettingsField>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <SettingsPrimaryButton onClick={() => saveKey(a)} disabled={saving || !keyValue.trim()}>
                      {saving ? '保存中...' : '保存密钥'}
                    </SettingsPrimaryButton>
                  </div>
                  {a.key_masked && (
                    <SettingsText as="span" variant="xs" tone="muted" style={{ fontFamily: 'var(--mono)' }}>
                      当前：{a.key_masked}
                    </SettingsText>
                  )}
                </div>
              )}
            </SettingsRow>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
