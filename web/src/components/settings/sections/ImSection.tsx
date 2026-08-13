'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug, Plus } from 'lucide-react';
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

interface ImConnector {
  id: string;
  name: string;
  platform?: string;
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
 * ImSection — IM 对接（可新增连接器）
 *
 * 合并 /admin/im。数据源：GET/POST /api/v1/connectors。
 */
export function ImSection() {
  const [connectors, setConnectors] = useState<ImConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'webhook', config: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/connectors').catch(() => null);
      if (!res || !res.ok) {
        setConnectors([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setConnectors(Array.isArray(list) ? list.map((item: any) => ({
        id: item.id,
        name: item.name,
        platform: item.platform,
        configured: item.configured,
      })) : []);
    } catch {
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setMessage(null);
    let config: Record<string, unknown> = {};
    try {
      config = form.config.trim() ? JSON.parse(form.config) : {};
    } catch {
      setMessage('配置 JSON 格式错误');
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), type: form.type, config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已添加连接器');
      setForm({ name: '', type: 'webhook', config: '' });
      setShowForm(false);
      await fetchConnectors();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('添加失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="IM 对接"
      description="飞书、钉钉、企微和外部消息入口。"
      badge={<SettingsBadge tone="slate" size="xxs">{connectors.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!showForm && (
          <SettingsPrimaryButton onClick={() => setShowForm(true)} disabled={saving}>
            <Plus size={14} style={{ marginRight: 4 }} /> 添加连接器
          </SettingsPrimaryButton>
        )}
        {showForm && (
          <SettingsRow icon={<Plug size={16} color="var(--accent-2)" />} title="添加 IM 连接器">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SettingsField label="名称">
                <input
                  style={inputStyle}
                  value={form.name}
                  placeholder="如 飞书测试群"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="类型">
                <select
                  style={inputStyle}
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="webhook">webhook</option>
                  <option value="feishu">feishu</option>
                  <option value="dingtalk">dingtalk</option>
                  <option value="wecom">wecom</option>
                </select>
              </SettingsField>
              <SettingsField label="配置（JSON）" hint='如 {"webhook_url": "..."}'>
                <input
                  style={inputStyle}
                  value={form.config}
                  placeholder={'{"webhook_url": "https://..."}'}
                  onChange={(e) => setForm({ ...form, config: e.target.value })}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton onClick={submit} disabled={saving || !form.name.trim()}>
                  {saving ? '提交中...' : '确认添加'}
                </SettingsPrimaryButton>
                <SettingsHubLink title="取消" onClick={() => setShowForm(false)}>取消</SettingsHubLink>
              </div>
            </div>
          </SettingsRow>
        )}
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') || message.includes('错误') ? 'red' : 'muted'}>{message}</SettingsText>}
        {connectors.length === 0 ? (
          <SettingsEmptyState
            icon={<Plug size={32} color="var(--muted)" />}
            title="暂无 IM 连接器"
            description="点击上方按钮添加入口，或配置 im_channels.yaml 内置渠道。"
          />
        ) : (
          connectors.map((c) => (
            <SettingsRow
              key={c.id}
              icon={<Plug size={16} color="var(--accent-2)" />}
              title={c.name}
              meta={c.platform}
              badges={
                c.configured !== undefined ? (
                  <SettingsBadge tone={c.configured ? 'emerald' : 'amber'} size="xxs">
                    {c.configured ? '已连接' : '未连接'}
                  </SettingsBadge>
                ) : null
              }
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
