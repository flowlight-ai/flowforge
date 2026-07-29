import type { ReactNode } from 'react';

interface SettingsInlineItemProps {
  children: ReactNode;
  className?: string;
}

/**
 * SettingsInlineItem — 行内项容器（用于在卡片内嵌入键值对）
 */
export function SettingsInlineItem({ children, className }: SettingsInlineItemProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: '8px 12px',
      }}
    >
      {children}
    </div>
  );
}
