import React from 'react';

export default function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  breadcrumbs,
}) {
  return (
    <div className="page-header">
      <div>
        {breadcrumbs && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            {breadcrumbs}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <h1>{title}</h1>
          {badge}
        </div>
        {subtitle && <p style={{ marginTop: '0.2rem' }}>{subtitle}</p>}
      </div>

      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}
