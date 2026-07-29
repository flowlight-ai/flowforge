import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * SettingsPillButton — 胶囊按钮（小尺寸描边按钮）
 */
export function SettingsPillButton({
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
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--border)',
        background: 'transparent',
        padding: '2px 8px',
        fontSize: '12px',
        color: 'var(--text)',
        cursor: 'pointer',
        transition: 'all var(--duration-normal) var(--ease-out)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
