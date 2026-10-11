import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import DataTable from '../components/common/DataTable';
import PriorityBadge from '../components/common/PriorityBadge';
import StatusBadge from '../components/common/StatusBadge';
import LoadingState from '../components/common/LoadingState';
import ErrorState from '../components/common/ErrorState';
import { analyticsApi, incidentApi, teamApi } from '../services/api';
import { subscribeToEvent } from '../services/socket';
import {
  AlertOctagon,
  Flame,
  Clock,
  CheckCircle2,
  PlusCircle,
  ArrowUpRight,
  Shield,
  RefreshCw,
  AlertTriangle,
  Users,
  Activity,
  Radio,
  Timer,
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();

  // Filter states
  const [dateRange, setDateRange] = useState('30d');
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [teams, setTeams] = useState([]);

  // Data states
  const [metricsData, setMetricsData] = useState(null);
  const [recentIncidents, setRecentIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(new Date());
  const [isSocketLive, setIsSocketLive] = useState(false);

  // Load team list for filter dropdown
  useEffect(() => {
    teamApi
      .getTeams()
      .then((res) => {
        if (res.teams) setTeams(res.teams);
      })
      .catch((err) => console.warn('Could not load teams list:', err.message));
  }, []);

  // Fetch metrics and triage queue
  const fetchDashboardData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [dashRes, incRes] = await Promise.all([
        analyticsApi.getDashboard({
          dateRange,
          team: selectedTeam,
          priority: selectedPriority,
        }),
        incidentApi.getIncidents({
          limit: 6,
          status: 'triggered,new,acknowledged,investigating,in_progress,mitigated,reopened',
        }),
      ]);

      if (dashRes.metrics) {
        setMetricsData(dashRes);
      }
      if (incRes.incidents) {
        setRecentIncidents(incRes.incidents);
      }
      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('Failed to load operational dashboard data:', err);
      setError(err.message || 'Unable to connect to operational telemetry service.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateRange, selectedTeam, selectedPriority]);

  // Initial and on-filter change fetch
  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Socket.IO live updates with reliable fallback
  useEffect(() => {
    const unsubRefresh = subscribeToEvent('dashboard:refresh', () => {
      setIsSocketLive(true);
      fetchDashboardData(true);
    });

    const unsubCreated = subscribeToEvent('incident:created', () => {
      setIsSocketLive(true);
      fetchDashboardData(true);
    });

    const unsubUpdated = subscribeToEvent('incident:updated', () => {
      setIsSocketLive(true);
      fetchDashboardData(true);
    });

    const unsubResolved = subscribeToEvent('incident:resolved', () => {
      setIsSocketLive(true);
      fetchDashboardData(true);
    });

    return () => {
      unsubRefresh();
      unsubCreated();
      unsubUpdated();
      unsubResolved();
    };
  }, [fetchDashboardData]);

  const metrics = metricsData?.metrics;
  const assumptions = metricsData?.meta?.assumptions;

  const incidentColumns = [
    {
      key: 'incidentNumber',
      header: 'ID',
      width: '100px',
      render: (item) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8rem' }}>
          {item.incidentNumber}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Incident Title & Service',
      render: (item) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Service: <strong>{item.affectedService || 'Unknown'}</strong> • Team: <strong>{item.assignedTeam}</strong>
          </div>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '100px',
      render: (item) => <PriorityBadge priority={item.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'actions',
      header: 'Action',
      width: '90px',
      render: (item) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/incidents/${item._id || item.incidentNumber}`);
          }}
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
          title="Open incident command view"
        >
          View <ArrowUpRight size={12} />
        </button>
      ),
    },
  ];

  if (loading && !metricsData) {
    return <LoadingState message="Connecting to ResolveIQ telemetry hub and aggregating metrics..." />;
  }

  if (error && !metricsData) {
    return <ErrorState message={error} onRetry={() => fetchDashboardData()} />;
  }

  return (
    <div>
      <PageHeader
        title="Operations Control Center"
        subtitle="Real-time operational analytics, 24×7 calendar SLA timers, and blast radius triage"
        badge={
          <span
            className="badge"
            style={{
              backgroundColor: isSocketLive ? '#DCFCE7' : '#EFF6FF',
              color: isSocketLive ? '#15803D' : '#1D4ED8',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <Radio size={12} className={isSocketLive ? 'animate-pulse' : ''} />
            {isSocketLive ? 'LIVE TELEMETRY' : 'API REFRESH'}
          </span>
        }
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => fetchDashboardData(true)}
              className="btn btn-secondary"
              disabled={refreshing}
              title="Force instant API metrics refresh"
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
            <button onClick={() => navigate('/incidents/new')} className="btn btn-primary">
              <PlusCircle size={15} /> Declare Incident
            </button>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              WINDOW:
            </label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value="today">Today (24h)</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              TEAM:
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value="all">All Teams</option>
              {teams.map((t) => (
                <option key={t._id || t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              PRIORITY:
            </label>
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value="all">All Priorities</option>
              <option value="P1">P1 - Critical</option>
              <option value="P2">P2 - High</option>
              <option value="P3">P3 - Moderate</option>
              <option value="P4">P4 - Low</option>
              <option value="P5">P5 - Informational</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Updated: {lastRefreshedAt.toLocaleTimeString()}
        </div>
      </div>

      {/* Primary Operational Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <StatCard
          title="Open Incidents"
          value={metrics?.openIncidents ?? 0}
          subtitle="Currently active in triage"
          icon={AlertOctagon}
        />
        <StatCard
          title="Created Today"
          value={metrics?.incidentsCreatedToday ?? 0}
          subtitle="Since 00:00:00 calendar time"
          icon={Clock}
        />
        <StatCard
          title="SLA Compliance Rate"
          value={`${metrics?.slaCompliance?.rate ?? 100}%`}
          subtitle={`${metrics?.slaCompliance?.metCount ?? 0}/${metrics?.slaCompliance?.denominator ?? 0} evaluated targets`}
          icon={Timer}
          trend={
            (metrics?.slaCompliance?.rate ?? 100) >= 95
              ? { text: 'Within SLA Target (≥95%)', isPositive: true }
              : { text: 'Under Target (<95%)', isPositive: false }
          }
        />
        <StatCard
          title="Active SLA Breaches"
          value={metrics?.activeBreaches?.count ?? 0}
          subtitle={
            (metrics?.activeBreaches?.count ?? 0) > 0
              ? 'Urgent: Overdue resolution/response'
              : 'Zero active SLA breaches'
          }
          icon={AlertTriangle}
          trend={
            (metrics?.activeBreaches?.count ?? 0) === 0
              ? { text: 'All On Track', isPositive: true }
              : { text: 'Action Required', isPositive: false }
          }
        />
        <StatCard
          title="Mean Time To Resolve"
          value={metrics?.mttr?.hours > 0 ? `${metrics.mttr.hours}h` : `${metrics?.mttr?.minutes ?? 0}m`}
          subtitle={`Denominator: ${metrics?.mttr?.denominator ?? 0} resolved (excl. ${metrics?.mttr?.excludedUnresolvedCount ?? 0} open)`}
          icon={CheckCircle2}
        />
      </div>

      {/* Active Breaches Alert Section (if any breaches) */}
      {metrics?.activeBreaches?.count > 0 && (
        <div
          className="card"
          style={{
            marginBottom: '1.75rem',
            border: '1px solid #FCA5A5',
            backgroundColor: '#FEF2F2',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <AlertTriangle size={18} style={{ color: '#DC2626' }} />
            <h3 style={{ fontSize: '0.95rem', margin: 0, color: '#991B1B' }}>
              Active SLA Breaches ({metrics.activeBreaches.count} Tickets Overdue)
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {metrics.activeBreaches.items.map((b) => (
              <div
                key={b.id || b.incidentNumber}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.6rem 0.85rem',
                  backgroundColor: '#FFFFFF',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid #FECACA',
                }}
              >
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginRight: '0.5rem' }}>
                    {b.incidentNumber}
                  </span>
                  <strong style={{ fontSize: '0.85rem' }}>{b.title}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '0.15rem' }}>
                    Team: <strong>{b.assignedTeam}</strong> • Breach: <strong>{b.breachType.toUpperCase()}</strong> •{' '}
                    Overdue by: <span style={{ color: '#DC2626', fontWeight: 600 }}>{b.minutesOverdue} min</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/incidents/${b.id || b.incidentNumber}`)}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Inspect <ArrowUpRight size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ageing Incidents & Status Distributions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
          marginBottom: '1.75rem',
        }}
      >
        {/* Ageing Incidents Breakdown */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Incident Ageing Buckets</h3>
            <span className="badge badge-neutral">{metrics?.ageingIncidents?.totalOpen ?? 0} Open Tickets</span>
          </div>
          <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Continuous calendar hours elapsed since declaration:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
            <div style={{ padding: '0.6rem 0.3rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{metrics?.ageingIncidents?.under1Hour ?? 0}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>&lt; 1h</div>
            </div>
            <div style={{ padding: '0.6rem 0.3rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{metrics?.ageingIncidents?.oneToFourHours ?? 0}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>1–4h</div>
            </div>
            <div style={{ padding: '0.6rem 0.3rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{metrics?.ageingIncidents?.fourToTwentyFourHours ?? 0}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>4–24h</div>
            </div>
            <div style={{ padding: '0.6rem 0.3rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{metrics?.ageingIncidents?.oneToThreeDays ?? 0}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>1–3d</div>
            </div>
            <div style={{ padding: '0.6rem 0.3rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: (metrics?.ageingIncidents?.overThreeDays ?? 0) > 0 ? '#DC2626' : 'inherit' }}>
                {metrics?.ageingIncidents?.overThreeDays ?? 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>&gt; 3d</div>
            </div>
          </div>
        </div>

        {/* Priority & Status Distributions */}
        <div className="card">
          <h3 style={{ fontSize: '0.95rem', margin: 0, marginBottom: '0.5rem' }}>Priority Distribution</h3>
          <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
            Deterministic ITIL severity classifications in selected window:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => (
              <div
                key={p}
                style={{
                  flex: '1 1 50px',
                  padding: '0.5rem',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  textAlign: 'center',
                }}
              >
                <PriorityBadge priority={p} />
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.35rem' }}>
                  {metrics?.incidentsByPriority?.[p] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Triage Queue & Team Workload */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr', gap: '1.5rem', marginBottom: '1.75rem' }}>
        {/* Active Triage Queue */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Active Triage Queue</h2>
              <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--text-secondary)' }}>
                Live incidents requiring responder triage and investigation
              </p>
            </div>
            <button
              onClick={() => navigate('/incidents')}
              className="btn btn-subtle"
              style={{ fontSize: '0.8rem' }}
            >
              All Incidents →
            </button>
          </div>

          <DataTable
            columns={incidentColumns}
            data={recentIncidents}
            onRowClick={(item) => navigate(`/incidents/${item._id || item.incidentNumber}`)}
            emptyMessage="No open incidents. All services functioning within SLA targets."
          />
        </div>

        {/* Team Workload */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Team Workload & Breaches</h3>
            <span className="badge badge-neutral">Active Teams</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {(metrics?.teamWorkload || []).map((tw) => (
              <div
                key={tw.teamName}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.6rem 0.8rem',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.825rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{tw.teamName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    P1: {tw.byPriority?.P1 || 0} • P2: {tw.byPriority?.P2 || 0} • Unassigned: {tw.unassignedCount || 0}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  {tw.breachedCount > 0 && (
                    <span className="badge" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                      {tw.breachedCount} Breached
                    </span>
                  )}
                  <span
                    className="badge"
                    style={{
                      backgroundColor: tw.activeCount > 0 ? '#FEF3C7' : '#F0FDF4',
                      color: tw.activeCount > 0 ? '#92400E' : '#166534',
                    }}
                  >
                    {tw.activeCount} Active
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity Feed (Audit Log) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={16} style={{ color: 'var(--accent-forest)' }} />
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Recent Operational Activity Stream</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Audited Incident Mutations
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(metrics?.recentActivity || []).length === 0 ? (
            <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', padding: '1rem', textAlign: 'center' }}>
              No recent activity recorded in this window.
            </div>
          ) : (
            metrics.recentActivity.slice(0, 8).map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{log.actorName}</span>
                  <span className="badge badge-neutral" style={{ fontSize: '0.7rem', marginRight: '0.5rem' }}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Ticket: <strong>{log.incidentNumber}</strong> — {log.reason || log.incidentTitle}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
