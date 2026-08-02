import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  children?: ReactNode;
}

/**
 * SettingsSection — 设置区分块（带标题、描述、徽标）
 */
export function SettingsSection({ title, description, badge, children }: SettingsSectionProps) {
  return (
    <section
      style={{
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-elevated)',
        padding: '18px',
        boxShadow: 'var(--shadow-sm)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-strong)' }}>{title}</h3>
          {description && (
            <p style={{ margin: '4px 0 0', maxWidth: '640px', fontSize: '13px', lineHeight: 1.6, color: 'var(--text)' }}>
              {description}
            </p>
          )}
        </div>
        {badge}
      </div>
      {children && <div style={{ marginTop: '12px' }}>{children}</div>}
    </section>
  );
}
