'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Palette, User, Cat, Radio, Ruler, MapPin } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsField,
  SettingsHubLink,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface ConciergeConfig {
  enabled: boolean;
  muted: boolean;
  greeting: string;
  display_name: string;
  persona_tone: string;
  skin: string;
  proactive_policy: string;
  ball_size: number;
  ball_position: { x: number; y: number } | null;
  default_forgekin: string | null;
  preferences: Record<string, unknown>;
}

const DEFAULT_CONFIG: ConciergeConfig = {
  enabled: false,
  muted: false,
  greeting: '',
  display_name: '小烽',
  persona_tone: '',
  skin: 'forgekin-v1',
  proactive_policy: 'quiet-badge',
  ball_size: 72,
  ball_position: null,
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

/** 开关按钮（与 VoiceSection 同款） */
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 40,
        height: 22,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'var(--border-strong)',
        transition: 'background var(--duration-normal) var(--ease-out)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: '#fff',
          transition: 'left var(--duration-normal) var(--ease-out)',
        }}
      />
    </button>
  );
}

/**
 * ConciergeSection — 管家配置（对齐 clowder-ai ConciergeSettingsContent 七段结构）
 *
 * 1) 基本开关（enabled/muted）2) 皮肤 3) 身份人设 4) 值班猫
 * 5) 主动性策略 6) 球大小 7) 球位置。
 * 数据源：GET/PUT /api/v1/concierge/config。
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
          muted: draft.muted,
          greeting: draft.greeting,
          display_name: draft.display_name,
          persona_tone: draft.persona_tone,
          skin: draft.skin,
          proactive_policy: draft.proactive_policy,
          ball_size: draft.ball_size,
          ball_position: draft.ball_position,
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
        {/* 1. 基本开关 */}
        <SettingsRow
          icon={<Bell size={16} color="var(--accent-2)" />}
          title="基本开关"
          badges={<SettingsBadge tone={draft.enabled ? 'emerald' : 'slate'} size="xxs">{draft.enabled ? 'ON' : 'OFF'}</SettingsBadge>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SettingsField label="管家开关" hint="开启后管家在群聊中值守" inline compact>
              <Switch checked={draft.enabled} onChange={(v) => patch({ enabled: v })} />
            </SettingsField>
            <SettingsField label="静音模式" hint="开启后管家不主动发声，仅展示徽标" inline compact>
              <Switch checked={draft.muted} onChange={(v) => patch({ muted: v })} />
            </SettingsField>
          </div>
        </SettingsRow>

        {/* 2. 皮肤 */}
        <SettingsRow icon={<Palette size={16} color="var(--accent)" />} title="皮肤外观">
          <SettingsField label="皮肤" hint="管家球体外观主题">
            <select
              style={inputStyle}
              value={draft.skin}
              onChange={(e) => patch({ skin: e.target.value })}
            >
              <option value="forgekin-v1">forgekin-v1（默认）</option>
              <option value="forgekin-v2">forgekin-v2</option>
              <option value="minimal">minimal</option>
            </select>
          </SettingsField>
        </SettingsRow>

        {/* 3. 身份人设 */}
        <SettingsRow icon={<User size={16} color="var(--info)" />} title="身份与人设">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SettingsField label="显示名称">
              <input
                style={inputStyle}
                value={draft.display_name}
                placeholder="如 小烽"
                onChange={(e) => patch({ display_name: e.target.value })}
              />
            </SettingsField>
            <SettingsField label="人设语气" hint="如：沉稳、活泼、干练">
              <input
                style={inputStyle}
                value={draft.persona_tone}
                placeholder="如：沉稳专业"
                onChange={(e) => patch({ persona_tone: e.target.value })}
              />
            </SettingsField>
            <SettingsField label="问候语" hint="管家进入群聊时的自动问候">
              <input
                style={inputStyle}
                value={draft.greeting}
                placeholder="如：大家好，我是管家…"
                onChange={(e) => patch({ greeting: e.target.value })}
              />
            </SettingsField>
          </div>
        </SettingsRow>

        {/* 4. 值班猫 */}
        <SettingsRow icon={<Cat size={16} color="var(--accent-2)" />} title="值班猫">
          <SettingsField label="默认值守 Forgekin" hint="默认响应消息的 Forgekin ID">
            <input
              style={inputStyle}
              value={draft.default_forgekin ?? ''}
              placeholder="如 forgekin:council"
              onChange={(e) => patch({ default_forgekin: e.target.value || null })}
            />
          </SettingsField>
        </SettingsRow>

        {/* 5. 主动性策略 */}
        <SettingsRow icon={<Radio size={16} color="var(--accent)" />} title="主动性策略">
          <SettingsField label="主动模式" hint="ambient：环境音主动播报；quiet-badge：仅安静徽标提示">
            <select
              style={inputStyle}
              value={draft.proactive_policy}
              onChange={(e) => patch({ proactive_policy: e.target.value })}
            >
              <option value="ambient">ambient（主动播报）</option>
              <option value="quiet-badge">quiet-badge（安静徽标）</option>
            </select>
          </SettingsField>
        </SettingsRow>

        {/* 6. 球大小 */}
        <SettingsRow icon={<Ruler size={16} color="var(--info)" />} title="悬浮球大小">
          <SettingsField label="球体直径（px）" hint="范围 32 - 200">
            <input
              style={inputStyle}
              type="number"
              min={32}
              max={200}
              value={draft.ball_size}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) patch({ ball_size: Math.min(200, Math.max(32, v)) });
              }}
            />
          </SettingsField>
        </SettingsRow>

        {/* 7. 球位置 */}
        <SettingsRow icon={<MapPin size={16} color="var(--accent-2)" />} title="悬浮球位置">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {draft.ball_position ? (
              <SettingsText as="p" variant="xs" tone="muted">
                当前位置：x={draft.ball_position.x.toFixed(3)} · y={draft.ball_position.y.toFixed(3)}（归一化坐标）
              </SettingsText>
            ) : (
              <SettingsText as="p" variant="xs" tone="muted">默认位置（跟随系统布局）</SettingsText>
            )}
            <SettingsHubLink title="重置球位置为默认" onClick={() => patch({ ball_position: null })}>
              重置为默认位置
            </SettingsHubLink>
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
