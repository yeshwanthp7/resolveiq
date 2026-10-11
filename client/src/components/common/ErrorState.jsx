import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function ErrorState({
  title = 'System Warning',
  message = 'An unexpected error occurred while processing this request.',
  onRetry,
}) {
  return (
    <div className="card" style={{ borderLeft: '4px solid #B43B3B', padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <AlertCircle size={20} style={{ color: '#B43B3B', marginTop: '2px', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '0.95rem', color: '#B43B3B', marginBottom: '0.25rem' }}>
            {title}
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {message}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="btn btn-secondary"
              style={{ marginTop: '0.75rem', fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
            >
              <RotateCcw size={13} /> Retry Operation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
