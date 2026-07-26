import type { ReactNode } from 'react';
import { SettingsBadge } from './SettingsBadge';
import { SettingsText } from './SettingsText';

interface SettingsCollapsibleCardProps {
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * SettingsCollapsibleCard — 可折叠卡片（标题 + 计数 + 折叠按钮）
 */
export function SettingsCollapsibleCard({ title, count, collapsed, onToggle, children }: SettingsCollapsibleCardProps) {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <SettingsText variant="xs" tone="muted">
          ▾
        </SettingsText>
        <SettingsText variant="sm" tone="default">
          {title}
        </SettingsText>
        {count !== undefined && (
          <SettingsBadge tone="slate" size="xxs">
            {count}
          </SettingsBadge>
        )}
      </button>
      {!collapsed && <div style={{ padding: '0 16px 12px' }}>{children}</div>}
    </div>
  );
}

interface SettingsCardSubSectionProps {
  label?: string;
  children: ReactNode;
}

/**
 * SettingsCardSubSection — 卡片子分区（带可选标签）
 */
export function SettingsCardSubSection({ label, children }: SettingsCardSubSectionProps) {
  return (
    <div style={{ padding: '8px 16px 12px' }}>
      {label && (
        <SettingsText variant="micro" tone="muted">
          {label}
        </SettingsText>
      )}
      {children}
    </div>
  );
}
