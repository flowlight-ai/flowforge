'use client';

import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { SettingsBadge, SettingsEmptyState, SettingsRow, SettingsSection, SettingsText } from '../primitives';

interface Skill {
  id: string;
  name: string;
  description?: string;
  version?: string;
  installed?: boolean;
}

/**
 * SkillsSection — Skill 管理
 *
 * 数据源：GET /api/v1/skills（如未实现则展示空状态）。
 */
export function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/skills').catch(() => null);
      if (!res || !res.ok) {
        setSkills([]);
        return;
      }
      const data = await res.json().catch(() => ({ data: { skills: [] } }));
      const list = data?.data?.skills || data?.skills || [];
      setSkills(Array.isArray(list) ? list : []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="Skill 管理"
      description="技能市场、安装计划和本地能力预览。"
      badge={<SettingsBadge tone="slate" size="xxs">{skills.length}</SettingsBadge>}
    >
      {skills.length === 0 ? (
        <SettingsEmptyState
          icon={<Zap size={32} color="var(--muted)" />}
          title="暂无 Skill"
          description="Skill 接口尚未返回数据，或未安装任何技能。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {skills.map((s) => (
            <SettingsRow
              key={s.id}
              icon={<Zap size={16} color="var(--accent-2)" />}
              title={s.name}
              meta={s.description}
              badges={
                <>
                  {s.version && <SettingsBadge tone="slate" size="xxs">v{s.version}</SettingsBadge>}
                  {s.installed !== undefined && (
                    <SettingsBadge tone={s.installed ? 'emerald' : 'amber'} size="xxs">
                      {s.installed ? '已安装' : '未安装'}
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
