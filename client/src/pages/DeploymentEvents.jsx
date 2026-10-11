import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import LoadingState from '../components/common/LoadingState';
import ErrorState from '../components/common/ErrorState';
import { deploymentApi } from '../services/api';
import { subscribeToEvent } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Rocket,
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  PlusCircle,
  RefreshCw,
  Search,
  ExternalLink,
  X,
} from 'lucide-react';

export default function DeploymentEvents() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [envFilter, setEnvFilter] = useState('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    service: '',
    version: '',
    environment: 'production',
    status: 'success',
    changeSummary: '',
    changeReference: '',
    commitHash: '',
  });

  const canManageDeployments = ['support_engineer', 'manager', 'admin'].includes(user?.role);

  const fetchDeployments = useCallback(async (isBg = false) => {
    if (!isBg) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await deploymentApi.getDeployments({
        search: searchQuery || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        environment: envFilter !== 'all' ? envFilter : undefined,
        limit: 50,
      });

      if (res.deployments) {
        setDeployments(res.deployments);
      }
    } catch (err) {
      console.error('Failed to load deployments:', err);
      setError(err.message || 'Unable to retrieve deployment timeline.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, statusFilter, envFilter]);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  // Live Socket.IO Updates
  useEffect(() => {
    const unsub = subscribeToEvent('deployment:created', () => {
      fetchDeployments(true);
    });
    return () => unsub();
  }, [fetchDeployments]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.service || !form.version || !form.changeSummary) {
      showError('Service, version, and change summary are mandatory.');
      return;
    }

    setSubmitting(true);
    try {
      await deploymentApi.createDeployment(form);
      showSuccess(`Deployment ${form.version} for ${form.service} recorded successfully.`);
      setIsModalOpen(false);
      setForm({
        service: '',
        version: '',
        environment: 'production',
        status: 'success',
        changeSummary: '',
        changeReference: '',
        commitHash: '',
      });
      fetchDeployments(true);
    } catch (err) {
      showError(err.message || 'Failed to record deployment.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'success':
        return (
          <span className="badge" style={{ backgroundColor: '#DCFCE7', color: '#166534', gap: '0.25rem' }}>
            <CheckCircle2 size={12} /> Success
          </span>
        );
      case 'failed':
        return (
          <span className="badge" style={{ backgroundColor: '#FEE2E2', color: '#991B1B', gap: '0.25rem' }}>
            <AlertTriangle size={12} /> Failed
          </span>
        );
      case 'rolled_back':
        return (
          <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E', gap: '0.25rem' }}>
            <RotateCcw size={12} /> Rolled Back
          </span>
        );
      default:
        return <span className="badge badge-neutral">{status}</span>;
    }
  };

  const columns = [
    {
      key: 'version',
      header: 'Version / Release',
      width: '130px',
      render: (item) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.825rem' }}>
          {item.version}
        </span>
      ),
    },
    {
      key: 'service',
      header: 'Service & Env',
      width: '160px',
      render: (item) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.service || item.serviceName}
          </div>
          <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
            {item.environment}
          </span>
        </div>
      ),
    },
    {
      key: 'changeSummary',
      header: 'Change Summary & Reference',
      render: (item) => (
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{item.changeSummary}</div>
          {item.changeReference && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Ref: <code style={{ fontSize: '0.75rem' }}>{item.changeReference}</code>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'commitHash',
      header: 'Commit',
      width: '100px',
      render: (item) => (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            backgroundColor: 'var(--bg-subtle)',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          {item.commitHash ? item.commitHash.slice(0, 8) : 'HEAD'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (item) => getStatusBadge(item.status),
    },
    {
      key: 'deployedAt',
      header: 'Deployed At',
      width: '150px',
      render: (item) => (
        <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
          {new Date(item.deployedAt).toLocaleString()}
        </span>
      ),
    },
  ];

  if (loading && !deployments.length) {
    return <LoadingState message="Connecting to CI/CD deployment event stream..." />;
  }

  if (error && !deployments.length) {
    return <ErrorState message={error} onRetry={() => fetchDeployments()} />;
  }

  return (
    <div>
      <PageHeader
        title="CI/CD Deployment Event Registry"
        subtitle="Immutable release telemetry tracked for automated incident correlation and blast radius mapping"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => fetchDeployments(true)}
              className="btn btn-secondary"
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
            {canManageDeployments && (
              <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
                <PlusCircle size={15} /> Record Deployment
              </button>
            )}
          </div>
        }
      />

      {/* Filter Toolbar */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          padding: '0.75rem 1rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flex: '1 1 300px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}
            />
            <input
              type="text"
              placeholder="Search service, version, commit, or change..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{ paddingLeft: '2rem', fontSize: '0.85rem' }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-control"
            style={{ width: 'auto', padding: '0.35rem 0.65rem', fontSize: '0.825rem' }}
          >
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="rolled_back">Rolled Back</option>
          </select>

          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            className="form-control"
            style={{ width: 'auto', padding: '0.35rem 0.65rem', fontSize: '0.825rem' }}
          >
            <option value="all">All Environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </div>

        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Total Events: <strong>{deployments.length}</strong>
        </div>
      </div>

      {/* Deployments Data Table */}
      <DataTable
        columns={columns}
        data={deployments}
        emptyMessage="No deployment events match the active filter criteria."
      />

      {/* Record Deployment Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '520px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Rocket size={18} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Record Deployment Event</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="btn btn-subtle"
                style={{ padding: '0.2rem' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    TARGET SERVICE *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. payments-service"
                    value={form.service}
                    onChange={(e) => setForm({ ...form, service: e.target.value })}
                    className="form-control"
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    VERSION / TAG *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. v2.4.1"
                    value={form.version}
                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                    className="form-control"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    ENVIRONMENT
                  </label>
                  <select
                    value={form.environment}
                    onChange={(e) => setForm({ ...form, environment: e.target.value })}
                    className="form-control"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    ROLLOUT STATUS
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="form-control"
                  >
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="rolled_back">Rolled Back</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                  CHANGE SUMMARY *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Detail modifications, migration notes, or configuration changes..."
                  value={form.changeSummary}
                  onChange={(e) => setForm({ ...form, changeSummary: e.target.value })}
                  className="form-control"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    CHANGE REF / PR
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PR-1042 or CHG-8921"
                    value={form.changeReference}
                    onChange={(e) => setForm({ ...form, changeReference: e.target.value })}
                    className="form-control"
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.775rem', fontWeight: 600 }}>
                    COMMIT SHA
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 7f8a9b2"
                    value={form.commitHash}
                    onChange={(e) => setForm({ ...form, commitHash: e.target.value })}
                    className="form-control"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Record Deployment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
