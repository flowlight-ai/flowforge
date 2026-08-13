'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
  SettingsText,
} from '../primitives';

interface CapabilityProfile {
  id: string;
  label: string;
  model?: string | null;
  source: 'agent_registry' | 'mode_registry' | 'audit' | string;
  signals: string[];
  description?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  agent_registry: '智能体注册表',
  mode_registry: '模式注册表',
  audit: '审计派生',
};

const SOURCE_TONES: Record<string, 'blue' | 'emerald' | 'amber' | 'slate'> = {
  agent_registry: 'blue',
  mode_registry: 'emerald',
  audit: 'amber',
};

/**
 * ProfilesSection — 能力画像（复刻 clowder-ai CatDossierContent）
 *
 * 功能对齐：
 *   - 按模型（执行模式）分组的能力画像
 *   - 路由信号徽章（signals）与来源追溯（source）
 *   - 汇总条：画像总数与各来源计数
 *
 * 数据源：GET /api/v1/capability/profiles
 */
export function ProfilesSection() {
  const [items, setItems] = useState<CapabilityProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/capability/profiles?limit=200');
      if (!res.ok) {
        setError(`能力画像加载失败 (${res.status})`);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
    } catch {
      setError('能力画像加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // 按 model 分组（null/空 → 未分组）
  const groups = useMemo(() => {
    const map = new Map<string, CapabilityProfile[]>();
    for (const item of items) {
      const key = item.model || '未分组';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.source] = (counts[item.source] ?? 0) + 1;
    return counts;
  }, [items]);

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

      {/* 汇总条：总数 + 来源追溯计数 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}
      >
        <SettingsText as="span" tone="default" style={{ fontWeight: 700 }}>
          共 {total} 个画像
        </SettingsText>
        {Object.entries(sourceCounts).map(([source, count]) => (
          <SettingsBadge key={source} tone={SOURCE_TONES[source] ?? 'slate'} size="xxs">
            {SOURCE_LABELS[source] ?? source} × {count}
          </SettingsBadge>
        ))}
      </div>

      {items.length === 0 ? (
        <SettingsEmptyState title="暂无能力画像" description="注册智能体或执行任务后将自动生成画像" />
      ) : (
        groups.map(([model, profiles]) => (
          <SettingsSection
            key={model}
            title={model}
            description={model === '未分组' ? '未关联执行模式的辅助画像' : `以「${model}」为默认执行模式的画像`}
            badge={
              <SettingsBadge tone="slate" size="xxs">
                {profiles.length}
              </SettingsBadge>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {profiles.map((p) => (
                <SettingsRow
                  key={p.id}
                  icon={<Fingerprint size={16} color="var(--accent)" />}
                  title={p.label}
                  meta={p.description || p.id}
                  badges={
                    <>
                      <SettingsBadge tone={SOURCE_TONES[p.source] ?? 'slate'} size="xxs">
                        {SOURCE_LABELS[p.source] ?? p.source}
                      </SettingsBadge>
                      {p.signals.slice(0, 4).map((sig) => (
                        <SettingsBadge key={sig} tone="slate" size="xxs">
                          {sig}
                        </SettingsBadge>
                      ))}
                      {p.signals.length > 4 ? (
                        <SettingsBadge tone="slate" size="xxs">
                          +{p.signals.length - 4}
                        </SettingsBadge>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          </SettingsSection>
        ))
      )}
    </div>
  );
}
