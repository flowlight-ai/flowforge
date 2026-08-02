import type { ReactNode } from 'react';

interface SettingsPrimaryButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  'data-guide-id'?: string;
  'data-bootcamp-step'?: string;
}

/**
 * SettingsPrimaryButton — 主要操作按钮（强调色背景）
 */
export function SettingsPrimaryButton({ onClick, disabled, children, ...rest }: SettingsPrimaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        borderRadius: 'var(--radius-full)',
        padding: '6px 16px',
        background: 'var(--accent)',
        color: 'var(--accent-foreground)',
        border: 'none',
        fontSize: '12px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--duration-normal) var(--ease-out)',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
