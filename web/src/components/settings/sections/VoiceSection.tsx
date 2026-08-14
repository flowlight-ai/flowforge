'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Mic } from 'lucide-react';
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

interface VoiceConfig {
  enabled: boolean;
  tts_provider: string | null;
  stt_provider: string | null;
  default_voice: string | null;
  language: string;
}

interface ServiceStatus {
  id: string;
  name: string;
  status?: string;
  message?: string;
}

const SERVICE_TONES: Record<string, 'emerald' | 'amber' | 'red' | 'slate'> = {
  healthy: 'emerald',
  degraded: 'amber',
  down: 'red',
};

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  tts_provider: null,
  stt_provider: null,
  default_voice: null,
  language: 'zh-CN',
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
 * VoiceSection — 语音管理（可编辑）
 *
 * 语音输入输出、TTS 服务配置。数据源：GET/PUT /api/v1/voice/config。
 */
export function VoiceSection() {
  const [config, setConfig] = useState<VoiceConfig>(DEFAULT_CONFIG);
  const [draft, setDraft] = useState<VoiceConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 服务状态面板（对齐 clowder-ai ServiceStatusPanel）
  const [services, setServices] = useState<ServiceStatus[]>([]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/voice/config').catch(() => null);
      if (!res || !res.ok) {
        setConfig(DEFAULT_CONFIG);
        setDraft(DEFAULT_CONFIG);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const cfg = data?.data || data;
      const merged = { ...DEFAULT_CONFIG, ...cfg } as VoiceConfig;
      setConfig(merged);
      setDraft(merged);
    } catch {
      setConfig(DEFAULT_CONFIG);
      setDraft(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/ops/services').catch(() => null);
      if (!res || !res.ok) {
        setServices([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setServices(Array.isArray(list) ? list.map((item: any, i: number) => ({
        id: item.id || `svc_${i}`,
        name: item.name || `服务 ${i + 1}`,
        status: item.status,
        message: item.message,
      })) : []);
    } catch {
      setServices([]);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchServices();
  }, [fetchConfig, fetchServices]);

  const saveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/voice/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          tts_provider: draft.tts_provider || null,
          stt_provider: draft.stt_provider || null,
          default_voice: draft.default_voice || null,
          language: draft.language,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const cfg = data?.data || data;
      setConfig({ ...DEFAULT_CONFIG, ...cfg } as VoiceConfig);
      setMessage('已保存');
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const patch = (partial: Partial<VoiceConfig>) => setDraft((d) => ({ ...d, ...partial }));

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
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
      title="语音服务"
      description="语音输入输出、术语表和 TTS 服务配置。"
      badge={<SettingsBadge tone={draft.enabled ? 'emerald' : 'slate'} size="xxs">{draft.enabled ? '已启用' : '已停用'}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <SettingsRow
          icon={<Mic size={16} color="var(--info)" />}
          title="启用语音"
          badges={draft.enabled ? <SettingsBadge tone="emerald" size="xxs">ON</SettingsBadge> : <SettingsBadge tone="slate" size="xxs">OFF</SettingsBadge>}
        >
          <SettingsField label="语音开关" hint="开启后群聊语音输入输出能力生效" inline compact>
            {switchButton}
          </SettingsField>
        </SettingsRow>

        <SettingsRow icon={<Mic size={16} color="var(--accent-2)" />} title="服务配置">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SettingsField label="TTS Provider" hint="文本转语音服务商（如 openai/edge）">
              <input
                style={inputStyle}
                value={draft.tts_provider ?? ''}
                placeholder="如 openai"
                onChange={(e) => patch({ tts_provider: e.target.value || null })}
              />
            </SettingsField>
            <SettingsField label="STT Provider" hint="语音转文本服务商（如 whisper）">
              <input
                style={inputStyle}
                value={draft.stt_provider ?? ''}
                placeholder="如 whisper"
                onChange={(e) => patch({ stt_provider: e.target.value || null })}
              />
            </SettingsField>
            <SettingsField label="默认音色" hint="TTS 使用的默认声音标识">
              <input
                style={inputStyle}
                value={draft.default_voice ?? ''}
                placeholder="如 alloy"
                onChange={(e) => patch({ default_voice: e.target.value || null })}
              />
            </SettingsField>
            <SettingsField label="语言" hint="语音识别与合成默认语言">
              <select
                style={inputStyle}
                value={draft.language}
                onChange={(e) => patch({ language: e.target.value })}
              >
                <option value="zh-CN">中文（zh-CN）</option>
                <option value="en-US">English（en-US）</option>
                <option value="ja-JP">日本語（ja-JP）</option>
                <option value="">自动检测</option>
              </select>
            </SettingsField>
          </div>
        </SettingsRow>

        {services.length > 0 && (
          <SettingsRow icon={<Activity size={16} color="var(--info)" />} title="服务运行状态">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {services.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <SettingsBadge tone={SERVICE_TONES[s.status || ''] || 'slate'} size="xxs">
                    {s.status || 'unknown'}
                  </SettingsBadge>
                  <SettingsText as="span" variant="xs">{s.name}</SettingsText>
                  {s.message && <SettingsText as="span" variant="xs" tone="muted">{s.message}</SettingsText>}
                </div>
              ))}
            </div>
          </SettingsRow>
        )}

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
