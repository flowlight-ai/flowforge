'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Plus } from 'lucide-react';
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

interface NotifyChannel {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  target?: string;
  events?: string[];
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
 * NotifySection — 通知（可新增订阅）
 *
 * 合并 /admin/notify。数据源：GET/POST /api/v1/notify/subscriptions。
 */
export function NotifySection() {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ channel: 'webhook', target: '', events: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/notify/subscriptions').catch(() => null);
      if (!res || !res.ok) {
        setChannels([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setChannels(Array.isArray(list) ? list.map((item: any, i: number) => ({
        id: item.id || `sub_${i}`,
        name: item.channel || item.target || `渠道 ${i + 1}`,
        type: item.channel,
        enabled: item.status === 'active',
        target: item.target,
        events: Array.isArray(item.events) ? item.events : [],
      })) : []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const submit = async () => {
    if (!form.target.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/notify/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          target: form.target.trim(),
          events: form.events.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已新增订阅');
      setForm({ channel: 'webhook', target: '', events: '' });
      setShowForm(false);
      await fetchChannels();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('新增失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/notify/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已删除订阅');
      await fetchChannels();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('删除失败（内置订阅不可删除）');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="通知渠道"
      description="推送订阅、提醒策略与设备联动。"
      badge={<SettingsBadge tone="slate" size="xxs">{channels.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!showForm && (
          <SettingsPrimaryButton onClick={() => setShowForm(true)} disabled={saving}>
            <Plus size={14} style={{ marginRight: 4 }} /> 新增订阅
          </SettingsPrimaryButton>
        )}
        {showForm && (
          <SettingsRow icon={<Bell size={16} color="var(--accent-2)" />} title="新增通知订阅">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SettingsField label="渠道">
                <select
                  style={inputStyle}
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value })}
                >
                  <option value="webhook">webhook</option>
                  <option value="email">email</option>
                  <option value="feishu">feishu</option>
                  <option value="web">web</option>
                </select>
              </SettingsField>
              <SettingsField label="目标地址" hint="webhook URL / 邮箱 / 群 ID">
                <input
                  style={inputStyle}
                  value={form.target}
                  placeholder="如 https://hooks.example.com/xxx"
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="事件" hint="逗号分隔，如 task.failed,review.ready">
                <input
                  style={inputStyle}
                  value={form.events}
                  placeholder="如 task.failed,review.ready"
                  onChange={(e) => setForm({ ...form, events: e.target.value })}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton onClick={submit} disabled={saving || !form.target.trim()}>
                  {saving ? '提交中...' : '确认新增'}
                </SettingsPrimaryButton>
                <SettingsHubLink title="取消" onClick={() => setShowForm(false)}>取消</SettingsHubLink>
              </div>
            </div>
          </SettingsRow>
        )}
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
        {channels.length === 0 ? (
          <SettingsEmptyState
            icon={<Bell size={32} color="var(--muted)" />}
            title="暂无通知渠道"
            description="点击上方按钮新增订阅，或配置 yaml 内置渠道。"
          />
        ) : (
          channels.map((c) => (
            <SettingsRow
              key={c.id}
              icon={<Bell size={16} color="var(--info)" />}
              title={c.name}
              meta={c.target}
              badges={
                <>
                  {c.type && <SettingsBadge tone="blue" size="xxs">{c.type}</SettingsBadge>}
                  {c.events && c.events.length > 0 && (
                    <SettingsBadge tone="purple" size="xxs">{c.events.length} 事件</SettingsBadge>
                  )}
                  {c.enabled !== undefined && (
                    <SettingsBadge tone={c.enabled ? 'emerald' : 'slate'} size="xxs">
                      {c.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
              actions={
                <SettingsHubLink
                  title={`删除订阅 ${c.name}`}
                  onClick={() => remove(c.id)}
                  style={busy === c.id ? { opacity: 0.5 } : undefined}
                >
                  {busy === c.id ? '删除中...' : '删除'}
                </SettingsHubLink>
              }
            />
          ))
        )}
      </div>
    </SettingsSection>
  );
}
