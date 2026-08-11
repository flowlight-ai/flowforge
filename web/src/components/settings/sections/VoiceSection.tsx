'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface VoiceService {
  id: string;
  name: string;
  type?: 'tts' | 'stt' | 'translate';
  enabled?: boolean;
  language?: string;
}

/**
 * VoiceSection — 语音管理
 *
 * 语音输入输出、术语表和 TTS 服务状态。
 * 数据源：GET /api/v1/voice/config。
 */
export function VoiceSection() {
  const [services, setServices] = useState<VoiceService[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/voice/config').catch(() => null);
      if (!res || !res.ok) {
        setServices([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      // 将单个配置对象转换为服务列表格式
      const cfg = data?.data || data;
      if (cfg && typeof cfg === 'object') {
        const list: VoiceService[] = [];
        if (cfg.tts_provider) {
          list.push({ id: 'tts', name: `TTS: ${cfg.tts_provider}`, type: 'tts', enabled: cfg.enabled, language: cfg.language });
        }
        if (cfg.stt_provider) {
          list.push({ id: 'stt', name: `STT: ${cfg.stt_provider}`, type: 'stt', enabled: cfg.enabled, language: cfg.language });
        }
        setServices(list);
      } else {
        setServices([]);
      }
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="语音服务"
      description="语音输入输出、术语表和 TTS 服务状态。"
      badge={<SettingsBadge tone="slate" size="xxs">{services.length}</SettingsBadge>}
    >
      {services.length === 0 ? (
        <SettingsEmptyState
          icon={<Mic size={32} color="var(--muted)" />}
          title="暂无语音服务"
          description="语音服务接口尚未返回数据，或未配置语音能力。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {services.map((s) => (
            <SettingsRow
              key={s.id}
              icon={<Mic size={16} color="var(--info)" />}
              title={s.name}
              meta={s.language}
              badges={
                <>
                  {s.type && <SettingsBadge tone="blue" size="xxs">{s.type.toUpperCase()}</SettingsBadge>}
                  {s.enabled !== undefined && (
                    <SettingsBadge tone={s.enabled ? 'emerald' : 'slate'} size="xxs">
                      {s.enabled ? '启用' : '禁用'}
                    </SettingsBadge>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
