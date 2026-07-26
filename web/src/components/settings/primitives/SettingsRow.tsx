import type { DragEvent, KeyboardEvent, ReactNode } from 'react';

type RowTone = 'default' | 'active' | 'inactive';

const rowToneBg: Record<RowTone, string> = {
  default: 'var(--bg-elevated)',
  active: 'var(--bg-elevated)',
  inactive: 'var(--bg-muted)',
};

interface SettingsRowProps {
  icon?: ReactNode;
  title: string;
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  dragHandle?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: RowTone;
  expanded?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
  'data-testid'?: string;
  'data-guide-id'?: string;
}

/**
 * SettingsRow — 设置区列表行（图标 + 标题 + 元信息 + 操作）
 *
 * 支持 expandable 模式（onToggle 提供时显示折叠按钮）。
 */
export function SettingsRow({
  icon,
  title,
  meta,
  badges,
  actions,
  dragHandle,
  children,
  className,
  tone = 'default',
  expanded,
  onToggle,
  onClick,
  onKeyDown,
  draggable,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  ...rest
}: SettingsRowProps) {
  const isExpandable = onToggle !== undefined;
  const isExpanded = expanded ?? true;

  return (
    <div
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
        background: rowToneBg[tone],
        padding: '12px 16px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all var(--duration-normal) var(--ease-out)',
        cursor: onClick ? 'pointer' : 'inherit',
        opacity: isDragging ? 0.4 : 1,
        border: '1px solid var(--border)',
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {dragHandle && <div style={{ flexShrink: 0, cursor: 'grab', color: 'var(--muted)' }}>{dragHandle}</div>}
        {icon && <div style={{ flexShrink: 0 }}>{icon}</div>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 700, color: 'var(--text-strong)' }}>
              {title}
            </span>
            {badges}
          </div>
          {meta && (
            <div style={{ marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text)' }}>
              {meta}
            </div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: '8px' }}>{actions}</div>}
        {isExpandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              flexShrink: 0,
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: 'pointer',
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? '收起' : '展开'}
          >
            <svg
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform var(--duration-normal) var(--ease-out)' }}
              width="14"
              height="14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      {children && isExpanded && <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>{children}</div>}
    </div>
  );
}
