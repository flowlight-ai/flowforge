import type { CSSProperties, MouseEvent, ReactNode } from 'react';

interface SettingsHubLinkProps {
  onClick: (e: MouseEvent) => void;
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * SettingsHubLink — Hub 跳转链接（用于在设置区内跳转到详情页）
 */
export function SettingsHubLink({ onClick, title, children, style }: SettingsHubLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        flexShrink: 0,
        fontSize: '12px',
        color: 'var(--info)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        padding: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
