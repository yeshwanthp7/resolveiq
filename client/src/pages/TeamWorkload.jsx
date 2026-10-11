import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import PriorityBadge from '../components/common/PriorityBadge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { analyticsApi, incidentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Users2,
  ShieldAlert,
  Clock,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Info,
  Sparkles,
  UserCheck,
  BarChart2,
  Activity,
  Check,
  Layers,
  AlertCircle,
  HelpCircle,
  Cpu,
  Zap,
} from 'lucide-react';

export default function TeamWorkload() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState('workload'); // 'workload' | 'simulator'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Workload data
  const [workload, setWorkload] = useState({
    totalActiveIncidents: 0,
    teamQueues: [],
    engineerRoster: [],
  });

  // Active incidents for simulator dropdown
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState(searchParams.get('incidentId') || '');

  // Candidate responders data
  const [candidates, setCandidates] = useState([]);
  const [candidateMeta, setCandidateMeta] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // What-If Scenario inputs
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [targetTeam, setTargetTeam] = useState('');
  const [targetEngineerId, setTargetEngineerId] = useState('');
  const [simulatedPriority, setSimulatedPriority] = useState('');
  const [paceMultiplier, setPaceMultiplier] = useState(1.0);

  // Simulation output
  const [simulationResult, setSimulationResult] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Live Reassignment confirmation
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [isApplyingLive, setIsApplyingLive] = useState(false);

  // Filter states for roster
  const [rosterTeamFilter, setRosterTeamFilter] = useState('ALL');
  const [rosterStatusFilter, setRosterStatusFilter] = useState('ALL');

  // 1. Fetch workload details and active incidents
  const fetchWorkloadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const [workloadRes, incRes] = await Promise.all([
        analyticsApi.getWorkloadDetails(),
        incidentApi.getIncidents({ limit: 50 }),
      ]);

      if (workloadRes.success) {
        setWorkload({
          totalActiveIncidents: workloadRes.totalActiveIncidents || 0,
          teamQueues: workloadRes.teamQueues || [],
          engineerRoster: workloadRes.engineerRoster || [],
        });
      }

      if (incRes.success) {
        const activeOnly = (incRes.incidents || []).filter(
          (i) => i.status !== 'resolved' && i.status !== 'closed'
        );
        setActiveIncidents(activeOnly);

        // Pre-select incident if param exists or pick first
        const paramId = searchParams.get('incidentId');
        if (paramId) {
          const match = activeOnly.find((i) => i._id === paramId || i.incidentNumber === paramId);
          if (match) {
            setSelectedIncidentId(match._id);
            setActiveTab('simulator');
          }
        } else if (!selectedIncidentId && activeOnly.length > 0) {
          setSelectedIncidentId(activeOnly[0]._id);
        }
      }
    } catch (err) {
      showError(err.message || 'Failed to load team workload data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchParams, showError, selectedIncidentId]);

  useEffect(() => {
    fetchWorkloadData();
  }, []);

  // 2. Fetch Candidate Responders whenever selected incident changes
  const fetchCandidates = useCallback(async (incId) => {
    if (!incId) {
      setCandidates([]);
      setCandidateMeta(null);
      return;
    }
    setCandidatesLoading(true);
    try {
      const res = await incidentApi.getCandidateResponders(incId);
      if (res.success) {
        setCandidates(res.candidates || []);
        setCandidateMeta(res.meta || null);
      }
    } catch (err) {
      showError(err.message || 'Failed to score candidate responders.');
    } finally {
      setCandidatesLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (selectedIncidentId) {
      fetchCandidates(selectedIncidentId);
      // Reset scenario inputs for new incident
      const inc = activeIncidents.find((i) => i._id === selectedIncidentId);
      if (inc) {
        setTargetTeam(inc.assignedTeam || '');
        setTargetEngineerId(inc.assignee?._id || inc.assignee || '');
        setSimulatedPriority(inc.priority || 'P3');
      }
      setDelayMinutes(0);
      setPaceMultiplier(1.0);
      setSimulationResult(null);
    }
  }, [selectedIncidentId, activeIncidents, fetchCandidates]);

  // 3. Run What-If Simulation
  const handleRunSimulation = async (e) => {
    if (e) e.preventDefault();
    if (!selectedIncidentId) {
      showError('Please select an active incident to simulate.');
      return;
    }

    setIsSimulating(true);
    try {
      const payload = {
        assignmentDelayMinutes: Number(delayMinutes) || 0,
        targetTeam: targetTeam || undefined,
        targetEngineerId: targetEngineerId || undefined,
        simulatedPriority: simulatedPriority || undefined,
        simulatedResolutionPaceMultiplier: Number(paceMultiplier) || 1.0,
      };

      const res = await incidentApi.simulateWhatIf(selectedIncidentId, payload);
      if (res.success) {
        setSimulationResult(res.simulation);
        showSuccess('Hypothetical simulation executed successfully.');
      }
    } catch (err) {
      showError(err.message || 'What-If simulation failed.');
    } finally {
      setIsSimulating(false);
    }
  };

  // 4. Apply Scenario to Live Incident (Manager or Authorized Engineer confirmation)
  const handleApplyToLive = async () => {
    if (!selectedIncidentId) return;
    setIsApplyingLive(true);
    try {
      const res = await incidentApi.reassign(selectedIncidentId, {
        assignedTeam: targetTeam,
        assigneeId: targetEngineerId || null,
        reason:
          reassignReason.trim() ||
          `Approved assignment via Workload & What-If Simulator (Target Team: ${targetTeam})`,
      });

      if (res.success) {
        showSuccess('Live incident assignment updated successfully!');
        setShowConfirmModal(false);
        setReassignReason('');
        // Refresh workload and re-fetch incident
        await fetchWorkloadData(true);
      }
    } catch (err) {
      showError(err.message || 'Failed to update live incident.');
    } finally {
      setIsApplyingLive(false);
    }
  };

  // Filtered roster calculation
  const filteredRoster = workload.engineerRoster.filter((eng) => {
    if (rosterTeamFilter !== 'ALL' && eng.team !== rosterTeamFilter) return false;
    if (rosterStatusFilter !== 'ALL' && eng.availabilityStatus !== rosterStatusFilter) return false;
    return true;
  });

  const selectedIncident = activeIncidents.find((i) => i._id === selectedIncidentId);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Page Header */}
      <PageHeader
        title="Workload-Aware Assignment & What-If Simulator"
        subtitle="Operational team queues, capacity saturation, deterministic responder scoring, and non-mutating SLA simulation"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => fetchWorkloadData(true)}
              disabled={refreshing || loading}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.825rem' }}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh Queues'}
            </button>
          </div>
        }
      />

      {/* Primary Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-neutral)',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          onClick={() => setActiveTab('workload')}
          className={activeTab === 'workload' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
        >
          <Layers size={16} />
          Team Queues & Responder Roster
          <span
            style={{
              padding: '1px 6px',
              borderRadius: '10px',
              backgroundColor: activeTab === 'workload' ? 'rgba(255,255,255,0.2)' : 'var(--bg-subtle)',
              fontSize: '0.72rem',
              fontWeight: 700,
            }}
          >
            {workload.totalActiveIncidents} Active
          </span>
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={activeTab === 'simulator' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
        >
          <Sliders size={16} />
          What-If Incident Simulator & Scoring
          {selectedIncident && (
            <span
              style={{
                padding: '1px 6px',
                borderRadius: '10px',
                backgroundColor: activeTab === 'simulator' ? 'rgba(255,255,255,0.2)' : 'var(--bg-subtle)',
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {selectedIncident.incidentNumber}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ margin: '0 auto 0.75rem auto' }} />
          <div>Loading operational capacity and team queues...</div>
        </div>
      ) : activeTab === 'workload' ? (
        /* ========================================================================= */
        /* TAB 1: WORKLOAD QUEUES & RESPONDER ROSTER                                 */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Section A: Team Queues */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Active Team Queues & Operational Capacity
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Real-time ticket counts, unassigned bottlenecks, and severity distributions across response teams.
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '1rem',
              }}
            >
              {workload.teamQueues.map((team) => (
                <div
                  key={team.id || team.name}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    border: team.unassignedCount > 0 ? '1px solid #FCD34D' : '1px solid var(--border-neutral)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {/* Team Title & Tier */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                          {team.name}
                        </span>
                        <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                          {team.tier || 'Tier 2'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {team.description || 'Core service tier response team'}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {team.activeCount}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        In Queue
                      </div>
                    </div>
                  </div>

                  {/* Unassigned Warning */}
                  {team.unassignedCount > 0 && (
                    <div
                      style={{
                        padding: '0.4rem 0.65rem',
                        backgroundColor: '#FEF3C7',
                        border: '1px solid #FDE68A',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.775rem',
                        color: '#92400E',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                        <AlertTriangle size={13} />
                        {team.unassignedCount} Unassigned Ticket{team.unassignedCount > 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => {
                          const targetInc = activeIncidents.find(
                            (i) => i.assignedTeam === team.name && !i.assignee
                          );
                          if (targetInc) {
                            setSelectedIncidentId(targetInc._id);
                            setActiveTab('simulator');
                          }
                        }}
                        className="btn-subtle"
                        style={{ fontSize: '0.72rem', color: '#92400E', padding: 0, textDecoration: 'underline' }}
                      >
                        Triage Now
                      </button>
                    </div>
                  )}

                  {/* Priority Breakdown Chips */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Severity:
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: team.byPriority.P1 > 0 ? '#FEE2E2' : 'var(--bg-subtle)',
                        color: team.byPriority.P1 > 0 ? '#991B1B' : 'var(--text-secondary)',
                        fontWeight: team.byPriority.P1 > 0 ? 700 : 500,
                      }}
                    >
                      P1: {team.byPriority.P1}
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: team.byPriority.P2 > 0 ? '#FFEDD5' : 'var(--bg-subtle)',
                        color: team.byPriority.P2 > 0 ? '#C2410C' : 'var(--text-secondary)',
                        fontWeight: team.byPriority.P2 > 0 ? 700 : 500,
                      }}
                    >
                      P2: {team.byPriority.P2}
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: team.byPriority.P3 > 0 ? '#FEF3C7' : 'var(--bg-subtle)',
                        color: team.byPriority.P3 > 0 ? '#92400E' : 'var(--text-secondary)',
                      }}
                    >
                      P3: {team.byPriority.P3}
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      P4/P5: {team.byPriority.P4 + team.byPriority.P5}
                    </span>
                  </div>

                  {/* Service Responsibilities */}
                  {team.services && team.services.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Services:</span>
                      {team.services.map((s, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '0.68rem',
                            padding: '1px 5px',
                            backgroundColor: 'var(--bg-subtle)',
                            borderRadius: '3px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Team Members Count */}
                  <div
                    style={{
                      marginTop: 'auto',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--border-neutral)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>{team.memberCount} Authorized Engineers</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Avg Load: {team.memberCount > 0 ? (team.activeCount / team.memberCount).toFixed(1) : 0}/eng
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section B: Responder Roster & Availability */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Responder Roster & Availability Status
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Workload saturation, configured shifts, and technical skills of authorized responder candidates.
                </p>
              </div>

              {/* Roster Filters */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={rosterTeamFilter}
                  onChange={(e) => setRosterTeamFilter(e.target.value)}
                  className="form-select"
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                >
                  <option value="ALL">All Teams</option>
                  {workload.teamQueues.map((t) => (
                    <option key={t.id || t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <select
                  value={rosterStatusFilter}
                  onChange={(e) => setRosterStatusFilter(e.target.value)}
                  className="form-select"
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                >
                  <option value="ALL">All Availability</option>
                  <option value="available">Available</option>
                  <option value="on_call">On-Call Primary</option>
                  <option value="busy">Busy</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>
            </div>

            {/* Roster Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.825rem' }}>
                <thead>
                  <tr>
                    <th>Engineer</th>
                    <th>Team & Role</th>
                    <th>Availability</th>
                    <th>Active Load</th>
                    <th>Saturation Ratio</th>
                    <th>Skills & Responsibilities</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoster.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No engineers found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRoster.map((eng) => {
                      const isOverloaded = eng.openTicketsCount >= eng.maxCapacity;
                      const saturationPct = Math.round((eng.openTicketsCount / eng.maxCapacity) * 100);

                      let availBadgeColor = '#F0FDF4';
                      let availTextColor = '#166534';
                      let availLabel = 'Available';

                      if (eng.availabilityStatus === 'on_call') {
                        availBadgeColor = '#F3E8FF';
                        availTextColor = '#6B21A8';
                        availLabel = 'On-Call Primary';
                      } else if (eng.availabilityStatus === 'busy') {
                        availBadgeColor = '#FEF3C7';
                        availTextColor = '#92400E';
                        availLabel = 'Busy';
                      } else if (eng.availabilityStatus === 'unavailable') {
                        availBadgeColor = '#FEE2E2';
                        availTextColor = '#991B1B';
                        availLabel = 'Unavailable';
                      }

                      return (
                        <tr key={eng.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{eng.name}</div>
                            <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>{eng.email}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500 }}>{eng.team || 'Unassigned Team'}</div>
                            <span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>
                              {eng.role}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                backgroundColor: availBadgeColor,
                                color: availTextColor,
                                display: 'inline-block',
                              }}
                            >
                              {availLabel}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: isOverloaded ? '#DC2626' : 'var(--text-primary)',
                                }}
                              >
                                {eng.openTicketsCount}/{eng.maxCapacity}
                              </span>
                              {eng.criticalTicketsCount > 0 && (
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '1px 5px',
                                    backgroundColor: '#FEE2E2',
                                    color: '#991B1B',
                                    borderRadius: '3px',
                                    fontWeight: 600,
                                  }}
                                  title="Active high-severity P1/P2 incidents"
                                >
                                  {eng.criticalTicketsCount} P1/P2
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ minWidth: '130px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div
                                style={{
                                  flex: 1,
                                  height: '7px',
                                  backgroundColor: 'var(--bg-subtle)',
                                  borderRadius: '4px',
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${Math.min(100, saturationPct)}%`,
                                    backgroundColor:
                                      saturationPct >= 100
                                        ? '#DC2626'
                                        : saturationPct >= 70
                                        ? '#F59E0B'
                                        : '#10B981',
                                    borderRadius: '4px',
                                    transition: 'width 0.3s ease',
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {saturationPct}%
                              </span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              {(eng.skills || []).map((s, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '1px 5px',
                                    backgroundColor: 'var(--bg-subtle)',
                                    borderRadius: '3px',
                                    color: 'var(--text-secondary)',
                                  }}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* TAB 2: WHAT-IF INCIDENT SIMULATOR & CANDIDATE SCORING                     */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Top Banner: Incident Selector & Safe Simulation Mode Notice */}
          <div
            className="card"
            style={{
              borderLeft: '4px solid var(--accent-forest)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <span className="badge badge-preview" style={{ marginBottom: '0.3rem', display: 'inline-block' }}>
                  HYPOTHETICAL SIMULATION SANDBOX
                </span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Interactive What-If Incident Simulator
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Simulate delayed assignments, team transfers, and engineer capacity impact without mutating live records.
                </p>
              </div>

              {/* Incident Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Active Incident:
                </span>
                <select
                  value={selectedIncidentId}
                  onChange={(e) => {
                    setSelectedIncidentId(e.target.value);
                    setSearchParams({ incidentId: e.target.value });
                  }}
                  className="form-select"
                  style={{ minWidth: '240px', fontSize: '0.85rem' }}
                >
                  {activeIncidents.map((inc) => (
                    <option key={inc._id} value={inc._id}>
                      {inc.incidentNumber} - {inc.title.slice(0, 30)} ({inc.priority})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Selected Incident Context Badge Strip */}
            {selectedIncident && (
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'center',
                  padding: '0.65rem 0.85rem',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.825rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Ticket: </span>
                  <strong>{selectedIncident.incidentNumber}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Priority: </span>
                  <PriorityBadge priority={selectedIncident.priority} />
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Service: </span>
                  <strong>{selectedIncident.affectedService || 'Unknown'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Current Team: </span>
                  <strong>{selectedIncident.assignedTeam || 'Unassigned'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Current Assignee: </span>
                  <strong>{selectedIncident.assignee?.name || 'Unassigned'}</strong>
                </div>
                <button
                  onClick={() => navigate(`/incidents/${selectedIncident.incidentNumber || selectedIncident._id}`)}
                  className="btn-subtle"
                  style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--accent-forest)' }}
                >
                  View Incident Detail →
                </button>
              </div>
            )}
          </div>

          {/* Dual Columns: Left = Scored Candidates; Right = What-If Inputs & Output */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) minmax(420px, 1.25fr)', gap: '1.25rem' }}>
            {/* COLUMN 1: CANDIDATE SCORING ENGINE */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Cpu size={16} style={{ color: 'var(--accent-forest)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Deterministic Candidate Scoring
                  </h4>
                </div>
                <span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>
                  {candidates.length} Eligible
                </span>
              </div>

              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-subtle)',
                  padding: '0.5rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.4rem',
                  lineHeight: 1.4,
                }}
              >
                <Info size={14} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--text-muted)' }} />
                <span>
                  <strong>Ethical Boundary:</strong> {candidateMeta?.disclaimer ||
                    'Scoring formula evaluates operational queue bandwidth and skill alignment only. It does not measure individual performance, competency, or productivity.'}
                </span>
              </div>

              {candidatesLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <RefreshCw size={18} className="spin" style={{ margin: '0 auto 0.5rem auto' }} />
                  Computing transparent factor scoring...
                </div>
              ) : candidates.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No active eligible responders found for this service criteria.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {candidates.map((cand) => {
                    const isTop = cand.isRecommended;
                    const bd = cand.scoringBreakdown || {};

                    return (
                      <div
                        key={cand.user.id}
                        style={{
                          border: isTop ? '1.5px solid var(--accent-forest)' : '1px solid var(--border-neutral)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.75rem',
                          backgroundColor: isTop ? 'var(--accent-forest-subtle)' : 'var(--bg-card)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        {/* Candidate Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                #{cand.rank} {cand.user.name}
                              </span>
                              {isTop && (
                                <span className="badge badge-primary" style={{ fontSize: '0.65rem' }}>
                                  #1 Recommended
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                              {cand.user.team} • {cand.user.availabilityStatus}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-forest)' }}>
                              {cand.compositeScore}
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                /100
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                setTargetTeam(cand.user.team);
                                setTargetEngineerId(cand.user.id);
                              }}
                              className="btn btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '0.68rem', marginTop: '2px' }}
                            >
                              Simulate This Responder
                            </button>
                          </div>
                        </div>

                        {/* Factor Score Breakdown */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '0.4rem',
                            fontSize: '0.72rem',
                            backgroundColor: 'var(--bg-surface)',
                            padding: '0.5rem',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Team & Service: </span>
                            <strong>
                              {bd.teamServiceCompatibility?.score || 0}/30
                            </strong>
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                              {bd.teamServiceCompatibility?.evidence}
                            </div>
                          </div>

                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Skills Match: </span>
                            <strong>{bd.skillsMatch?.score || 0}/25</strong>
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                              {bd.skillsMatch?.evidence}
                            </div>
                          </div>

                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Workload Bandwidth: </span>
                            <strong>{bd.workloadBandwidth?.score || 0}/20</strong>
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                              {bd.workloadBandwidth?.evidence}
                            </div>
                          </div>

                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Critical Headroom: </span>
                            <strong>{bd.criticalIncidentsHeadroom?.score || 0}/15</strong>
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                              {bd.criticalIncidentsHeadroom?.evidence}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* COLUMN 2: WHAT-IF SIMULATOR SCENARIO & PROJECTIONS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Scenario Inputs Form */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Sliders size={16} style={{ color: 'var(--accent-forest)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Scenario Configuration Inputs
                  </h4>
                </div>

                <form onSubmit={handleRunSimulation} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {/* Slider: Assignment Delay Minutes */}
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <label className="form-label" style={{ fontSize: '0.78rem', margin: 0 }}>
                        Hypothetical Assignment Delay (Minutes)
                      </label>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: delayMinutes > 30 ? '#DC2626' : 'var(--accent-forest)' }}>
                        +{delayMinutes} minutes
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={180}
                      step={5}
                      value={delayMinutes}
                      onChange={(e) => setDelayMinutes(Number(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      <span>Immediate (0m)</span>
                      <span>30m</span>
                      <span>60m</span>
                      <span>120m</span>
                      <span>180m</span>
                    </div>
                  </div>

                  {/* Dual Grid: Target Team & Target Engineer */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>Target Team</label>
                      <select
                        value={targetTeam}
                        onChange={(e) => setTargetTeam(e.target.value)}
                        className="form-select"
                        style={{ fontSize: '0.8rem' }}
                      >
                        <option value="">(Keep Current Team)</option>
                        {workload.teamQueues.map((t) => (
                          <option key={t.id || t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>Target Responder</label>
                      <select
                        value={targetEngineerId}
                        onChange={(e) => setTargetEngineerId(e.target.value)}
                        className="form-select"
                        style={{ fontSize: '0.8rem' }}
                      >
                        <option value="">(Keep Current Assignee)</option>
                        {workload.engineerRoster.map((eng) => (
                          <option key={eng.id} value={eng.id}>
                            {eng.name} ({eng.team}) [{eng.openTicketsCount}/{eng.maxCapacity}]
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Dual Grid: Simulated Priority & Pace Multiplier */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>Hypothetical Priority</label>
                      <select
                        value={simulatedPriority}
                        onChange={(e) => setSimulatedPriority(e.target.value)}
                        className="form-select"
                        style={{ fontSize: '0.8rem' }}
                      >
                        <option value="P1">P1 - Critical (15m resp / 4h res)</option>
                        <option value="P2">P2 - High (30m resp / 8h res)</option>
                        <option value="P3">P3 - Medium (60m resp / 24h res)</option>
                        <option value="P4">P4 - Low (120m resp / 48h res)</option>
                        <option value="P5">P5 - Minimal (240m resp / 72h res)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>Resolution Pace Factor</label>
                      <select
                        value={paceMultiplier}
                        onChange={(e) => setPaceMultiplier(Number(e.target.value))}
                        className="form-select"
                        style={{ fontSize: '0.8rem' }}
                      >
                        <option value={0.75}>0.75x (Expedited / Swift fix)</option>
                        <option value={1.0}>1.0x (Nominal Expected Pace)</option>
                        <option value={1.5}>1.5x (Delayed / Dependency wait)</option>
                        <option value={2.0}>2.0x (Severe Investigation Drag)</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSimulating}
                    className="btn btn-primary"
                    style={{ width: '100%', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <Zap size={15} />
                    {isSimulating ? 'Executing Simulation Model...' : 'Calculate What-If Scenario'}
                  </button>
                </form>
              </div>

              {/* Simulation Outcomes Output Card */}
              {simulationResult ? (
                <div
                  className="card"
                  style={{
                    border: simulationResult.slaProjections.projectedSlaState === 'Breached'
                      ? '1.5px solid #EF4444'
                      : simulationResult.slaProjections.projectedSlaState === 'At Risk'
                      ? '1.5px solid #F59E0B'
                      : '1.5px solid #10B981',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Activity size={16} style={{ color: 'var(--accent-forest)' }} />
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                        Hypothetical Scenario Projections
                      </h4>
                    </div>

                    {/* Projected SLA State Badge */}
                    <span
                      style={{
                        padding: '2px 10px',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor:
                          simulationResult.slaProjections.projectedSlaState === 'Breached'
                            ? '#FEE2E2'
                            : simulationResult.slaProjections.projectedSlaState === 'At Risk'
                            ? '#FEF3C7'
                            : '#F0FDF4',
                        color:
                          simulationResult.slaProjections.projectedSlaState === 'Breached'
                            ? '#991B1B'
                            : simulationResult.slaProjections.projectedSlaState === 'At Risk'
                            ? '#92400E'
                            : '#166534',
                      }}
                    >
                      Projected SLA: {simulationResult.slaProjections.projectedSlaState}
                    </span>
                  </div>

                  {/* Warnings Banner */}
                  {simulationResult.workloadImpact.queueWarnings?.length > 0 && (
                    <div
                      style={{
                        padding: '0.5rem 0.75rem',
                        backgroundColor: '#FEF3C7',
                        border: '1px solid #FDE68A',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        color: '#92400E',
                      }}
                    >
                      {simulationResult.workloadImpact.queueWarnings.map((w, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SLA Deadlines & Breach Check */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.75rem',
                      fontSize: '0.78rem',
                      backgroundColor: 'var(--bg-subtle)',
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Response Target ({simulationResult.slaProjections.responseTargetMinutes}m)
                      </div>
                      <div>
                        Deadline: {new Date(simulationResult.slaProjections.responseDeadline).toLocaleTimeString()}
                      </div>
                      <div>
                        Simulated Ack:{' '}
                        {new Date(simulationResult.slaProjections.simulatedAcknowledgementAt).toLocaleTimeString()}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          marginTop: '2px',
                          color: simulationResult.slaProjections.wouldBreachResponse ? '#DC2626' : '#166534',
                        }}
                      >
                        {simulationResult.slaProjections.wouldBreachResponse
                          ? `⚠️ BREACHED (+${simulationResult.slaProjections.responseBreachMarginMinutes}m)`
                          : '✓ Met on schedule'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Resolution Target ({simulationResult.slaProjections.resolutionTargetMinutes}m)
                      </div>
                      <div>
                        Deadline: {new Date(simulationResult.slaProjections.resolutionDeadline).toLocaleTimeString()}
                      </div>
                      <div>
                        Simulated Fix:{' '}
                        {new Date(simulationResult.slaProjections.simulatedResolvedAt).toLocaleTimeString()}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          marginTop: '2px',
                          color: simulationResult.slaProjections.wouldBreachResolution ? '#DC2626' : '#166534',
                        }}
                      >
                        {simulationResult.slaProjections.wouldBreachResolution
                          ? `⚠️ BREACHED (+${simulationResult.slaProjections.resolutionBreachMarginMinutes}m)`
                          : '✓ Met on schedule'}
                      </div>
                    </div>
                  </div>

                  {/* Workload Queue Shifts (Blast Radius) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.78rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Workload Queue Blast Radius:
                    </div>

                    {simulationResult.workloadImpact.targetAssignee && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border-neutral)' }}>
                        <span>Target Assignee ({simulationResult.workloadImpact.targetAssignee.name}):</span>
                        <strong>
                          {simulationResult.workloadImpact.targetAssignee.openTicketsBefore} →{' '}
                          {simulationResult.workloadImpact.targetAssignee.openTicketsAfter} tickets{' '}
                          (Max {simulationResult.workloadImpact.targetAssignee.maxCapacity})
                        </strong>
                      </div>
                    )}

                    {simulationResult.workloadImpact.teamQueues?.targetTeam && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border-neutral)' }}>
                        <span>Target Team Queue ({simulationResult.workloadImpact.teamQueues.targetTeam.name}):</span>
                        <strong>
                          {simulationResult.workloadImpact.teamQueues.targetTeam.openTicketsBefore} →{' '}
                          {simulationResult.workloadImpact.teamQueues.targetTeam.openTicketsAfter} tickets
                        </strong>
                      </div>
                    )}
                  </div>

                  {/* Apply Permitted Action Button */}
                  {user?.role !== 'end_user' && (
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-neutral)' }}>
                      <button
                        type="button"
                        onClick={() => setShowConfirmModal(true)}
                        className="btn btn-secondary"
                        style={{ width: '100%', fontSize: '0.825rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                      >
                        <UserCheck size={14} />
                        Apply Scenario Assignment to Production Incident
                      </button>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.35rem' }}>
                        Requires explicit manager/responder approval. Live database remains unchanged until confirmed.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <Sliders size={20} style={{ margin: '0 auto 0.5rem auto' }} />
                  <div>Select scenario parameters and click <strong>Calculate What-If Scenario</strong> to project SLA and workload impact.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Commit Assignment to Live Incident */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '480px',
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              backgroundColor: 'var(--bg-card)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={18} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                Confirm Live Incident Reassignment
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              You are applying this simulated scenario to the live production record for incident{' '}
              <strong>{selectedIncident?.incidentNumber}</strong>.
            </p>

            <div style={{ backgroundColor: 'var(--bg-subtle)', padding: '0.65rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
              <div>Assigned Team: <strong>{targetTeam || '(Unchanged)'}</strong></div>
              <div>Assigned Responder ID: <strong>{targetEngineerId || '(Unassigned)'}</strong></div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Audit Reason</label>
              <input
                type="text"
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="e.g. Reassigned per What-If simulation optimization"
                className="form-input"
                style={{ fontSize: '0.8rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="btn btn-secondary"
                disabled={isApplyingLive}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyToLive}
                className="btn btn-primary"
                disabled={isApplyingLive}
              >
                {isApplyingLive ? 'Applying...' : 'Confirm Live Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
