import type { MouseEvent, ReactNode } from 'react';

type BadgeTone = 'emerald' | 'amber' | 'slate' | 'red' | 'purple' | 'blue';

const toneStyles: Record<BadgeTone, { bg: string; color: string }> = {
  emerald: { bg: 'var(--ok-subtle)', color: 'var(--ok)' },
  amber: { bg: 'var(--warn-subtle)', color: 'var(--warn)' },
  slate: { bg: 'var(--bg-hover)', color: 'var(--muted)' },
  red: { bg: 'var(--danger-subtle)', color: 'var(--danger)' },
  purple: { bg: 'var(--accent-2-subtle)', color: 'var(--accent-2)' },
  blue: { bg: 'color-mix(in srgb, var(--info) 12%, transparent)', color: 'var(--info)' },
};

interface SettingsBadgeProps {
  tone: BadgeTone;
  size?: 'xs' | 'xxs';
  as?: 'span' | 'button';
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
}

/**
 * SettingsBadge — 设置区状态徽标
 */
export function SettingsBadge({
  tone,
  size = 'xs',
  as = 'span',
  onClick,
  disabled,
  title,
  'aria-label': ariaLabel,
  children,
  className,
}: SettingsBadgeProps) {
  const styles = toneStyles[tone];
  const padding = size === 'xxs' ? '2px 6px' : '4px 10px';
  const fontSize = size === 'xxs' ? '10px' : '12px';

  const sharedStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 'var(--radius-full)',
    padding,
    fontSize,
    fontWeight: 600,
    background: styles.bg,
    color: styles.color,
    border: 'none',
    cursor: as === 'button' && !disabled ? 'pointer' : 'inherit',
    opacity: disabled ? 0.5 : 1,
  };

  if (as === 'button') {
    return (
      <button
        type="button"
        style={sharedStyle}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  return (
    <span style={sharedStyle} className={className} title={title}>
      {children}
    </span>
  );
}
