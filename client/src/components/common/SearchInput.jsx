import React from 'react';
import { Search, X } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = 'Search incidents...', style }) {
  return (
    <div className="search-box" style={style}>
      <Search
        size={15}
        style={{
          position: 'absolute',
          left: '0.65rem',
          color: 'var(--text-secondary)',
          pointerEvents: 'none',
        }}
      />
      <input
        type="text"
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="btn-subtle"
          style={{
            position: 'absolute',
            right: '0.4rem',
            padding: '2px',
            border: 'none',
            background: 'none',
          }}
          aria-label="Clear search query"
        >
          <X size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}
    </div>
  );
}
