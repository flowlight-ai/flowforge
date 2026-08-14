'use client';

import { useCallback, useEffect, useState } from 'react';
import { Key, ShieldCheck, Trash2 } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSecondaryButton,
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

interface SecretEntry {
  key: string;
  category?: string;
  description?: string;
  configured?: boolean;
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
 * AccountsSection — 账户与密钥（复刻 clowder-ai HubAccountsTab）
 *
 * 功能对齐：
 *   - 模型 Provider 账户卡片（密钥状态徽章 + 脱敏回显 + 配置/更新密钥）
 *   - 密钥库管理（列表 + 分类徽章 + 新增自定义密钥 + 删除）
 *
 * 数据源：
 *   GET /api/v1/settings/providers、GET/POST/DELETE /api/v1/settings/secrets
 */
export function AccountsSection() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [newSecret, setNewSecret] = useState({ key: '', value: '', category: 'api_key', description: '' });
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, secRes] = await Promise.all([
        fetch('/api/v1/settings/providers').catch(() => null),
        fetch('/api/v1/settings/secrets').catch(() => null),
      ]);
      if (provRes?.ok) {
        const data = await provRes.json().catch(() => ({ data: { providers: [] } }));
        const list = data?.data?.providers || [];
        setAccounts(Array.isArray(list) ? list : []);
      } else {
        setAccounts([]);
      }
      if (secRes?.ok) {
        const data = await secRes.json().catch(() => ({ data: { secrets: [] } }));
        const list = data?.data?.secrets || [];
        setSecrets(Array.isArray(list) ? list : []);
      } else {
        setSecrets([]);
      }
    } catch {
      setError('账户与密钥加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
      await fetchAll();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('密钥保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addCustomSecret = async () => {
    if (!newSecret.key.trim() || !newSecret.value.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/settings/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSecret),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`已保存密钥 ${newSecret.key}`);
      setNewSecret({ key: '', value: '', category: 'api_key', description: '' });
      setShowAddSecret(false);
      await fetchAll();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('密钥保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteSecret = async (key: string) => {
    if (!window.confirm(`确认删除密钥「${key}」？此操作不可撤销。`)) return;
    setDeletingKey(key);
    try {
      const res = await fetch(`/api/v1/settings/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAll();
    } catch {
      setMessage('密钥删除失败');
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setDeletingKey(null);
    }
  };

  if (loading) {
    return (
      <SettingsText as="p" tone="muted">
        加载中...
      </SettingsText>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {error && (
        <SettingsText as="p" tone="red">
          {error}
        </SettingsText>
      )}
      {message && (
        <SettingsText as="p" tone={message.includes('失败') ? 'red' : 'green'}>
          {message}
        </SettingsText>
      )}

      {/* Section 1: 模型 Provider 账户 */}
      <SettingsSection
        title="模型 Provider 账户"
        description="模型账户、凭据和执行身份的归属关系。"
        badge={
          <SettingsBadge tone="slate" size="xxs">
            {accounts.length}
          </SettingsBadge>
        }
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
                    <SettingsField
                      label="环境变量名"
                      hint={`写入 ${a.api_key_env || `${a.name.toUpperCase()}_API_KEY`} 到密钥存储`}
                    >
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

      {/* Section 2: 密钥库（复刻 clowder 账户配置的凭据管理区） */}
      <SettingsSection
        title="密钥库"
        description="集中管理 API Key、Token 等凭据（脱敏展示，按需删除）。"
        badge={
          <SettingsBadge tone="slate" size="xxs">
            {secrets.length}
          </SettingsBadge>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {secrets.length === 0 ? (
            <SettingsEmptyState
              icon={<ShieldCheck size={32} color="var(--muted)" />}
              title="暂无密钥"
              description="通过上方 Provider 配置密钥，或手动新增"
            />
          ) : (
            secrets.map((s) => (
              <SettingsRow
                key={s.key}
                icon={<ShieldCheck size={16} color="var(--accent)" />}
                title={s.key}
                meta={s.description}
                badges={
                  <>
                    <SettingsBadge tone="slate" size="xxs">
                      {s.category || 'api_key'}
                    </SettingsBadge>
                    <SettingsBadge tone={s.configured ? 'emerald' : 'amber'} size="xxs">
                      {s.configured ? '已配置' : '未配置'}
                    </SettingsBadge>
                  </>
                }
                actions={
                  <button
                    type="button"
                    disabled={deletingKey === s.key}
                    onClick={() => deleteSecret(s.key)}
                    title="删除密钥"
                    aria-label={`删除密钥 ${s.key}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--danger, #dc2626)',
                      cursor: deletingKey === s.key ? 'wait' : 'pointer',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                }
              />
            ))
          )}

          {showAddSecret ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
              }}
            >
              <SettingsField label="密钥名" hint="环境变量名，例如 FIGMA_TOKEN">
                <input
                  style={inputStyle}
                  value={newSecret.key}
                  placeholder="MY_TOKEN"
                  onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="密钥值">
                <input
                  type="password"
                  style={inputStyle}
                  value={newSecret.value}
                  placeholder="粘贴密钥值"
                  onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="分类" hint="api_key / token / webhook">
                <input
                  style={inputStyle}
                  value={newSecret.category}
                  onChange={(e) => setNewSecret({ ...newSecret, category: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="描述">
                <input
                  style={inputStyle}
                  value={newSecret.description}
                  placeholder="可选描述"
                  onChange={(e) => setNewSecret({ ...newSecret, description: e.target.value })}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton
                  onClick={addCustomSecret}
                  disabled={saving || !newSecret.key.trim() || !newSecret.value.trim()}
                >
                  {saving ? '保存中...' : '保存'}
                </SettingsPrimaryButton>
                <SettingsSecondaryButton onClick={() => setShowAddSecret(false)}>取消</SettingsSecondaryButton>
              </div>
            </div>
          ) : (
            <div>
              <SettingsSecondaryButton onClick={() => setShowAddSecret(true)}>新增密钥</SettingsSecondaryButton>
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
