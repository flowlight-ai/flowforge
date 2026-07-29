import type { CSSProperties, ReactNode } from 'react';

type StripTone = 'info' | 'success' | 'warn' | 'error' | 'muted';

interface SettingsStatusStripProps {
  tone: StripTone;
  size?: 'sm' | 'xs';
  bordered?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

const toneStyles: Record<StripTone, { bg: string; color: string; border: string }> = {
  info: { bg: 'color-mix(in srgb, var(--info) 12%, transparent)', color: 'var(--info)', border: 'var(--info)' },
  success: { bg: 'var(--ok-subtle)', color: 'var(--ok)', border: 'var(--ok)' },
  warn: { bg: 'var(--warn-subtle)', color: 'var(--warn)', border: 'var(--warn)' },
  error: { bg: 'var(--danger-subtle)', color: 'var(--danger)', border: 'var(--danger)' },
  muted: { bg: 'transparent', color: 'var(--muted)', border: 'var(--border)' },
};

/**
 * SettingsStatusStrip — 状态条（用于显示 info/success/warn/error 消息）
 */
export function SettingsStatusStrip({ tone, size = 'sm', bordered, actions, children, style }: SettingsStatusStripProps) {
  const styles = toneStyles[tone];
  const isMutedFlat = tone === 'muted' && !bordered;
  const fontSize = size === 'xs' ? '12px' : '13px';

  const sharedStyle: React.CSSProperties = {
    borderRadius: isMutedFlat ? 0 : 'var(--radius-sm)',
    padding: isMutedFlat ? 0 : '8px 12px',
    background: styles.bg,
    color: styles.color,
    border: bordered ? `1px solid ${styles.border}` : 'none',
    fontSize,
    fontWeight: 500,
    ...style,
  };

  if (actions) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...sharedStyle }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{children}</div>
        {actions}
      </div>
    );
  }
  return <p style={{ margin: 0, ...sharedStyle }}>{children}</p>;
}
