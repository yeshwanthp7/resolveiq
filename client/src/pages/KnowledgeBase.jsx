import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/common/PageHeader';
import SearchInput from '../components/common/SearchInput';
import { PREVIEW_KNOWLEDGE_BASE } from '../data/previewData';
import { incidentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Flag,
  RotateCcw,
  BarChart2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Layers,
  X,
  Info,
} from 'lucide-react';

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('browse'); // 'browse' | 'analytics'
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // Live verified historical resolutions from MongoDB
  const [verifiedCases, setVerifiedCases] = useState([]);
  const [learningLoopMeta, setLearningLoopMeta] = useState(null);
  const [loadingLive, setLoadingLive] = useState(false);

  // Flag Outdated Modal state
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [selectedResolutionForFlag, setSelectedResolutionForFlag] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [isSubmittingFlag, setIsSubmittingFlag] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // 1. Fetch live verified resolutions
  const loadVerifiedResolutions = useCallback(async () => {
    setLoadingLive(true);
    try {
      const res = await incidentApi.searchKnowledgeBase({ q: searchQuery, limit: 10 });
      if (res.success && Array.isArray(res.candidates)) {
        setVerifiedCases(res.candidates);
        setLearningLoopMeta(res.learningLoop || null);
      }
    } catch (err) {
      setVerifiedCases([]);
    } finally {
      setLoadingLive(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadVerifiedResolutions();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadVerifiedResolutions]);

  // 2. Fetch feedback analytics for Phase 10
  const loadFeedbackAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const res = await incidentApi.getFeedbackAnalytics();
      if (res.success) {
        setAnalytics(res.analytics);
      }
    } catch (err) {
      // Analytics might be restricted to responders
    } finally {
      setLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadFeedbackAnalytics();
    }
  }, [activeTab, loadFeedbackAnalytics]);

  // 3. Handle Flagging as Outdated
  const handleOpenFlagModal = (resItem) => {
    setSelectedResolutionForFlag(resItem);
    setFlagReason('');
    setFlagModalOpen(true);
  };

  const handleConfirmFlagOutdated = async (e) => {
    e.preventDefault();
    if (!selectedResolutionForFlag) return;
    setIsSubmittingFlag(true);
    try {
      const res = await incidentApi.flagResolution(
        selectedResolutionForFlag.incidentNumber || selectedResolutionForFlag.incidentId,
        { reason: flagReason.trim() || 'Flagged as outdated by engineer' }
      );
      if (res.success) {
        showSuccess('Resolution marked as outdated. Ranking penalty applied.');
        setFlagModalOpen(false);
        loadVerifiedResolutions();
        loadFeedbackAnalytics();
      }
    } catch (err) {
      showError(err.message || 'Failed to flag resolution.');
    } finally {
      setIsSubmittingFlag(false);
    }
  };

  // 4. Handle Re-verifying (Unflagging)
  const handleUnflag = async (targetId) => {
    try {
      const res = await incidentApi.unflagResolution(targetId);
      if (res.success) {
        showSuccess('Resolution re-verified and returned to normal ranking.');
        loadVerifiedResolutions();
        loadFeedbackAnalytics();
      }
    } catch (err) {
      showError(err.message || 'Failed to re-verify resolution.');
    }
  };

  const handleCopy = (id, steps) => {
    const textToCopy = Array.isArray(steps) ? steps.join('\n') : String(steps);
    navigator.clipboard?.writeText(textToCopy);
    setCopiedId(id);
    showSuccess('Procedure steps copied to clipboard.');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredPreview = PREVIEW_KNOWLEDGE_BASE.filter((kb) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      kb.title.toLowerCase().includes(q) ||
      kb.service.toLowerCase().includes(q) ||
      kb.category.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Knowledge Base & Resolution Learning Loop"
        subtitle="Searchable repository of engineer-confirmed historical resolutions and outcome-driven learning analytics"
        badge={
          <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ShieldCheck size={12} /> VERIFIED KNOWLEDGE BASE
          </span>
        }
      />

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-neutral)',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          onClick={() => setActiveTab('browse')}
          className={activeTab === 'browse' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
        >
          <BookOpen size={16} />
          Verified Resolutions & Runbooks
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={activeTab === 'analytics' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
        >
          <BarChart2 size={16} />
          Resolution Learning Loop & Quality Analytics
        </button>
      </div>

      {activeTab === 'browse' ? (
        <>
          <div style={{ maxWidth: '480px' }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search verified resolutions by error, service, or keyword..."
            />
          </div>

          {/* Section 1: Live Verified Historical Resolutions from Closed Incidents */}
          {verifiedCases.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={18} style={{ color: '#16A34A' }} />
                  <h3 style={{ fontSize: '1.05rem', margin: 0 }}>
                    Verified Historical Resolutions ({verifiedCases.length})
                  </h3>
                </div>

                {learningLoopMeta && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Ranking: <strong>Deterministic Outcome-Weighted</strong>
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {verifiedCases.map((vc) => {
                  const isOutdated = vc.isOutdated;
                  const outcomes = vc.feedbackOutcomes || {};

                  return (
                    <div
                      key={vc.incidentNumber}
                      className="card"
                      style={{
                        borderLeft: isOutdated ? '4px solid #DC2626' : '4px solid #16A34A',
                        backgroundColor: isOutdated ? 'rgba(254, 242, 242, 0.4)' : 'var(--bg-card)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                            {isOutdated ? (
                              <span
                                className="badge"
                                style={{ backgroundColor: '#FEE2E2', color: '#991B1B', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                              >
                                <AlertTriangle size={11} /> OUTDATED PRECEDENT (PENALIZED)
                              </span>
                            ) : (
                              <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                                CONFIRMED RESOLUTION
                              </span>
                            )}
                            <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                              {vc.rootCauseCategory}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Service: <strong>{vc.affectedService}</strong>
                            </span>

                            {/* Learning Loop Outcome Badges */}
                            {outcomes.successCount > 0 && (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  backgroundColor: '#F0FDF4',
                                  color: '#166534',
                                  fontWeight: 600,
                                }}
                                title="Confirmed successful applications in production"
                              >
                                ✓ {outcomes.successCount} Worked (+Boosted)
                              </span>
                            )}
                            {outcomes.failureCount > 0 && (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  backgroundColor: '#FEF2F2',
                                  color: '#991B1B',
                                  fontWeight: 600,
                                }}
                                title="Reported failures or rejections"
                              >
                                ✕ {outcomes.failureCount} Failed
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <button
                              onClick={() => navigate(`/incidents/${vc.incidentNumber}`)}
                              className="btn-subtle"
                              style={{ padding: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--accent-forest)' }}
                            >
                              {vc.incidentNumber}
                            </button>
                            <span style={{ fontSize: '1rem', fontWeight: 600 }}>— {vc.title}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {vc.similarityScore !== undefined && (
                            <span
                              className="badge badge-primary"
                              style={{ fontSize: '0.7rem' }}
                              title="TF-IDF Cosine Similarity adjusted by verified feedback"
                            >
                              Score: {Math.round(vc.similarityScore * 100)}%
                            </span>
                          )}

                          <button
                            onClick={() => handleCopy(vc.incidentNumber, vc.remediationSteps)}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                          >
                            {copiedId === vc.incidentNumber ? <Check size={13} style={{ color: 'var(--accent-forest)' }} /> : <Copy size={13} />}
                            <span>{copiedId === vc.incidentNumber ? 'Copied' : 'Copy Remediation'}</span>
                          </button>

                          {user?.role !== 'end_user' && (
                            isOutdated ? (
                              (user?.role === 'manager' || user?.role === 'admin') && (
                                <button
                                  onClick={() => handleUnflag(vc.incidentNumber || vc.incidentId)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.72rem', padding: '0.35rem 0.55rem' }}
                                  title="Re-verify resolution and clear outdated flag"
                                >
                                  <RotateCcw size={12} />
                                  <span>Re-verify</span>
                                </button>
                              )
                            ) : (
                              <button
                                onClick={() => handleOpenFlagModal(vc)}
                                className="btn btn-secondary"
                                style={{ fontSize: '0.72rem', padding: '0.35rem 0.55rem', color: '#B43B3B' }}
                                title="Flag this resolution as outdated or disputed"
                              >
                                <Flag size={12} />
                                <span>Flag Outdated</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {isOutdated && vc.outdatedReason && (
                        <div
                          style={{
                            fontSize: '0.775rem',
                            color: '#991B1B',
                            backgroundColor: '#FEE2E2',
                            padding: '0.4rem 0.65rem',
                            borderRadius: 'var(--radius-sm)',
                            marginBottom: '0.5rem',
                          }}
                        >
                          <strong>Outdated Notice:</strong> {vc.outdatedReason}
                        </div>
                      )}

                      <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                        {vc.summary}
                      </p>

                      {vc.remediationSteps?.length > 0 && (
                        <div
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            border: '1px solid var(--border-neutral)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.75rem 1rem',
                            marginBottom: '0.5rem',
                          }}
                        >
                          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                            Verified Remediation Steps Applied
                          </div>
                          <ol style={{ paddingLeft: '1.25rem', margin: 0, fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                            {vc.remediationSteps.map((step, idx) => (
                              <li key={idx}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {vc.matchingEvidence?.length > 0 && (
                        <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                          Matching Evidence Signals: <em>{vc.matchingEvidence.join(', ')}</em>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Standard Operating Runbooks */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <BookOpen size={18} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Standard Operating Runbooks & Procedures</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {filteredPreview.map((kb) => (
                <div key={kb.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.65rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span className="badge badge-neutral">{kb.category}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Service: <strong>{kb.service}</strong>
                        </span>
                      </div>
                      <h3 style={{ fontSize: '1.05rem', margin: 0 }}>{kb.title}</h3>
                    </div>

                    <button
                      onClick={() => handleCopy(kb.id, kb.steps)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                      title="Copy steps to clipboard"
                    >
                      {copiedId === kb.id ? <Check size={13} style={{ color: 'var(--accent-forest)' }} /> : <Copy size={13} />}
                      <span>{copiedId === kb.id ? 'Copied' : 'Copy Steps'}</span>
                    </button>
                  </div>

                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    {kb.summary}
                  </p>

                  <div
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      border: '1px solid var(--border-neutral)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      <Terminal size={14} /> Execution Procedure
                    </div>
                    <ol style={{ paddingLeft: '1.25rem', fontSize: '0.825rem', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {kb.steps.map((step, idx) => (
                        <li key={idx} style={{ fontFamily: step.includes('kubectl') || step.includes('db.') ? 'var(--font-mono)' : 'inherit' }}>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* ========================================================================= */
        /* TAB 2: RESOLUTION LEARNING LOOP & QUALITY ANALYTICS                       */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Informative Explanation Notice */}
          <div
            className="card"
            style={{
              borderLeft: '4px solid var(--accent-forest)',
              backgroundColor: 'var(--accent-forest-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={18} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                Deterministic Learning Loop Architecture
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              ResolveIQ improves its retrieval and ranking behavior deterministically using engineer-validated outcomes:
              verified successful resolutions receive an algorithmic ranking preference (+0.05 to +0.15 boost), while rejected
              or outdated resolutions are penalized.
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              🔒 <strong>AI Integrity Principle:</strong> The underlying Google Gemini model is <em>never</em> automatically retrained from unreviewed feedback. Learning is strictly applied through application-level retrieval scoring adjustments.
            </div>
          </div>

          {loadingAnalytics ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading learning loop analytics...
            </div>
          ) : analytics ? (
            <>
              {/* Metric Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                }}
              >
                <div className="card">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Reviewed Recommendations
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--text-primary)' }}>
                    {analytics.recommendationsReviewed}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Total human-in-the-loop decisions
                  </div>
                </div>

                <div className="card">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Acceptance Rate
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: '#166534' }}>
                    {analytics.acceptanceRate}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {analytics.acceptanceCount} accepted • {analytics.editedCount} custom edited
                  </div>
                </div>

                <div className="card">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Remediation Fix Success Rate
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--accent-forest)' }}>
                    {analytics.verifiedResolutionOutcomes.fixSuccessRate}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {analytics.verifiedResolutionOutcomes.fixesWorkedCount} of {analytics.verifiedResolutionOutcomes.fixesAttemptedCount} attempted fixes worked
                  </div>
                </div>

                <div className="card">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Retrieval Quality Usefulness
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--text-primary)' }}>
                    {analytics.retrievalQualityIndicators.usefulnessRate}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {analytics.retrievalQualityIndicators.totalVerifiedCasesInKnowledgeBase} active verified cases
                  </div>
                </div>
              </div>

              {/* Dual Grid: Rejection Reasons & Review Actions */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(420px, 1.4fr)', gap: '1.25rem' }}>
                {/* Common Rejection Reasons */}
                <div className="card">
                  <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 700 }}>
                    Common Rejection Reasons
                  </h4>
                  {Object.keys(analytics.commonRejectionReasons || {}).length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                      No rejected recommendations recorded yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {Object.entries(analytics.commonRejectionReasons).map(([reason, count]) => {
                        const labels = {
                          wrong_root_cause: 'Incorrect Root Cause Hypothesis',
                          ineffective_remediation: 'Ineffective Remediation Steps',
                          outdated_precedent: 'Obsolete / Deprecated Historical Precedent',
                          harmful_steps: 'Unsafe Remediation Commands',
                          insufficient_detail: 'Insufficient Grounding Evidence',
                          other: 'Other Operational Reasons',
                        };
                        return (
                          <div
                            key={reason}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.45rem 0.65rem',
                              backgroundColor: 'var(--bg-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.8rem',
                            }}
                          >
                            <span>{labels[reason] || reason}</span>
                            <span className="badge badge-neutral" style={{ fontWeight: 700 }}>
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Historical Resolutions Requiring Human Review */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertTriangle size={16} style={{ color: '#DC2626' }} />
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                        Historical Resolutions Requiring Human Review
                      </h4>
                    </div>
                    <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                      {analytics.historicalResolutionsRequiringReview?.length || 0} Cases
                    </span>
                  </div>

                  {analytics.historicalResolutionsRequiringReview?.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                      ✓ All historical precedents are currently verified with zero reported failures or outdated flags.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {analytics.historicalResolutionsRequiringReview.map((item) => (
                        <div
                          key={item.resolutionId}
                          style={{
                            padding: '0.65rem',
                            border: '1px solid #FCA5A5',
                            backgroundColor: '#FEF2F2',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <strong style={{ color: '#991B1B' }}>{item.incidentNumber} — {item.title}</strong>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              {item.isOutdated && (
                                <span className="badge" style={{ backgroundColor: '#DC2626', color: '#FFF', fontSize: '0.65rem' }}>
                                  FLAGGED OUTDATED
                                </span>
                              )}
                              {item.failureFeedbackCount > 0 && (
                                <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
                                  {item.failureFeedbackCount} Failures
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                            {item.summary}
                          </div>

                          {item.outdatedReason && (
                            <div style={{ fontSize: '0.72rem', color: '#991B1B', fontStyle: 'italic', marginBottom: '0.35rem' }}>
                              Reason: "{item.outdatedReason}"
                            </div>
                          )}

                          {(user?.role === 'manager' || user?.role === 'admin') && item.isOutdated && (
                            <button
                              onClick={() => handleUnflag(item.resolutionId)}
                              className="btn btn-secondary"
                              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                            >
                              Re-verify Precedent
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Flag Outdated Modal */}
      {flagModalOpen && selectedResolutionForFlag && (
        <div className="modal-overlay" onClick={() => setFlagModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Flag size={18} style={{ color: '#DC2626' }} />
                <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Flag Resolution as Outdated</h3>
              </div>
              <button onClick={() => setFlagModalOpen(false)} className="btn btn-subtle" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmFlagOutdated}>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Flagging incident <strong>{selectedResolutionForFlag.incidentNumber}</strong> will mark its resolution as outdated and apply a ranking penalty (-0.40) in historical search retrieval.
              </p>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Reason for Outdated Status *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  required
                  placeholder="e.g. Deprecated in v2.4 upgrade; command line flags changed..."
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  style={{ fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setFlagModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingFlag} className="btn btn-primary" style={{ backgroundColor: '#DC2626' }}>
                  {isSubmittingFlag ? 'Flagging...' : 'Confirm Outdated Flag'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
