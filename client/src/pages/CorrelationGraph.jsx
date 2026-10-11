import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import LoadingState from '../components/common/LoadingState';
import ErrorState from '../components/common/ErrorState';
import PriorityBadge from '../components/common/PriorityBadge';
import StatusBadge from '../components/common/StatusBadge';
import { correlationApi } from '../services/api';
import { subscribeToEvent } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  GitBranch,
  Rocket,
  Server,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  SlidersHorizontal,
  Info,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronRight,
} from 'lucide-react';

export default function CorrelationGraph() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useToast();

  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [windowHours, setWindowHours] = useState(48);
  const [minScore, setMinScore] = useState(0.25);
  const [serviceFilter, setServiceFilter] = useState('all');

  // Interactive Selection
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [activeClusterId, setActiveClusterId] = useState(null);
  const [viewMode, setViewMode] = useState('graph'); // 'graph' or 'table'

  // Decision Modal / Form State
  const [decisionRationale, setDecisionRationale] = useState('');
  const [rootCauseText, setRootCauseText] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);

  const canInvestigate = ['support_engineer', 'manager', 'admin'].includes(user?.role);

  const fetchGraph = useCallback(async (isBg = false) => {
    if (!isBg) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await correlationApi.getGraph({
        windowHours,
        minScore,
        service: serviceFilter,
      });

      if (res.graph) {
        setGraphData(res.graph);
      }
    } catch (err) {
      console.error('Failed to load correlation topology:', err);
      setError(err.message || 'Unable to compute correlation graph.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [windowHours, minScore, serviceFilter]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Live Socket.IO Updates
  useEffect(() => {
    const unsubDec = subscribeToEvent('correlation:decision_recorded', () => {
      fetchGraph(true);
    });
    const unsubInc = subscribeToEvent('incident:created', () => {
      fetchGraph(true);
    });
    const unsubDep = subscribeToEvent('deployment:created', () => {
      fetchGraph(true);
    });

    return () => {
      unsubDec();
      unsubInc();
      unsubDep();
    };
  }, [fetchGraph]);

  // Derived selected items
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graphData) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId);
  }, [selectedNodeId, graphData]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId || !graphData) return null;
    return graphData.edges.find((e) => e.id === selectedEdgeId);
  }, [selectedEdgeId, graphData]);

  // Record an engineer decision on an edge
  const handleRecordDecision = async (decisionType, isRootCause = false) => {
    if (!selectedEdge) return;

    setIsSubmittingDecision(true);
    try {
      const sourceNode = graphData.nodes.find((n) => n.id === selectedEdge.source);
      const targetNode = graphData.nodes.find((n) => n.id === selectedEdge.target);

      let sourceIncidentId = null;
      let targetIncidentId = null;
      let deploymentId = null;

      if (sourceNode.type === 'incident') sourceIncidentId = sourceNode.id;
      if (targetNode.type === 'incident') {
        if (!sourceIncidentId) sourceIncidentId = targetNode.id;
        else targetIncidentId = targetNode.id;
      }
      if (sourceNode.type === 'deployment') deploymentId = sourceNode.id;
      if (targetNode.type === 'deployment') deploymentId = targetNode.id;

      if (!sourceIncidentId) {
        showError('Unable to map source incident for this relationship.');
        return;
      }

      await correlationApi.submitDecision({
        sourceIncidentId,
        targetIncidentId,
        deploymentId,
        decision: decisionType,
        isRootCause,
        verifiedRootCause: rootCauseText || (isRootCause ? 'Engineer confirmed as primary failure cause.' : ''),
        rationale: decisionRationale || `Decision ${decisionType} confirmed by responder.`,
      });

      showSuccess(`Relationship updated: ${decisionType.toUpperCase()}${isRootCause ? ' (Verified Root Cause)' : ''}`);
      setDecisionRationale('');
      setRootCauseText('');
      fetchGraph(true);
    } catch (err) {
      showError(err.message || 'Failed to record correlation decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  // Node position layout calculation (deterministic circle / tiered layout)
  const layoutNodes = useMemo(() => {
    if (!graphData?.nodes?.length) return [];

    const nodes = graphData.nodes;
    const services = nodes.filter((n) => n.type === 'service');
    const deployments = nodes.filter((n) => n.type === 'deployment');
    const incidents = nodes.filter((n) => n.type === 'incident');
    const resolutions = nodes.filter((n) => n.type === 'resolution');

    const positioned = [];
    const width = 800;
    const height = 480;

    // Services in center column/arc
    services.forEach((s, idx) => {
      const x = width * 0.5;
      const y = 80 + (idx * (height - 140)) / Math.max(1, services.length - 1 || 1);
      positioned.push({ ...s, x, y });
    });

    // Deployments on the left tier
    deployments.forEach((d, idx) => {
      const x = width * 0.18;
      const y = 90 + (idx * (height - 160)) / Math.max(1, deployments.length - 1 || 1);
      positioned.push({ ...d, x, y });
    });

    // Incidents on the right tier
    incidents.forEach((inc, idx) => {
      const x = width * 0.82;
      const y = 70 + (idx * (height - 120)) / Math.max(1, incidents.length - 1 || 1);
      positioned.push({ ...inc, x, y });
    });

    // Historical resolutions on bottom right
    resolutions.forEach((r, idx) => {
      const x = width * 0.82;
      const y = height - 50 + idx * 30;
      positioned.push({ ...r, x, y });
    });

    return positioned;
  }, [graphData]);

  const nodeMap = useMemo(() => {
    const map = new Map();
    layoutNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [layoutNodes]);

  if (loading && !graphData) {
    return <LoadingState message="Aggregating blast radius topology and computing correlation edges..." />;
  }

  if (error && !graphData) {
    return <ErrorState message={error} onRetry={() => fetchGraph()} />;
  }

  return (
    <div>
      <PageHeader
        title="Incident Correlation & Deployment Blast Radius Graph"
        subtitle="Deterministic cross-service dependency tracing, preceding deployment analysis, and cluster verification"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setViewMode(viewMode === 'graph' ? 'table' : 'graph')}
              className="btn btn-secondary"
            >
              {viewMode === 'graph' ? 'Cluster Table View' : 'Interactive Graph View'}
            </button>
            <button
              onClick={() => fetchGraph(true)}
              className="btn btn-secondary"
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Evaluating...' : 'Re-sync'}
            </button>
          </div>
        }
      />

      {/* Control & Filter Ribbon */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          padding: '0.75rem 1rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              WINDOW:
            </label>
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(parseInt(e.target.value, 10))}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value={12}>Last 12 Hours</option>
              <option value={24}>Last 24 Hours</option>
              <option value={48}>Last 48 Hours</option>
              <option value={168}>Last 7 Days</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              MIN CONFIDENCE:
            </label>
            <select
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value))}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value={0.25}>Low (≥25%)</option>
              <option value={0.45}>Medium (≥45%)</option>
              <option value={0.70}>High (≥70%)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
              SERVICE:
            </label>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="form-control"
              style={{ display: 'inline-block', width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.825rem' }}
            >
              <option value="all">All Services</option>
              <option value="ingress-gateway">ingress-gateway</option>
              <option value="payments-service">payments-service</option>
              <option value="order-processing">order-processing</option>
              <option value="database-cluster">database-cluster</option>
              <option value="auth-service">auth-service</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
          <span>Nodes: <strong>{graphData?.nodes?.length ?? 0}</strong></span>
          <span>Edges: <strong>{graphData?.edges?.length ?? 0}</strong></span>
          <span>Clusters: <strong>{graphData?.clusters?.length ?? 0}</strong></span>
        </div>
      </div>

      {/* Main Graph & Inspection Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Graph Canvas / SVG View */}
        <div className="card" style={{ padding: '0.5rem', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem' }}>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#3B82F6', borderRadius: '50%' }} /> Deployment
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#10B981', borderRadius: '3px' }} /> Service
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#EF4444', borderRadius: '50%' }} /> Incident
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Click nodes or edges to inspect evidence
            </span>
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              minHeight: '480px',
              backgroundColor: '#FAFAF9',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-neutral)',
            }}
          >
            <svg
              viewBox="0 0 800 480"
              style={{ width: '100%', height: '100%', minHeight: '480px', display: 'block' }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
                </marker>
                <marker
                  id="arrow-confirmed"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#15803D" />
                </marker>
                <marker
                  id="arrow-root"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#DC2626" />
                </marker>
              </defs>

              {/* Render Edges */}
              {graphData?.edges?.map((edge) => {
                const src = nodeMap.get(edge.source);
                const tgt = nodeMap.get(edge.target);
                if (!src || !tgt) return null;

                const isSelected = selectedEdgeId === edge.id;
                const isRoot = edge.relationshipType === 'verified_root_cause' || edge.isRootCause;
                const isConfirmed = edge.relationshipType === 'confirmed_relationship' || edge.status === 'confirmed';

                let strokeColor = '#CBD5E1';
                let strokeWidth = 1.5;
                let strokeDash = undefined;
                let marker = 'url(#arrow)';

                if (isRoot) {
                  strokeColor = '#DC2626';
                  strokeWidth = 3;
                  marker = 'url(#arrow-root)';
                } else if (isConfirmed) {
                  strokeColor = '#15803D';
                  strokeWidth = 2.5;
                  marker = 'url(#arrow-confirmed)';
                } else if (edge.relationshipType === 'preceding_deployment') {
                  strokeColor = '#F59E0B';
                  strokeWidth = 2;
                } else if (edge.relationshipType === 'service_dependency') {
                  strokeColor = '#94A3B8';
                  strokeDash = '4 3';
                }

                if (isSelected) {
                  strokeWidth += 2;
                  strokeColor = '#4F46E5';
                }

                const midX = (src.x + tgt.x) / 2;
                const midY = (src.y + tgt.y) / 2;

                return (
                  <g
                    key={edge.id}
                    onClick={() => {
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDash}
                      markerEnd={marker}
                    />
                    {edge.confidenceScore && edge.confidenceScore < 1.0 && (
                      <g transform={`translate(${midX}, ${midY})`}>
                        <rect
                          x="-22"
                          y="-10"
                          width="44"
                          height="20"
                          rx="4"
                          fill="#FFFFFF"
                          stroke={isSelected ? '#4F46E5' : strokeColor}
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="4"
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="700"
                          fill={isRoot ? '#DC2626' : isConfirmed ? '#15803D' : '#475569'}
                        >
                          {Math.round(edge.confidenceScore * 100)}%
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Render Nodes */}
              {layoutNodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                const isService = node.type === 'service';
                const isDeploy = node.type === 'deployment';
                const isIncident = node.type === 'incident';
                const isResolution = node.type === 'resolution';

                let fill = '#FFFFFF';
                let stroke = '#64748B';

                if (isService) {
                  fill = '#ECFDF5';
                  stroke = '#059669';
                } else if (isDeploy) {
                  fill = node.status === 'failed' ? '#FEF2F2' : '#EFF6FF';
                  stroke = node.status === 'failed' ? '#DC2626' : '#2563EB';
                } else if (isIncident) {
                  fill = node.priority === 'P1' ? '#FEF2F2' : node.priority === 'P2' ? '#FFFBEB' : '#F8FAFC';
                  stroke = node.priority === 'P1' ? '#DC2626' : node.priority === 'P2' ? '#D97706' : '#475569';
                } else if (isResolution) {
                  fill = '#F5F3FF';
                  stroke = '#7C3AED';
                }

                if (isSelected) {
                  stroke = '#4F46E5';
                }

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      setSelectedEdgeId(null);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {isService ? (
                      <rect
                        x="-50"
                        y="-18"
                        width="100"
                        height="36"
                        rx="6"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? '3' : '1.5'}
                      />
                    ) : isDeploy ? (
                      <rect
                        x="-40"
                        y="-16"
                        width="80"
                        height="32"
                        rx="16"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? '3' : '1.5'}
                      />
                    ) : (
                      <rect
                        x="-45"
                        y="-18"
                        width="90"
                        height="36"
                        rx="6"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? '3' : '1.5'}
                      />
                    )}

                    <text
                      x="0"
                      y={isIncident ? '-3' : '4'}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="700"
                      fill="#1E293B"
                    >
                      {node.label}
                    </text>

                    {isIncident && (
                      <text
                        x="0"
                        y="10"
                        textAnchor="middle"
                        fontSize="8"
                        fill="#64748B"
                      >
                        {node.priority} • {node.status}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right Inspection & Workflow Drawer */}
        <div>
          {/* Selected Edge (Relationship & Investigation Action) */}
          {selectedEdge && (
            <div className="card" style={{ marginBottom: '1.25rem', border: '1px solid #C7D2FE' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Relationship Evidence</h3>
                <span
                  className="badge"
                  style={{
                    backgroundColor:
                      selectedEdge.status === 'confirmed'
                        ? '#DCFCE7'
                        : selectedEdge.status === 'rejected'
                        ? '#FEE2E2'
                        : '#FEF3C7',
                    color:
                      selectedEdge.status === 'confirmed'
                        ? '#166534'
                        : selectedEdge.status === 'rejected'
                        ? '#991B1B'
                        : '#92400E',
                  }}
                >
                  {selectedEdge.isRootCause
                    ? 'VERIFIED ROOT CAUSE'
                    : selectedEdge.status.toUpperCase()}
                </span>
              </div>

              <div style={{ fontSize: '0.825rem', marginBottom: '0.75rem' }}>
                Confidence Score:{' '}
                <strong>{Math.round(selectedEdge.confidenceScore * 100)}% ({selectedEdge.confidenceTier})</strong>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  CONTRIBUTING FACTORS:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {(selectedEdge.contributingFactors || []).map((f, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.4rem 0.6rem',
                        backgroundColor: 'var(--bg-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.775rem',
                      }}
                    >
                      <strong style={{ color: 'var(--text-primary)' }}>{f.factor.replace(/_/g, ' ')}</strong> (+{f.weight})
                      <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>{f.evidence}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Investigation Workflow Actions */}
              {canInvestigate && (
                <div style={{ borderTop: '1px solid var(--border-neutral)', paddingTop: '0.75rem' }}>
                  <h4 style={{ fontSize: '0.85rem', margin: 0, marginBottom: '0.5rem' }}>
                    Record Investigation Decision
                  </h4>

                  <input
                    type="text"
                    placeholder="Decision rationale or investigation notes..."
                    value={decisionRationale}
                    onChange={(e) => setDecisionRationale(e.target.value)}
                    className="form-control"
                    style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}
                  />

                  {selectedEdge.relationshipType === 'preceding_deployment' && (
                    <input
                      type="text"
                      placeholder="Root cause summary (if deployment was root cause)..."
                      value={rootCauseText}
                      onChange={(e) => setRootCauseText(e.target.value)}
                      className="form-control"
                      style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}
                    />
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handleRecordDecision('confirmed', false)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                      disabled={isSubmittingDecision}
                    >
                      <CheckCircle2 size={13} style={{ color: '#166534' }} /> Confirm Link
                    </button>
                    <button
                      onClick={() => handleRecordDecision('rejected', false)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                      disabled={isSubmittingDecision}
                    >
                      <XCircle size={13} style={{ color: '#991B1B' }} /> Reject
                    </button>
                    <button
                      onClick={() => handleRecordDecision('confirmed', true)}
                      className="btn btn-primary"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                      disabled={isSubmittingDecision}
                    >
                      <ShieldCheck size={13} /> Mark Root Cause
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Selected Node Details */}
          {selectedNode && (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Node Details</h3>
                <span className="badge badge-neutral">{selectedNode.type.toUpperCase()}</span>
              </div>

              {selectedNode.type === 'incident' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{selectedNode.label}</span>
                    <PriorityBadge priority={selectedNode.priority} />
                    <StatusBadge status={selectedNode.status} />
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {selectedNode.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    Service: <strong>{selectedNode.service}</strong> • Declared:{' '}
                    {new Date(selectedNode.createdAt).toLocaleString()}
                  </div>
                  <button
                    onClick={() => navigate(`/incidents/${selectedNode.id}`)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.775rem', width: '100%', justifyContent: 'center' }}
                  >
                    Open Incident Command Center <ArrowRight size={13} />
                  </button>
                </div>
              )}

              {selectedNode.type === 'deployment' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <Rocket size={16} style={{ color: '#2563EB' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{selectedNode.label}</span>
                    <span className="badge badge-neutral">{selectedNode.environment}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    {selectedNode.changeSummary}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Service: <strong>{selectedNode.service}</strong> • Status: <strong>{selectedNode.status}</strong>
                  </div>
                  {selectedNode.changeReference && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Ref: <code>{selectedNode.changeReference}</code>
                    </div>
                  )}
                </div>
              )}

              {selectedNode.type === 'service' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <Server size={16} style={{ color: '#059669' }} />
                    <strong style={{ fontSize: '0.9rem' }}>{selectedNode.label}</strong>
                  </div>
                  <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Downstream Dependencies:
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {(selectedNode.dependencies || []).length === 0 ? (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>No downstream service dependencies</span>
                    ) : (
                      selectedNode.dependencies.map((d) => (
                        <span key={d} className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                          {d}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Suspected Incident Clusters */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Layers size={16} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Suspected Incident Clusters</h3>
              </div>
              <span className="badge badge-neutral">{graphData?.clusters?.length ?? 0}</span>
            </div>

            <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Clusters grouped by shared services, dependencies, and cascade signatures:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(graphData?.clusters || []).length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>
                  No multi-incident cascading clusters detected in this window.
                </div>
              ) : (
                graphData.clusters.map((c) => (
                  <div
                    key={c.clusterId}
                    style={{
                      padding: '0.6rem 0.8rem',
                      backgroundColor: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-neutral)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <strong style={{ fontSize: '0.825rem' }}>{c.clusterId.toUpperCase()}</strong>
                      <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                        {c.memberCount} Tickets
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      Services: {c.services.join(', ')}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {c.incidents.map((inc) => (
                        <button
                          key={inc.id}
                          onClick={() => setSelectedNodeId(inc.id.toString())}
                          className="btn btn-subtle"
                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.72rem' }}
                        >
                          {inc.incidentNumber}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
