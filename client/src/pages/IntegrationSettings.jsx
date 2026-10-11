import React, { useState, useEffect } from 'react';
import PageHeader from '../components/common/PageHeader';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LoadingState from '../components/common/LoadingState';
import EmptyState from '../components/common/EmptyState';
import {
  Key,
  Shield,
  Copy,
  Check,
  AlertTriangle,
  Plus,
  RefreshCw,
  Terminal,
  Code,
  Layers,
  Clock,
  Trash2,
  Lock,
  Mail,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { integrationApi } from '../services/api';

const SAMPLE_PAYLOADS = {
  prometheus: {
    label: 'Prometheus Alertmanager',
    data: {
      title: 'High CPU Steal Rate on Payment Gateway Pods',
      description: 'Prometheus node-exporter alert: payments-core pods experiencing >88% CPU steal time over 5m window.',
      affectedService: 'payment-gateway',
      severity: 'critical',
      source: 'prometheus',
      externalEventId: 'prom_alert_8942_cpu',
      environment: 'production',
      tags: ['prometheus', 'k8s', 'cpu-saturation'],
    },
  },
  datadog: {
    label: 'Datadog Monitor Webhook',
    data: {
      title: 'Database Connection Pool Exhaustion [p99 Latency > 2.5s]',
      description: 'Datadog APM monitor detected Postgres connection pool utilization at 98% with query backlog.',
      affectedService: 'database-cluster',
      severity: 'critical',
      source: 'datadog',
      externalEventId: 'dd_monitor_pool_418',
      environment: 'production',
      tags: ['datadog', 'database', 'connection-pool'],
    },
  },
  cloudwatch: {
    label: 'AWS CloudWatch Alarm',
    data: {
      title: 'ELB 5XX Error Rate Surge on Ingress Gateway',
      description: 'AWS CloudWatch metric HTTPCode_Target_5XX_Count crossed threshold of 50 errors/min.',
      affectedService: 'ingress-gateway',
      severity: 'high',
      source: 'cloudwatch',
      externalEventId: 'cw_alarm_elb_5xx_991',
      environment: 'production',
      tags: ['aws', 'cloudwatch', 'elb'],
    },
  },
  generic: {
    label: 'Generic Monitoring Webhook',
    data: {
      title: 'Memory Leak Triggering OOMKilled in Auth Service',
      description: 'Synthetic health checker detected auth pod crashed with exit code 137 (OOMKilled).',
      affectedService: 'auth-service',
      impact: 'enterprise',
      urgency: 'critical',
      source: 'webhook',
      externalEventId: 'wh_evt_auth_oom_772',
      environment: 'production',
      tags: ['memory-leak', 'oom', 'auth'],
    },
  },
};

export default function IntegrationSettings() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const isAdmin = user?.role === 'admin';

  // API Keys state
  const [integrations, setIntegrations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Key creation modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [provider, setProvider] = useState('prometheus');
  const [rateLimit, setRateLimit] = useState(60);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // One-time key reveal state
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Key revocation modal state
  const [revokeTarget, setRevokeTarget] = useState(null);

  // Documentation / Payload tab state
  const [activePayloadTab, setActivePayloadTab] = useState('prometheus');
  const [copiedCurl, setCopiedCurl] = useState(false);

  const fetchIntegrations = async () => {
    try {
      setIsLoading(true);
      const res = await integrationApi.getIntegrations();
      if (res.success) {
        setIntegrations(res.integrations || []);
      }
    } catch (err) {
      showError(err.message || 'Failed to load integration keys');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchIntegrations();
    } else {
      setIsLoading(false);
    }
  }, [isAdmin]);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!serviceName.trim()) {
      showError('Service name is required');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await integrationApi.createIntegration({
        serviceName: serviceName.trim(),
        provider,
        rateLimitPerMinute: Number(rateLimit) || 60,
        expiresInDays: expiresInDays > 0 ? Number(expiresInDays) : null,
        scopes: ['ingest:incidents'],
      });

      if (res.success && res.apiKey) {
        setNewlyCreatedKey(res.apiKey);
        showSuccess('API key generated successfully!');
        fetchIntegrations();
      }
    } catch (err) {
      showError(err.message || 'Failed to generate API key');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewlyCreatedKey(null);
    setServiceName('');
    setCopiedKey(false);
  };

  const handleCopyKey = () => {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey);
      setCopiedKey(true);
      showSuccess('API key copied to clipboard!');
      setTimeout(() => setCopiedKey(false), 3000);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    try {
      const res = await integrationApi.revokeIntegration(revokeTarget._id);
      if (res.success) {
        showSuccess(`API key for ${revokeTarget.serviceName} revoked.`);
        fetchIntegrations();
      }
    } catch (err) {
      showError(err.message || 'Failed to revoke API key');
    } finally {
      setRevokeTarget(null);
    }
  };

  const currentPayload = SAMPLE_PAYLOADS[activePayloadTab]?.data || SAMPLE_PAYLOADS.prometheus.data;
  const currentCurl = `curl -X POST http://localhost:5000/api/v1/ingest/incidents \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer riq_live_YOUR_KEY_HERE" \\
  -H "X-Idempotency-Key: ${currentPayload.externalEventId}" \\
  -d '${JSON.stringify(currentPayload, null, 2)}'`;

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(currentCurl);
    setCopiedCurl(true);
    showSuccess('cURL example copied to clipboard!');
    setTimeout(() => setCopiedCurl(false), 3000);
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader
          title="Integration Settings"
          subtitle="Manage monitoring alert ingestion endpoints and API credentials"
        />
        <div className="card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'center', padding: '2.5rem' }}>
          <Lock size={42} style={{ color: '#B43B3B', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>Administrator Access Required</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.6' }}>
            Machine-to-machine API key provisioning, rate limit controls, and integration revocation
            are restricted strictly to authorized platform administrators.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Integration Settings & Ingestion Credentials"
        subtitle="Provision secure machine-to-machine API keys, configure monitoring webhooks, and test idempotency"
      >
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="btn btn-primary"
          id="btn-provision-key"
        >
          <Plus size={16} /> Provision New API Key
        </button>
      </PageHeader>

      {/* Section 1: Active API Credentials */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Key size={18} style={{ color: 'var(--accent-forest)' }} />
            <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Provisioned Machine-to-Machine API Keys</h3>
          </div>
          <button
            type="button"
            onClick={fetchIntegrations}
            className="btn btn-subtle"
            style={{ padding: '4px 8px', fontSize: '0.8rem' }}
            title="Refresh keys"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {isLoading ? (
          <LoadingState message="Loading integration credentials..." />
        ) : integrations.length === 0 ? (
          <EmptyState
            title="No API Keys Provisioned"
            description="Generate dedicated machine-to-machine credentials to allow Datadog, Prometheus, or CloudWatch to ingest incidents directly."
            action={
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="btn btn-primary"
                style={{ marginTop: '0.75rem' }}
              >
                <Plus size={15} /> Provision First Key
              </button>
            }
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Service & Tool</th>
                  <th>Key Prefix</th>
                  <th>Permissions</th>
                  <th>Rate Limit</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((item) => {
                  const isRevoked = !item.isActive;
                  const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date();

                  return (
                    <tr key={item._id} style={{ opacity: isRevoked ? 0.65 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.serviceName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                          Provider: {item.provider}
                        </div>
                      </td>
                      <td>
                        <code
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            border: '1px solid var(--border-neutral)',
                          }}
                        >
                          {item.apiKeyPrefix || 'riq_live_...'}•••••••
                        </code>
                      </td>
                      <td>
                        {(item.scopes || ['ingest:incidents']).map((scope) => (
                          <span
                            key={scope}
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(46, 117, 89, 0.12)',
                              color: 'var(--accent-forest)',
                              fontSize: '0.725rem',
                              fontWeight: 600,
                              marginRight: '4px',
                            }}
                          >
                            {scope}
                          </span>
                        ))}
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {item.rateLimitPerMinute || 60} req / min
                        </span>
                      </td>
                      <td>
                        {isRevoked ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(180, 59, 59, 0.15)',
                              color: '#B43B3B',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                          >
                            Revoked
                          </span>
                        ) : isExpired ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(217, 119, 6, 0.15)',
                              color: '#D97706',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                          >
                            Expired
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(46, 117, 89, 0.15)',
                              color: 'var(--accent-forest)',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </td>
                      <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                      <td>
                        {item.lastUsedAt
                          ? new Date(item.lastUsedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                          : <span style={{ color: 'var(--text-muted)' }}>Never</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {!isRevoked && (
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(item)}
                            className="btn btn-secondary"
                            style={{
                              padding: '3px 8px',
                              fontSize: '0.75rem',
                              color: '#B43B3B',
                              borderColor: 'rgba(180, 59, 59, 0.3)',
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Ingestion Documentation & Interactive cURL Guide */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Terminal size={18} style={{ color: 'var(--accent-forest)' }} />
          <h3 style={{ fontSize: '1.05rem', margin: 0 }}>M2M REST Ingestion Specifications</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-subtle)', borderRadius: '6px', border: '1px solid var(--border-neutral)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>INGESTION ENDPOINT</div>
            <code style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-forest)' }}>POST /api/v1/ingest/incidents</code>
          </div>
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-subtle)', borderRadius: '6px', border: '1px solid var(--border-neutral)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>AUTHENTICATION HEADERS</div>
            <code style={{ fontSize: '0.8rem' }}>Authorization: Bearer &lt;API_KEY&gt;</code>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>or X-API-Key: &lt;API_KEY&gt;</div>
          </div>
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-subtle)', borderRadius: '6px', border: '1px solid var(--border-neutral)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>IDEMPOTENCY RETRY SUPPORT</div>
            <code style={{ fontSize: '0.8rem' }}>X-Idempotency-Key or externalEventId</code>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Prevents duplicate tickets on retries (HTTP 200)</div>
          </div>
        </div>

        {/* Payload selector tabs */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-neutral)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
            {Object.entries(SAMPLE_PAYLOADS).map(([key, item]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActivePayloadTab(key)}
                className="btn"
                style={{
                  fontSize: '0.8rem',
                  padding: '4px 10px',
                  backgroundColor: activePayloadTab === key ? 'var(--accent-forest)' : 'transparent',
                  color: activePayloadTab === key ? '#FFFFFF' : 'var(--text-main)',
                  border: '1px solid',
                  borderColor: activePayloadTab === key ? 'var(--accent-forest)' : 'var(--border-neutral)',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* cURL Example Snippet */}
        <div style={{ position: 'relative', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              WORKING cURL EXECUTABLE EXAMPLE:
            </span>
            <button
              type="button"
              onClick={handleCopyCurl}
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {copiedCurl ? <Check size={14} style={{ color: 'var(--accent-forest)' }} /> : <Copy size={14} />}
              {copiedCurl ? 'Copied!' : 'Copy cURL'}
            </button>
          </div>
          <pre
            style={{
              backgroundColor: '#1E1E1E',
              color: '#D4D4D4',
              padding: '1rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              overflowX: 'auto',
              fontFamily: 'monospace',
              lineHeight: '1.45',
            }}
          >
            {currentCurl}
          </pre>
        </div>
      </div>

      {/* Section 3: Ingestion Lifecycle & Optional Email Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Zap size={18} style={{ color: 'var(--accent-forest)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Automated Triage & SLA Engine Integration</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
            Every ingested event immediately executes ResolveIQ's deterministic ITIL 3x3 matrix calculation, derives
            priority (P1–P5), computes response/resolution SLA deadlines, runs deterministic keyword routing, and
            publishes real-time WebSockets to active operations dashboards.
          </p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Mail size={18} style={{ color: 'var(--text-muted)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Email Alert Ingestion Provider Status</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
            <strong>Status: Unconfigured (Inactive).</strong> ResolveIQ enforces strict verification for external integrations.
            Inbound email ingestion requires a verified SMTP/IMAP inbound connector with TLS mutual authentication.
            Only authenticated REST endpoints are currently operational.
          </p>
        </div>
      </div>

      {/* Modal 1: Provision New API Key */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => !newlyCreatedKey && setIsCreateModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            {!newlyCreatedKey ? (
              <form onSubmit={handleCreateKey}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  <Key size={20} style={{ color: 'var(--accent-forest)' }} />
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Provision Machine-to-Machine API Key</h3>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label" htmlFor="svc-name">Integration / Service Name *</label>
                  <input
                    id="svc-name"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Datadog Production Alerts"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label" htmlFor="prov-select">Monitoring Tool Provider</label>
                  <select
                    id="prov-select"
                    className="form-select"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    <option value="prometheus">Prometheus Alertmanager</option>
                    <option value="datadog">Datadog APM & Monitors</option>
                    <option value="cloudwatch">AWS CloudWatch Alarms</option>
                    <option value="synthetic">Synthetic Monitoring Probe</option>
                    <option value="webhook">Generic Webhook / Custom Agent</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="rate-input">Rate Limit (req/min)</label>
                    <input
                      id="rate-input"
                      type="number"
                      min="5"
                      max="600"
                      className="form-input"
                      value={rateLimit}
                      onChange={(e) => setRateLimit(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="expiry-select">Credential Expiration</label>
                    <select
                      id="expiry-select"
                      className="form-select"
                      value={expiresInDays}
                      onChange={(e) => setExpiresInDays(e.target.value)}
                    >
                      <option value="30">30 Days</option>
                      <option value="90">90 Days</option>
                      <option value="365">1 Year</option>
                      <option value="0">Never Expires</option>
                    </select>
                  </div>
                </div>

                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                  <Shield size={14} style={{ verticalAlign: 'middle', marginRight: '4px', color: 'var(--accent-forest)' }} />
                  <strong>Security Guarantee:</strong> Keys are hashed with SHA-256 before persistence in MongoDB. The plaintext token will be revealed exactly once upon creation.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" onClick={() => setIsCreateModalOpen(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting} className="btn btn-primary" id="btn-submit-key">
                    {isSubmitting ? 'Generating...' : 'Generate API Key'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Shield size={20} style={{ color: 'var(--accent-forest)' }} />
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>API Key Generated Successfully</h3>
                </div>

                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: 'rgba(217, 119, 6, 0.12)',
                    border: '1px solid rgba(217, 119, 6, 0.4)',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    color: '#B45309',
                    marginBottom: '1.25rem',
                    lineHeight: '1.4',
                  }}
                >
                  <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  <strong>Save this key immediately:</strong> This is the only time the plaintext key will be visible. ResolveIQ stores only a cryptographically secure SHA-256 hash.
                </div>

                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">Plaintext Machine-to-Machine Secret Token</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      readOnly
                      className="form-input"
                      value={newlyCreatedKey}
                      style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85rem', backgroundColor: 'var(--bg-subtle)' }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="btn btn-secondary"
                      style={{ minWidth: '95px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      {copiedKey ? <Check size={14} style={{ color: 'var(--accent-forest)' }} /> : <Copy size={14} />}
                      {copiedKey ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleCloseCreateModal}
                    className="btn btn-primary"
                    id="btn-done-key"
                  >
                    I Have Safely Saved This Key
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Confirm Key Revocation */}
      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        title="Revoke API Key Credentials"
        message={`Are you sure you want to revoke the credentials for "${revokeTarget?.serviceName}"? External monitoring tools sending alerts with this key will immediately receive HTTP 403 Forbidden.`}
        confirmLabel="Revoke Key"
        isDestructive={true}
        onConfirm={handleConfirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
