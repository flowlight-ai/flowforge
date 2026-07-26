'use client';

import type { ComponentType, MouseEvent } from 'react';
import {
  Activity,
  Bell,
  Box,
  FileText,
  Key,
  Mic,
  Plug,
  Puzzle,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Users,
  Zap,
  type LucideProps,
} from 'lucide-react';
import {
  DEFAULT_SECTION,
  SECTION_KEYWORDS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-nav-config';

interface SettingsNavProps {
  activeSection: string;
  onSelect: (sectionId: string) => void;
  searchQuery?: string;
}

/** icon 名 → lucide-react 组件映射 */
const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  users: Users,
  'file-text': FileText,
  key: Key,
  plug: Plug,
  zap: Zap,
  box: Box,
  puzzle: Puzzle,
  search: Search,
  bell: Bell,
  mic: Mic,
  settings: SettingsIcon,
  'scroll-text': ScrollText,
  activity: Activity,
};

function NavItem({
  section,
  active,
  onSelect,
}: {
  section: SettingsSection;
  active: boolean;
  onSelect: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = ICON_MAP[section.icon] ?? SettingsIcon;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-settings-nav={section.id}
      data-active={active ? 'true' : 'false'}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: '8px',
        borderRadius: 'var(--radius-sm)',
        padding: '0 10px',
        height: '36px',
        textAlign: 'left',
        border: 'none',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text)',
        fontSize: '13px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'all var(--duration-normal) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ flexShrink: 0, display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--muted)' }}>
        <Icon size={16} />
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: active ? 'var(--text-strong)' : 'var(--text)',
        }}
      >
        {section.label}
      </span>
    </button>
  );
}

/**
 * SettingsNav — 左侧 14 section 导航
 *
 * 从 clowder-ai 移植并简化：
 *   - 移除 usePinnedSections（FlowForge 未提供此 hook）
 *   - 移除 HubIcon，改用 lucide-react
 *   - 保留搜索过滤（基于 SECTION_KEYWORDS）
 *   - 添加 data-settings-nav 标记（T8 测试用）
 */
export function SettingsNav({ activeSection, onSelect, searchQuery }: SettingsNavProps) {
  const q = searchQuery?.toLowerCase().trim() ?? '';
  const filtered = q
    ? SETTINGS_SECTIONS.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (SECTION_KEYWORDS[s.id] ?? '').toLowerCase().includes(q),
      )
    : SETTINGS_SECTIONS;

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }} aria-label="设置导航">
      {filtered.length === 0 && q ? (
        <p
          style={{
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-elevated)',
            padding: '12px 16px',
            fontSize: '12px',
            color: 'var(--muted)',
            margin: 0,
            border: '1px solid var(--border)',
          }}
        >
          没有匹配的设置分区
        </p>
      ) : (
        filtered.map((section) => (
          <NavItem
            key={section.id}
            section={section}
            active={section.id === activeSection}
            onSelect={() => onSelect(section.id)}
          />
        ))
      )}
    </nav>
  );
}

export { DEFAULT_SECTION, SETTINGS_SECTIONS };
export type { SettingsSection };
