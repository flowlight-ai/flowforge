import { Trash2 } from 'lucide-react';

interface SettingsDeleteButtonProps {
  onClick: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * SettingsDeleteButton — 删除按钮（图标按钮）
 *
 * 使用 lucide-react Trash2 图标替代原 HubIcon。
 */
export function SettingsDeleteButton({
  onClick,
  disabled,
  'aria-label': ariaLabel = '删除',
}: SettingsDeleteButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-full)',
        padding: '6px',
        border: 'none',
        background: 'transparent',
        color: 'var(--muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all var(--duration-normal) var(--ease-out)',
      }}
      aria-label={ariaLabel}
    >
      <Trash2 size={14} />
    </button>
  );
}
