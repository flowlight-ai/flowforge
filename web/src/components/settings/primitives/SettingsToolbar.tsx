import type { ReactNode } from 'react';

interface SettingsToolbarProps {
  children: ReactNode;
}

/**
 * SettingsToolbar — 工具栏容器（响应式：sm 以下纵向，以上横向）
 */
export function SettingsToolbar({ children }: SettingsToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg)',
        padding: '12px',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </div>
  );
}

interface SettingsSearchInputProps {
  icon?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/**
 * SettingsSearchInput — 搜索输入框（带图标）
 */
export function SettingsSearchInput({ icon, value, onChange, placeholder }: SettingsSearchInputProps) {
  return (
    <label
      style={{
        display: 'flex',
        minWidth: '220px',
        alignItems: 'center',
        gap: '8px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'transparent',
        padding: '8px 12px',
        fontSize: '12px',
        color: 'var(--muted)',
      }}
    >
      {icon}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          minWidth: 0,
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: '12px',
        }}
      />
    </label>
  );
}
