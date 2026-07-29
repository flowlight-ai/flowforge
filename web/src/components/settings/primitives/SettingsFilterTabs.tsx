'use client';

interface FilterTab {
  key: string;
  label: string;
  count?: number;
}

interface SettingsFilterTabsProps {
  tabs: FilterTab[];
  activeKey: string;
  onTabChange: (key: string) => void;
}

/**
 * SettingsFilterTabs — 过滤标签栏
 */
export function SettingsFilterTabs({ tabs, activeKey, onTabChange }: SettingsFilterTabsProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            style={{
              borderRadius: 'var(--radius-full)',
              padding: '4px 12px',
              border: 'none',
              background: isActive ? 'var(--accent)' : 'transparent',
              color: isActive ? 'var(--accent-foreground)' : 'var(--text)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all var(--duration-normal) var(--ease-out)',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span style={{ marginLeft: '4px', opacity: isActive ? 0.8 : 0.6 }}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
