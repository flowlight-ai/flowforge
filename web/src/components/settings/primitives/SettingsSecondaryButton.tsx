import type { ReactNode } from 'react';

interface SettingsSecondaryButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * SettingsSecondaryButton — 次要操作按钮（描边样式）
 */
export function SettingsSecondaryButton({ onClick, disabled, children }: SettingsSecondaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        borderRadius: 'var(--radius-full)',
        padding: '6px 16px',
        background: 'var(--bg-elevated)',
        color: 'var(--text-strong)',
        border: '1px solid var(--border-strong)',
        fontSize: '12px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--duration-normal) var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}
