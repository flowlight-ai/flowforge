'use client';

import { useCallback } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SettingsBadge, SettingsRow, SettingsSection, SettingsText } from '../primitives';
import { useTheme, type Theme } from '@/components/ThemeProvider';

interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
  icon: typeof Sun;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    label: '亮色主题',
    description: '浅色背景，适合白天明亮环境。',
    icon: Sun,
  },
  {
    id: 'dark',
    label: '暗色主题',
    description: '深色背景，适合夜晚或低光环境。',
    icon: Moon,
  },
  {
    id: 'system',
    label: '跟随系统',
    description: '自动跟随操作系统的主题设置，系统切换时自动响应。',
    icon: Monitor,
  },
];

/**
 * AppearanceSection — 外观与主题
 *
 * 三态主题切换：亮色 / 暗色 / 跟随系统
 *
 * 设计依据：
 *   - 用户反馈：除亮色/暗色外，应有"跟随系统"默认选项
 *   - 修复前问题：旧版只有 light/dark，切换后 localStorage 写入即不再跟随系统
 *   - 修复后：增加 system 选项，未显式选择时默认跟随系统
 *
 * 同时解决"部分组件不变色"问题：
 *   - 旧版 CouncilChatPanel 等组件使用硬编码颜色（bg-[#0d0d12] 等）
 *   - 新版统一使用 CSS 变量（var(--bg) 等），主题切换时所有组件同步变色
 */
export function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const handleSelect = useCallback(
    (next: Theme) => {
      setTheme(next);
    },
    [setTheme],
  );

  return (
    <SettingsSection
      title="主题模式"
      description="选择应用的主题外观。'跟随系统' 会根据操作系统的主题设置自动切换。"
      badge={
        <SettingsBadge tone={resolvedTheme === 'dark' ? 'slate' : 'blue'} size="xxs">
          当前: {resolvedTheme === 'dark' ? '暗色' : '亮色'}
        </SettingsBadge>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.id;
          return (
            <SettingsRow
              key={opt.id}
              icon={<Icon size={16} color={active ? 'var(--accent)' : 'var(--muted)'} />}
              title={opt.label}
              meta={opt.description}
              badges={
                active ? (
                  <SettingsBadge tone="emerald" size="xxs">已选择</SettingsBadge>
                ) : null
              }
              onClick={() => handleSelect(opt.id)}
              tone={active ? 'active' : 'default'}
            />
          );
        })}
      </div>

      <div
        style={{
          marginTop: '16px',
          padding: '12px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}
      >
        <SettingsText as="div" tone="muted">
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>提示：</strong>
          {' '}主题切换会立即生效并持久化保存。选择「跟随系统」后，操作系统切换深浅色时应用会自动响应。
          <br />
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>组件适配：</strong>
          {' '}所有页面与组件已统一使用 CSS 变量（var(--bg)、var(--text) 等），主题切换时所有组件同步变色。
        </SettingsText>
      </div>
    </SettingsSection>
  );
}
