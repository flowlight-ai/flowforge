import type { ReactNode } from 'react';

interface SettingsFieldProps {
  label: string;
  hint?: string;
  inline?: boolean;
  compact?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * SettingsField — 设置区字段（标签 + 提示 + 控件）
 *
 * inline=true 时左右排布（标签在左、控件在右）；
 * 默认上下排布（标签在上、控件在下）。
 */
export function SettingsField({ label, hint, inline, compact, badge, children }: SettingsFieldProps) {
  if (inline) {
    const labelSize = compact
      ? { fontSize: '12px', color: 'var(--text)' }
      : { fontSize: '13px', fontWeight: 500, color: 'var(--text-strong)' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={labelSize}>{label}</span>
            {badge}
          </div>
          {hint && <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>{hint}</p>}
        </div>
        <div style={{ flexShrink: 0, fontSize: compact ? '12px' : '13px', color: 'var(--text)' }}>{children}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-strong)' }}>{label}</label>
        {badge}
      </div>
      {hint && <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)' }}>{hint}</p>}
      <div>{children}</div>
    </div>
  );
}
