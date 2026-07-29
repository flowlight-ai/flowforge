'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSecondaryButton,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface PromptItem {
  key: string;
  template?: string;
}

/**
 * RulesSection — 协作与规则
 *
 * 保留旧版 /admin/settings 的提示词模板管理功能。
 * 数据源：
 *   - GET /api/v1/prompts（列表）
 *   - GET /api/v1/prompts/{key}（详情）
 *   - PUT /api/v1/prompts/{key}（保存）
 *   - POST /api/v1/prompts/reload（重载）
 */
export function RulesSection() {
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<PromptItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch('/api/v1/prompts').then((r) => r.json()).catch(() => ({ data: { keys: [] } }));
      setKeys(data?.data?.keys || []);
    } catch {
      setError('提示词列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleSelect = useCallback(async (key: string) => {
    try {
      const data = await fetch(`/api/v1/prompts/${encodeURIComponent(key)}`).then((r) => r.json());
      const item: PromptItem = { key, template: data?.data?.template || '' };
      setSelected(item);
      setEditValue(item.template || '');
    } catch {
      setSelected({ key, template: '' });
      setEditValue('');
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/v1/prompts/${encodeURIComponent(selected.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: editValue }),
      });
      setSelected((prev) => (prev ? { ...prev, template: editValue } : null));
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }, [selected, editValue]);

  const handleReload = useCallback(async () => {
    try {
      await fetch('/api/v1/prompts/reload', { method: 'POST' });
      await fetchKeys();
    } catch {
      setError('重载失败');
    }
  }, [fetchKeys]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (error) {
    return <SettingsText as="p" tone="red">{error}</SettingsText>;
  }

  return (
    <SettingsSection
      title="协作与规则"
      description="提示词模板、会话生命周期、协作规则与模型指南。"
      badge={<SettingsBadge tone="slate" size="xxs">{keys.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <SettingsSecondaryButton onClick={handleReload}>🔄 重新加载</SettingsSecondaryButton>
      </div>

      <div style={{ display: 'flex', gap: '16px', minHeight: '400px' }}>
        <div
          style={{
            width: '240px',
            minWidth: '200px',
            borderRight: '1px solid var(--border)',
            paddingRight: '12px',
            overflowY: 'auto',
            maxHeight: '500px',
          }}
        >
          {keys.length === 0 ? (
            <SettingsEmptyState title="暂无提示词" />
          ) : (
            keys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleSelect(key)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: selected?.key === key ? 'var(--accent-subtle)' : 'transparent',
                  color: selected?.key === key ? 'var(--accent)' : 'var(--text)',
                  fontSize: '12px',
                  fontWeight: selected?.key === key ? 600 : 400,
                  textAlign: 'left',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {key}
              </button>
            ))
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selected ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <SettingsText as="span" variant="sm" tone="default">
                  <ScrollText size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  {selected.key}
                </SettingsText>
                <SettingsPrimaryButton onClick={handleSave} disabled={saving}>
                  {saving ? '保存中...' : '💾 保存'}
                </SettingsPrimaryButton>
              </div>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '360px',
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-strong)',
                  fontSize: '12px',
                  fontFamily: 'var(--mono)',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
                color: 'var(--muted)',
                fontSize: '13px',
              }}
            >
              ← 从左侧选择一个提示词模板进行编辑
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
