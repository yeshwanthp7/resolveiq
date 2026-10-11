import React from 'react';

const STATUS_MAP = {
  triggered: { label: 'Triggered', className: 'badge-status-triggered' },
  acknowledged: { label: 'Acknowledged', className: 'badge-status-acknowledged' },
  investigating: { label: 'Investigating', className: 'badge-status-investigating' },
  mitigated: { label: 'Mitigated', className: 'badge-status-mitigated' },
  resolved: { label: 'Resolved', className: 'badge-status-resolved' },
  closed: { label: 'Closed', className: 'badge-status-closed' },
};

export default function StatusBadge({ status }) {
  const s = (status || 'triggered').toLowerCase();
  const config = STATUS_MAP[s] || { label: status, className: 'badge-neutral' };

  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
}
