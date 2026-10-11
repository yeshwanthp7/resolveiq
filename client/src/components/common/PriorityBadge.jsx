import React from 'react';

const PRIORITY_MAP = {
  P1: { label: 'P1 Critical', className: 'badge-p1' },
  P2: { label: 'P2 Major', className: 'badge-p2' },
  P3: { label: 'P3 Moderate', className: 'badge-p3' },
  P4: { label: 'P4 Minor', className: 'badge-p4' },
  P5: { label: 'P5 Info', className: 'badge-p5' },
};

export default function PriorityBadge({ priority }) {
  const p = (priority || 'P4').toUpperCase();
  const config = PRIORITY_MAP[p] || PRIORITY_MAP.P4;

  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
}
