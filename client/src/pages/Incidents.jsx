import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import FilterBar from '../components/common/FilterBar';
import DataTable from '../components/common/DataTable';
import PriorityBadge from '../components/common/PriorityBadge';
import StatusBadge from '../components/common/StatusBadge';
import { incidentApi } from '../services/api';
import { PlusCircle, ArrowUpRight, Download, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function Incidents() {
  const navigate = useNavigate();
  const { showInfo, showError } = useToast();

  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    priority: 'all',
    status: 'all',
    environment: 'all',
  });

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit,
      };

      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (filters.priority !== 'all') {
        params.priority = filters.priority;
      }
      if (filters.status !== 'all') {
        params.status = filters.status;
      }
      if (filters.environment !== 'all') {
        params.environment = filters.environment;
      }

      const res = await incidentApi.getIncidents(params);
      if (res.success) {
        setIncidents(res.incidents || []);
        setTotal(res.total || 0);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err) {
      setError(err.message || 'Failed to load incidents from database');
      showError(err.message || 'Error loading incident queue');
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchQuery, filters, showError]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilters({ priority: 'all', status: 'all', environment: 'all' });
    setPage(1);
  };

  const handleExport = () => {
    if (incidents.length === 0) {
      showInfo('No incidents available to export.');
      return;
    }
    const headers = ['Incident Number', 'Title', 'Affected Service', 'Priority', 'Status', 'Assigned Team', 'Created At'];
    const rows = incidents.map((i) => [
      i.incidentNumber,
      `"${(i.title || '').replace(/"/g, '""')}"`,
      i.affectedService,
      i.priority,
      i.status,
      i.assignedTeam,
      i.createdAt,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `resolveiq_incidents_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showInfo(`Exported ${incidents.length} incident records.`);
  };

  const filterOptions = {
    priority: [
      { value: 'P1', label: 'P1 - Critical' },
      { value: 'P2', label: 'P2 - Major' },
      { value: 'P3', label: 'P3 - Moderate' },
      { value: 'P4', label: 'P4 - Minor' },
      { value: 'P5', label: 'P5 - Informational' },
    ],
    status: [
      { value: 'triggered', label: 'Triggered' },
      { value: 'acknowledged', label: 'Acknowledged' },
      { value: 'investigating', label: 'Investigating' },
      { value: 'mitigated', label: 'Mitigated' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'closed', label: 'Closed' },
      { value: 'reopened', label: 'Reopened' },
    ],
    environment: [
      { value: 'production', label: 'Production' },
      { value: 'staging', label: 'Staging' },
      { value: 'development', label: 'Development' },
    ],
  };

  const columns = [
    {
      key: 'incidentNumber',
      header: 'Incident ID',
      width: '110px',
      render: (item) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.825rem' }}>
          {item.incidentNumber}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Title & Affected Service',
      render: (item) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Service: <strong>{item.affectedService}</strong> • Source: <strong>{item.source || 'manual'}</strong>
          </div>
        </div>
      ),
    },
    {
      key: 'environment',
      header: 'Environment',
      width: '110px',
      render: (item) => {
        const env = item.classificationMetadata?.environment || 'production';
        return (
          <span
            style={{
              fontSize: '0.72rem',
              padding: '2px 6px',
              borderRadius: 'var(--radius-xs)',
              backgroundColor: env === 'production' ? '#FEE2E2' : 'var(--bg-subtle)',
              color: env === 'production' ? '#991B1B' : 'var(--text-secondary)',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {env}
          </span>
        );
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '110px',
      render: (item) => <PriorityBadge priority={item.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'assignedTeam',
      header: 'Team / Resolver',
      render: (item) => (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{item.assignedTeam}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {item.assignee?.name || <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '100px',
      render: (item) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/incidents/${item.incidentNumber || item._id}`);
          }}
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
          title="Open incident command details"
        >
          Command <ArrowUpRight size={12} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Incident Triage Queue"
        subtitle="Live incident command, deterministic ITIL priority, and SLA tracking"
        badge={
          <span
            className="badge"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-neutral)' }}
          >
            {total} Total Tickets
          </span>
        }
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={fetchIncidents}
              className="btn btn-secondary"
              title="Refresh queue"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
            <button onClick={handleExport} className="btn btn-secondary" disabled={incidents.length === 0}>
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => navigate('/incidents/new')} className="btn btn-primary">
              <PlusCircle size={15} /> Declare Incident
            </button>
          </div>
        }
      />

      {error && (
        <div className="alert-box alert-error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPage(1);
        }}
        filters={filters}
        filterOptions={filterOptions}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        searchPlaceholder="Filter by title, ID, service, description..."
      />

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem' }} />
          <div>Loading incident queue from database...</div>
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={incidents}
            onRowClick={(item) => navigate(`/incidents/${item.incidentNumber || item._id}`)}
            emptyMessage="No incidents match the selected filter criteria."
          />

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-neutral)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.825rem',
              }}
            >
              <div style={{ color: 'var(--text-secondary)' }}>
                Showing <strong>{(page - 1) * limit + 1}</strong> to{' '}
                <strong>{Math.min(page * limit, total)}</strong> of <strong>{total}</strong> tickets
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.65rem' }}
                >
                  <ChevronLeft size={14} /> Previous
                </button>

                <span style={{ fontWeight: 600, padding: '0 0.5rem' }}>
                  Page {page} of {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.65rem' }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
