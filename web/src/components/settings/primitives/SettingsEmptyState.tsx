import type { ReactNode } from 'react';
import { SettingsCard } from './SettingsCard';
import { SettingsText } from './SettingsText';

interface SettingsEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
}

/**
 * SettingsEmptyState — 空状态展示
 */
export function SettingsEmptyState({ icon, title, description }: SettingsEmptyStateProps) {
  return (
    <SettingsCard
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 32px',
        textAlign: 'center',
      }}
    >
      {icon}
      <SettingsText as="p" variant="base" tone="default">
        {title}
      </SettingsText>
      {description && (
        <SettingsText as="p" tone="muted">
          {description}
        </SettingsText>
      )}
    </SettingsCard>
  );
}
