'use client';

import type { ReactNode } from 'react';
import { SETTINGS_SECTIONS } from './settings-nav-config';
import { SettingsText } from './primitives';
import { AccountsSection } from './sections/AccountsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ConciergeSection } from './sections/ConciergeSection';
import { ImSection } from './sections/ImSection';
import { MarketplaceSection } from './sections/MarketplaceSection';
import { McpSection } from './sections/McpSection';
import { MembersSection } from './sections/MembersSection';
import { NotifySection } from './sections/NotifySection';
import { OpsSection } from './sections/OpsSection';
import { PluginsSection } from './sections/PluginsSection';
import { ProfilesSection } from './sections/ProfilesSection';
import { RulesSection } from './sections/RulesSection';
import { SkillsSection } from './sections/SkillsSection';
import { SystemSection } from './sections/SystemSection';
import { VoiceSection } from './sections/VoiceSection';

interface SettingsContentProps {
  section: string;
}

interface SettingsPageHeaderProps {
  title: string;
  subtitle: string;
  children?: ReactNode;
}

/**
 * SettingsPageHeader — 设置区页头（标题 + 描述）
 */
function SettingsPageHeader({ title, subtitle, children }: SettingsPageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '16px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-strong)' }}>{title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>{subtitle}</p>
      </div>
      {children && <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{children}</div>}
    </div>
  );
}

/**
 * SettingsContent — Section 调度器
 *
 * 依据 WEB-FUSION-DESIGN.md §7.2，根据 activeSection 渲染对应的 section 组件。
 * 每个 section 组件自带数据获取逻辑；此处仅负责分发与页头包装。
 */
export function SettingsContent({ section }: SettingsContentProps) {
  const meta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  const content: ReactNode = (() => {
    switch (meta.id) {
      case 'members':
        return <MembersSection />;
      case 'profiles':
        return <ProfilesSection />;
      case 'accounts':
        return <AccountsSection />;
      case 'im':
        return <ImSection />;
      case 'skills':
        return <SkillsSection />;
      case 'mcp':
        return <McpSection />;
      case 'plugins':
        return <PluginsSection />;
      case 'marketplace':
        return <MarketplaceSection />;
      case 'concierge':
        return <ConciergeSection />;
      case 'voice':
        return <VoiceSection />;
      case 'system':
        return <SystemSection />;
      case 'appearance':
        return <AppearanceSection />;
      case 'rules':
        return <RulesSection />;
      case 'notify':
        return <NotifySection />;
      case 'ops':
        return <OpsSection />;
      default:
        return (
          <SettingsText as="p" tone="muted">
            此分区即将上线
          </SettingsText>
        );
    }
  })();

  return (
    <>
      <SettingsPageHeader title={meta.label} subtitle={meta.description} />
      {content}
    </>
  );
}
