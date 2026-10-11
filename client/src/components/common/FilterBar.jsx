import React from 'react';
import SearchInput from './SearchInput';
import { RotateCcw } from 'lucide-react';

export default function FilterBar({
  searchQuery,
  onSearchChange,
  filters = {},
  filterOptions = {},
  onFilterChange,
  onResetFilters,
  searchPlaceholder = 'Search records...',
}) {
  const hasActiveFilters =
    searchQuery || Object.values(filters).some((val) => val && val !== 'all');

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
        />

        {Object.entries(filterOptions).map(([key, options]) => (
          <select
            key={key}
            className="form-select"
            value={filters[key] || 'all'}
            onChange={(e) => onFilterChange(key, e.target.value)}
            style={{ fontSize: '0.825rem', padding: '0.45rem 0.65rem' }}
            aria-label={`Filter by ${key}`}
          >
            <option value="all">All {key.charAt(0).toUpperCase() + key.slice(1)}s</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="btn btn-subtle"
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem' }}
        >
          <RotateCcw size={13} /> Reset Filters
        </button>
      )}
    </div>
  );
}
