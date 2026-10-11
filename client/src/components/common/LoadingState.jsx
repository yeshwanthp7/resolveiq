import React from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingState({ message = 'Loading enterprise records...' }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1rem',
        gap: '0.75rem',
      }}
    >
      <Loader2
        size={24}
        style={{
          color: 'var(--accent-forest)',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {message}
      </span>
    </div>
  );
}
