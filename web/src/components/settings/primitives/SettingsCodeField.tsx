import type { InputHTMLAttributes, ReactNode } from 'react';

const formInputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-strong)',
  padding: '8px 12px',
  fontSize: '13px',
  outline: 'none',
};

/**
 * SettingsCodeField — 等宽字体输入框（用于代码/密钥/JSON 输入）
 */
export function SettingsCodeField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return <input className="font-mono" style={{ ...formInputStyle, fontFamily: 'var(--mono)' }} {...props} />;
}

/**
 * SettingsReadOnlyField — 只读字段展示
 */
export function SettingsReadOnlyField({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...formInputStyle,
        borderStyle: 'dashed',
        borderColor: 'var(--border)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * SettingsVarRow — 变量行（标签 + 值网格布局）
 */
export function SettingsVarRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: '8px',
        padding: '8px 0',
        fontSize: '12px',
        gridTemplateColumns: 'minmax(0, 1fr) 300px',
      }}
    >
      {children}
    </div>
  );
}
