import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * SettingsIconButton — 通用图标按钮（26x26）
 */
export function SettingsIconButton({
  children,
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: 'transparent',
        color: 'var(--muted)',
        cursor: 'pointer',
        transition: 'all var(--duration-normal) var(--ease-out)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
