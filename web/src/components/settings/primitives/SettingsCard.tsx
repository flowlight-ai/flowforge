import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';

type CardVariant = 'default' | 'highlight';

interface SettingsCardProps {
  variant?: CardVariant;
  as?: 'div' | 'section';
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
  style?: CSSProperties;
  'data-testid'?: string;
  'data-guide-id'?: string;
  children: ReactNode;
  className?: string;
}

const variantBg: Record<CardVariant, string> = {
  default: 'var(--bg-elevated)',
  highlight: 'var(--accent-subtle)',
};

/**
 * SettingsCard — 设置区卡片容器
 */
export function SettingsCard({
  variant = 'default',
  as: Tag = 'div',
  onClick,
  onKeyDown,
  draggable,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  style,
  children,
  className,
  ...rest
}: SettingsCardProps) {
  return (
    <Tag
      className={className}
      onClick={onClick}
      onKeyDown={onKeyDown}
      draggable={draggable || undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        background: variantBg[variant],
        boxShadow: 'var(--shadow-sm)',
        transition: 'all var(--duration-normal) var(--ease-out)',
        cursor: onClick ? 'pointer' : 'inherit',
        opacity: isDragging ? 0.4 : 1,
        border: '1px solid var(--border)',
        ...style,
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
