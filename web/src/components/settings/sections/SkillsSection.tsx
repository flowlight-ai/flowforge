'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Zap } from 'lucide-react';
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

interface Skill {
  id: string;
  name: string;
  description?: string;
  version?: string;
  installed?: boolean;
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
 * SkillsSection — Skill 管理（可注册 Skill）
 *
 * 数据源：GET/POST /api/v1/skills。
 */
export function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', version: '0.1.0' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/skills').catch(() => null);
      if (!res || !res.ok) {
        setSkills([]);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] }));
      const list = data?.items || [];
      setSkills(Array.isArray(list) ? list.map((item: any) => ({
        id: item.id || item.name,
        name: item.name,
        description: item.description,
        version: item.version,
        installed: item.installed,
      })) : []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          version: form.version.trim() || '0.1.0',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('已注册 Skill');
      setForm({ name: '', description: '', version: '0.1.0' });
      setShowForm(false);
      await fetchSkills();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('注册失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SettingsText as="p" tone="muted">加载中...</SettingsText>;
  }

  return (
    <SettingsSection
      title="Skill 管理"
      description="技能市场、安装计划和本地能力预览。"
      badge={<SettingsBadge tone="slate" size="xxs">{skills.length}</SettingsBadge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!showForm && (
          <SettingsPrimaryButton onClick={() => setShowForm(true)} disabled={saving}>
            <Plus size={14} style={{ marginRight: 4 }} /> 注册 Skill
          </SettingsPrimaryButton>
        )}
        {showForm && (
          <SettingsRow icon={<Zap size={16} color="var(--accent-2)" />} title="注册自定义 Skill">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SettingsField label="名称">
                <input
                  style={inputStyle}
                  value={form.name}
                  placeholder="如 web_search"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="描述">
                <input
                  style={inputStyle}
                  value={form.description}
                  placeholder="技能用途说明"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="版本">
                <input
                  style={inputStyle}
                  value={form.version}
                  placeholder="0.1.0"
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
              </SettingsField>
              <div style={{ display: 'flex', gap: '8px' }}>
                <SettingsPrimaryButton onClick={submit} disabled={saving || !form.name.trim()}>
                  {saving ? '注册中...' : '确认注册'}
                </SettingsPrimaryButton>
                <SettingsHubLink title="取消" onClick={() => setShowForm(false)}>取消</SettingsHubLink>
              </div>
            </div>
          </SettingsRow>
        )}
        {message && <SettingsText as="span" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
        {skills.length === 0 ? (
          <SettingsEmptyState
            icon={<Zap size={32} color="var(--muted)" />}
            title="暂无 Skill"
            description="点击上方按钮注册 Skill，或配置 prompts.yaml / plugins.yaml 内置能力。"
          />
        ) : (
          skills.map((s) => (
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
          ))
        )}
      </div>
    </SettingsSection>
  );
}
