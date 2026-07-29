interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface SettingsBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

/**
 * SettingsBreadcrumb — 面包屑导航
 */
export function SettingsBreadcrumb({ segments }: SettingsBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>
      {segments.map((seg, i) => (
        <span key={seg.label}>
          {i > 0 && <span style={{ margin: '0 4px', color: 'var(--muted)' }}>&gt;</span>}
          {seg.href ? (
            <a href={seg.href} style={{ color: 'var(--accent)' }}>
              {seg.label}
            </a>
          ) : (
            <span>{seg.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
