import type { CSSProperties, ElementType, ReactNode } from 'react';

type TextVariant = 'base' | 'sm' | 'xs' | 'micro';
type TextTone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'emerald'
  | 'green'
  | 'amber'
  | 'red'
  | 'blue'
  | 'purple';

const variantMap: Record<TextVariant, string> = {
  base: '14px',
  sm: '13px',
  xs: '12px',
  micro: '10px',
};

const toneMap: Record<TextTone, string> = {
  default: 'var(--text-strong)',
  secondary: 'var(--text)',
  muted: 'var(--muted)',
  emerald: 'var(--ok)',
  green: 'var(--ok)',
  amber: 'var(--warn)',
  red: 'var(--danger)',
  blue: 'var(--info)',
  purple: 'var(--accent-2)',
};

interface SettingsTextProps {
  as?: ElementType;
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * SettingsText — 设置区通用文本组件
 *
 * 从 clowder-ai 移植并简化：去除 Tailwind 类，改用 FlowForge CSS 变量内联样式。
 */
export function SettingsText({
  as: Tag = 'span',
  variant = 'xs',
  tone = 'muted',
  className,
  title,
  style,
  children,
}: SettingsTextProps) {
  return (
    <Tag
      className={className}
      title={title}
      style={{
        fontSize: variantMap[variant],
        color: toneMap[tone],
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
