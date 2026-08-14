'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, ScrollText } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsFilterTabs,
  SettingsHubLink,
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

type RuleTab = 'all' | 'lifecycle' | 'rules';

/** 对齐 clowder-ai RulesPromptsContent 的双 tab 分类：生命周期注入 / Agent 规则 */
const LIFECYCLE_KEYWORDS = ['lifecycle', 'session', 'hook', 'greeting', 'boot', 'shutdown', 'init'];
const RULE_KEYWORDS = ['rule', 'policy', 'guideline', 'collab', 'conflict', 'review', 'approval'];

function classifyKey(key: string): 'lifecycle' | 'rules' | 'other' {
  const lower = key.toLowerCase();
  if (LIFECYCLE_KEYWORDS.some((k) => lower.includes(k))) return 'lifecycle';
  if (RULE_KEYWORDS.some((k) => lower.includes(k))) return 'rules';
  return 'other';
}

/**
 * RulesSection — 协作与规则（对齐 clowder-ai RulesPromptsContent）
 *
 * 双分类 tab（生命周期注入 / Agent 规则）+ 模板编辑 + 预览弹窗。
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
  // 分类 tab 与预览弹窗
  const [tab, setTab] = useState<RuleTab>('all');
  const [preview, setPreview] = useState<PromptItem | null>(null);

  const filteredKeys = useMemo(() => {
    if (tab === 'all') return keys;
    return keys.filter((k) => classifyKey(k) === tab);
  }, [keys, tab]);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }}>
        <SettingsFilterTabs
          tabs={[
            { key: 'all', label: `全部 (${keys.length})` },
            { key: 'lifecycle', label: `生命周期注入 (${keys.filter((k) => classifyKey(k) === 'lifecycle').length})` },
            { key: 'rules', label: `Agent 规则 (${keys.filter((k) => classifyKey(k) === 'rules').length})` },
          ]}
          activeKey={tab}
          onTabChange={(k) => setTab(k as RuleTab)}
        />
        <SettingsSecondaryButton onClick={handleReload}>🔄 重新加载</SettingsSecondaryButton>
      </div>

      {/* 预览弹窗（对齐 clowder-ai RulePreviewModal） */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SettingsText as="span" variant="sm" tone="default">
                <Eye size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                预览：{preview.key}
              </SettingsText>
              <SettingsHubLink title="关闭预览" onClick={() => setPreview(null)}>关闭</SettingsHubLink>
            </div>
            <pre
              style={{
                margin: 0,
                flex: 1,
                overflow: 'auto',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-strong)',
                fontSize: '12px',
                fontFamily: 'var(--mono)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {preview.template || '（空模板）'}
            </pre>
          </div>
        </div>
      )}

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
          {filteredKeys.length === 0 ? (
            <SettingsEmptyState title="暂无提示词" />
          ) : (
            filteredKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleSelect(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
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
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{key}</span>
                {classifyKey(key) !== 'other' && (
                  <SettingsBadge tone={classifyKey(key) === 'lifecycle' ? 'blue' : 'purple'} size="xxs">
                    {classifyKey(key) === 'lifecycle' ? '周期' : '规则'}
                  </SettingsBadge>
                )}
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <SettingsHubLink
                    title="预览当前模板（含未保存修改）"
                    onClick={() => setPreview({ key: selected.key, template: editValue })}
                  >
                    <Eye size={12} style={{ marginRight: 4 }} /> 预览
                  </SettingsHubLink>
                  <SettingsPrimaryButton onClick={handleSave} disabled={saving}>
                    {saving ? '保存中...' : '💾 保存'}
                  </SettingsPrimaryButton>
                </div>
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
