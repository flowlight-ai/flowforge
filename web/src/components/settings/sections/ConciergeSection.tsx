'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface ConciergeConfig {
  enabled: boolean;
  greeting: string;
  default_forgekin: string | null;
  preferences: Record<string, unknown>;
}

const DEFAULT_CONFIG: ConciergeConfig = {
  enabled: false,
  greeting: '',
  default_forgekin: null,
  preferences: {},
};

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
 * ConciergeSection — 管家配置（可编辑）
 *
 * 管家形象、人设、值班策略和主动性配置。数据源：GET/PUT /api/v1/concierge/config。
 */
export function ConciergeSection() {
  const [config, setConfig] = useState<ConciergeConfig>(DEFAULT_CONFIG);
  const [draft, setDraft] = useState<ConciergeConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/concierge/config').catch(() => null);
      if (!res || !res.ok) {
        setConfig(DEFAULT_CONFIG);
        setDraft(DEFAULT_CONFIG);
        return;
      }
      const data = await res.json().catch(() => ({ data: { config: {} } }));
      const cfg = data?.data?.config || data?.config || {};
      const merged = { ...DEFAULT_CONFIG, ...cfg } as ConciergeConfig;
      setConfig(merged);
      setDraft(merged);
    } catch {
      setConfig(DEFAULT_CONFIG);
      setDraft(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/concierge/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          greeting: draft.greeting,
          default_forgekin: draft.default_forgekin || null,
          preferences: draft.preferences,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const cfg = data?.data?.config || data?.config || data;
      setConfig({ ...DEFAULT_CONFIG, ...cfg } as ConciergeConfig);
      setMessage('已保存');
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const patch = (partial: Partial<ConciergeConfig>) => setDraft((d) => ({ ...d, ...partial }));

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }
  if (!config) {
    return (
      <SettingsEmptyState
        icon={<Bell size={32} color="var(--muted)" />}
        title="管家未配置"
        description="管家配置接口尚未返回数据。"
      />
    );
  }

  const switchButton = (
    <button
      type="button"
      role="switch"
      aria-checked={draft.enabled}
      onClick={() => patch({ enabled: !draft.enabled })}
      style={{
        position: 'relative',
        width: 40,
        height: 22,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background: draft.enabled ? 'var(--accent)' : 'var(--border-strong)',
        transition: 'background var(--duration-normal) var(--ease-out)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: draft.enabled ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: '#fff',
          transition: 'left var(--duration-normal) var(--ease-out)',
        }}
      />
    </button>
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <SettingsSection
      title="管家配置"
      description="管家形象、人设、值班策略和主动性配置。"
      badge={
        <SettingsBadge tone={draft.enabled ? 'emerald' : 'slate'} size="xxs">
          {draft.enabled ? '已启用' : '已停用'}
        </SettingsBadge>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <SettingsRow
          icon={<Bell size={16} color="var(--accent-2)" />}
          title="启用状态"
          badges={<SettingsBadge tone={draft.enabled ? 'emerald' : 'slate'} size="xxs">{draft.enabled ? 'ON' : 'OFF'}</SettingsBadge>}
        >
          <SettingsField label="管家开关" hint="开启后管家在群聊中值守" inline compact>
            {switchButton}
          </SettingsField>
        </SettingsRow>

        <SettingsRow icon={<Bell size={16} color="var(--accent-2)" />} title="形象与策略">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SettingsField label="问候语" hint="管家进入群聊时的自动问候">
              <input
                style={inputStyle}
                value={draft.greeting}
                placeholder="如：大家好，我是管家…"
                onChange={(e) => patch({ greeting: e.target.value })}
              />
            </SettingsField>
            <SettingsField label="默认值守 Forgekin" hint="默认响应消息的 Forgekin ID">
              <input
                style={inputStyle}
                value={draft.default_forgekin ?? ''}
                placeholder="如 forgekin:council"
                onChange={(e) => patch({ default_forgekin: e.target.value || null })}
              />
            </SettingsField>
          </div>
        </SettingsRow>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <SettingsPrimaryButton onClick={saveConfig} disabled={saving || !dirty}>
            {saving ? '保存中...' : '保存配置'}
          </SettingsPrimaryButton>
          <SettingsSecondaryButton onClick={() => setDraft(config)} disabled={saving || !dirty}>
            重置
          </SettingsSecondaryButton>
          {message && <SettingsText as="span" variant="xs" tone={message === '已保存' ? 'muted' : 'red'}>{message}</SettingsText>}
        </div>
      </div>
    </SettingsSection>
  );
}
