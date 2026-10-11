import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import PriorityBadge from '../components/common/PriorityBadge';
import StatusBadge from '../components/common/StatusBadge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { incidentApi, authApi, teamApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  ArrowLeft,
  Clock,
  Shield,
  User,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  Edit2,
  Check,
  X,
  Plus,
  Link as LinkIcon,
  Unlink,
  MessageSquare,
  Users2,
  RefreshCw,
  AlertCircle,
  FileText,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Sliders,
  ExternalLink,
  BookOpen,
  ShieldCheck,
  Lightbulb,
  HelpCircle,
} from 'lucide-react';

const LIFECYCLE_STEPS = [
  'triggered',
  'acknowledged',
  'investigating',
  'mitigated',
  'resolved',
  'closed',
];

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useToast();

  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Status transitions & dialogs
  const [selectedTransition, setSelectedTransition] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [transitionReason, setTransitionReason] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Resolution modal
  const [resolutionModalOpen, setResolutionModalOpen] = useState(false);
  const [resolutionCategory, setResolutionCategory] = useState('code_defect');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [resolutionSteps, setResolutionSteps] = useState('');
  const [preventativeActions, setPreventativeActions] = useState('');
  const [runbookUrl, setRunbookUrl] = useState('');

  // Reopen modal
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Inline edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editReproductionSteps, setEditReproductionSteps] = useState('');
  const [editService, setEditService] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Assignment state
  const [teamList, setTeamList] = useState([]);
  const [userList, setUserList] = useState([]);
  const [assignTeam, setAssignTeam] = useState('');
  const [assignEngineerId, setAssignEngineerId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Investigation notes state
  const [newNote, setNewNote] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  // Related ticket state
  const [relatedTicketInput, setRelatedTicketInput] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  // Phase 5: Triage Recommendations & Duplicate Detection State
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageRecommendation, setTriageRecommendation] = useState(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState([]);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // Phase 5: Override Modal State
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideCategory, setOverrideCategory] = useState('');
  const [overridePriority, setOverridePriority] = useState('');
  const [overrideTeam, setOverrideTeam] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  // Phase 6: Resolution Recommendations State
  const [resolutionRecLoading, setResolutionRecLoading] = useState(false);
  const [resolutionRec, setResolutionRec] = useState(null);
  const [isSubmittingResFeedback, setIsSubmittingResFeedback] = useState(false);

  // Phase 6: Resolution Review & Confirmation Modal
  const [resFeedbackModalOpen, setResFeedbackModalOpen] = useState(false);
  const [confirmedCause, setConfirmedCause] = useState('');
  const [confirmedOutcome, setConfirmedOutcome] = useState('');
  const [resFeedbackNotes, setResFeedbackNotes] = useState('');

  const fetchTriage = useCallback(async (ticketIdentifier) => {
    setTriageLoading(true);
    try {
      const res = await incidentApi.getIncidentRecommendations(ticketIdentifier);
      if (res.success) {
        setTriageRecommendation(res.recommendation);
        setDuplicateCandidates(res.duplicateCandidates || []);
        if (res.recommendation) {
          setOverrideCategory(res.recommendation.suggestedCategory || '');
          setOverridePriority(res.recommendation.suggestedPriority || '');
          setOverrideTeam(res.recommendation.suggestedTeam || '');
        }
      }
    } catch (err) {
      console.warn('Failed to load triage recommendations:', err.message);
    } finally {
      setTriageLoading(false);
    }
  }, []);

  const fetchIncident = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await incidentApi.getIncidentById(id);
      if (res.success && res.incident) {
        setIncident(res.incident);
        setEditTitle(res.incident.title || '');
        setEditDescription(res.incident.description || '');
        setEditReproductionSteps(res.incident.reproductionSteps || '');
        setEditService(res.incident.affectedService || '');
        setAssignTeam(res.incident.assignedTeam || '');
        setAssignEngineerId(res.incident.assignee?._id || res.incident.assignee || '');
        // Load Phase 5 triage recommendations for this ticket
        fetchTriage(res.incident.incidentNumber || res.incident._id);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch incident details');
      showError(err.message || 'Failed to fetch incident');
    } finally {
      setLoading(false);
    }
  }, [id, showError, fetchTriage]);

  const handleAcceptRecommendation = async () => {
    if (!triageRecommendation || !incident) return;
    setIsSubmittingFeedback(true);
    try {
      const isAi = triageRecommendation.classificationMethod === 'gemini_ai_copilot';
      await incidentApi.submitRecommendationFeedback(incident._id, {
        decision: 'accepted',
        method: isAi ? 'ai_assisted' : 'rule_based',
        suggestedCategory: triageRecommendation.suggestedCategory,
        suggestedPriority: triageRecommendation.suggestedPriority,
        suggestedTeam: triageRecommendation.suggestedTeam,
        finalCategory: triageRecommendation.suggestedCategory,
        finalPriority: triageRecommendation.suggestedPriority,
        finalTeam: triageRecommendation.suggestedTeam,
        explanation: triageRecommendation.explanation,
        evidence: triageRecommendation.evidence,
      });
      showSuccess('Triage recommendations accepted and applied to incident.');
      fetchIncident();
    } catch (err) {
      showError(err.message || 'Failed to record acceptance.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleRejectRecommendation = async () => {
    if (!triageRecommendation || !incident) return;
    setIsSubmittingFeedback(true);
    try {
      await incidentApi.submitRecommendationFeedback(incident._id, {
        decision: 'rejected',
        method: 'manually_overridden',
        suggestedCategory: triageRecommendation.suggestedCategory,
        suggestedPriority: triageRecommendation.suggestedPriority,
        suggestedTeam: triageRecommendation.suggestedTeam,
        feedbackNotes: 'Responder declined system suggestions',
      });
      showInfo('Triage recommendations declined.');
      fetchIncident();
    } catch (err) {
      showError(err.message || 'Failed to decline suggestions.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleSaveOverrideFeedback = async (e) => {
    e.preventDefault();
    if (!triageRecommendation || !incident) return;
    setIsSubmittingFeedback(true);
    try {
      await incidentApi.submitRecommendationFeedback(incident._id, {
        decision: 'edited',
        method: 'manually_overridden',
        suggestedCategory: triageRecommendation.suggestedCategory,
        suggestedPriority: triageRecommendation.suggestedPriority,
        suggestedTeam: triageRecommendation.suggestedTeam,
        finalCategory: overrideCategory,
        finalPriority: overridePriority,
        finalTeam: overrideTeam,
        feedbackNotes: overrideNotes || 'Engineer adjusted recommendation parameters',
      });
      showSuccess('Custom triage adjustments applied and recorded in audit log.');
      setOverrideModalOpen(false);
      fetchIncident();
    } catch (err) {
      showError(err.message || 'Failed to save custom adjustments.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleLinkDuplicate = async (targetIncidentNumber) => {
    try {
      await incidentApi.linkRelated(incident._id, { targetIncidentNumber });
      showSuccess(`Linked ${targetIncidentNumber} as related ticket.`);
      fetchIncident();
    } catch (err) {
      showError(err.message || 'Failed to link candidate ticket.');
    }
  };

  const handleFetchResolutionRecommendation = async () => {
    if (!incident) return;
    setResolutionRecLoading(true);
    try {
      const res = await incidentApi.getResolutionRecommendation(incident.incidentNumber || incident._id);
      if (res.success && res.recommendation) {
        setResolutionRec(res.recommendation);
        if (res.recommendation.hasSufficientEvidence) {
          showSuccess('Evidence-backed resolution recommendation generated.');
        } else {
          showInfo('Insufficient historical evidence found for automated grounding.');
        }
      }
    } catch (err) {
      showError(err.message || 'Failed to generate resolution recommendation.');
    } finally {
      setResolutionRecLoading(false);
    }
  };

  const [resDecision, setResDecision] = useState('accepted');
  const [fixAttempted, setFixAttempted] = useState(true);
  const [fixWorked, setFixWorked] = useState(true);
  const [rejectionReason, setRejectionReason] = useState('wrong_root_cause');

  const handleOpenResolutionConfirmModal = (decision = 'accepted') => {
    if (!resolutionRec) return;
    setResDecision(decision);
    setConfirmedCause(resolutionRec.probableRootCause || '');
    setConfirmedOutcome((resolutionRec.potentialResolutionSteps || []).join('; '));
    setResFeedbackNotes(decision === 'edited' ? 'Adjusted by engineer during investigation' : '');
    setFixAttempted(decision !== 'rejected');
    setFixWorked(decision !== 'rejected');
    if (decision === 'rejected') {
      setRejectionReason('wrong_root_cause');
    }
    setResFeedbackModalOpen(true);
  };

  const handleSubmitResolutionFeedback = async (decisionOverride) => {
    if (!incident || !resolutionRec) return;
    const activeDecision = decisionOverride || resDecision;
    setIsSubmittingResFeedback(true);
    try {
      await incidentApi.submitResolutionFeedback(incident.incidentNumber || incident._id, {
        decision: activeDecision,
        recommendationSource:
          resolutionRec.classificationMethod === 'gemini_ai_copilot'
            ? 'gemini_ai_copilot'
            : 'deterministic_kb',
        historicalEvidenceUsed: resolutionRec.retrievedCases || [],
        fixAttempted,
        fixWorked: activeDecision === 'rejected' ? false : fixWorked,
        rejectionReason: activeDecision === 'rejected' ? rejectionReason : '',
        probableRootCause: resolutionRec.probableRootCause,
        confirmedRootCause: confirmedCause || resolutionRec.probableRootCause,
        confirmedOutcome: confirmedOutcome || (resolutionRec.potentialResolutionSteps || []).join('; '),
        feedbackNotes: resFeedbackNotes,
        evidencePoints: resolutionRec.supportingIncidentEvidence || [],
        selectedRemediationSteps: resolutionRec.potentialResolutionSteps || [],
        preventativeActions: resolutionRec.preventionAdvice || [],
      });
      showSuccess(`Resolution recommendation decision '${activeDecision}' recorded in learning loop.`);
      setResFeedbackModalOpen(false);
      fetchIncident();
    } catch (err) {
      showError(err.message || 'Failed to record resolution decision.');
    } finally {
      setIsSubmittingResFeedback(false);
    }
  };

  useEffect(() => {
    fetchIncident();
  }, [fetchIncident]);

  // Load team and user rosters for assignment dropdowns
  useEffect(() => {
    async function loadRosters() {
      try {
        const teamsRes = await teamApi.getTeams();
        if (teamsRes.success) {
          setTeamList(teamsRes.teams || []);
        }
      } catch (err) {
        // Fallback team options
        setTeamList([
          { name: 'Platform SRE' },
          { name: 'Payments Core' },
          { name: 'Database Ops' },
          { name: 'Edge & CDN' },
          { name: 'Identity Service' },
        ]);
      }

      try {
        const usersRes = await authApi.getUsers();
        if (usersRes.success) {
          setUserList(usersRes.users || []);
        }
      } catch (err) {
        // Users roster restricted or unavailable
        setUserList([]);
      }
    }

    if (user?.role !== 'end_user') {
      loadRosters();
    }
  }, [user]);

  // 1. Status transition handler
  const handleInitiateTransition = (nextStatus) => {
    if (nextStatus === 'resolved') {
      setResolutionModalOpen(true);
      return;
    }
    if (nextStatus === 'reopened') {
      setReopenModalOpen(true);
      return;
    }
    setSelectedTransition(nextStatus);
    setTransitionReason(`Transitioning lifecycle state to ${nextStatus.toUpperCase()}`);
    setConfirmOpen(true);
  };

  const handleConfirmTransition = async () => {
    if (!selectedTransition || !incident) return;
    setIsTransitioning(true);
    try {
      const res = await incidentApi.updateStatus(incident._id, {
        status: selectedTransition,
        reason: transitionReason,
      });
      if (res.success) {
        showSuccess(`Incident status updated to ${selectedTransition.toUpperCase()}.`);
        setConfirmOpen(false);
        setSelectedTransition(null);
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Status transition failed.');
    } finally {
      setIsTransitioning(false);
    }
  };

  // 2. Resolution submission
  const handleSubmitResolution = async (e) => {
    e.preventDefault();
    if (!resolutionSummary.trim() || !resolutionSteps.trim()) {
      showError('Please provide resolution summary and remediation steps.');
      return;
    }

    const stepsArray = resolutionSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (stepsArray.length === 0) {
      showError('At least one remediation step is required.');
      return;
    }

    const prevActionsArray = preventativeActions
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await incidentApi.recordResolution(incident._id, {
        rootCauseCategory: resolutionCategory,
        summary: resolutionSummary.trim(),
        remediationSteps: stepsArray,
        preventativeActions: prevActionsArray,
        runbookUrl: runbookUrl.trim(),
      });

      if (res.success) {
        showSuccess('Verified resolution recorded and incident marked resolved.');
        setResolutionModalOpen(false);
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to record resolution.');
    }
  };

  // 3. Reopen submission
  const handleSubmitReopen = async (e) => {
    e.preventDefault();
    if (!reopenReason.trim()) {
      showError('A mandatory reason is required to reopen an incident.');
      return;
    }

    try {
      const res = await incidentApi.reopenIncident(incident._id, {
        reason: reopenReason.trim(),
      });
      if (res.success) {
        showSuccess('Incident reopened successfully.');
        setReopenModalOpen(false);
        setReopenReason('');
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to reopen incident.');
    }
  };

  // 4. Save non-restricted field edits
  const handleSaveEdit = async () => {
    if (!editTitle.trim() || !editDescription.trim()) {
      showError('Title and description cannot be blank.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await incidentApi.updateIncident(incident._id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        reproductionSteps: editReproductionSteps.trim(),
        affectedService: editService.trim(),
      });
      if (res.success) {
        showSuccess('Incident details updated successfully.');
        setIsEditing(false);
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to save edits.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // 5. Reassign team and engineer
  const handleSaveAssignment = async (e) => {
    e.preventDefault();
    setIsAssigning(true);
    try {
      const res = await incidentApi.reassign(incident._id, {
        assignedTeam: assignTeam,
        assigneeId: assignEngineerId || null,
        reason: `Reassigned in triage console`,
      });
      if (res.success) {
        showSuccess('Team and engineer assignment updated.');
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to update assignment.');
    } finally {
      setIsAssigning(false);
    }
  };

  // 6. Append investigation note
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setIsSubmittingNote(true);
    try {
      const res = await incidentApi.addNote(incident._id, { note: newNote.trim() });
      if (res.success) {
        showSuccess('Investigation note recorded.');
        setNewNote('');
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to record note.');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // 7. Link related ticket
  const handleLinkRelated = async (e) => {
    e.preventDefault();
    if (!relatedTicketInput.trim()) return;

    setIsLinking(true);
    try {
      const res = await incidentApi.linkRelated(incident._id, {
        relatedTicketId: relatedTicketInput.trim(),
      });
      if (res.success) {
        showSuccess(`Linked related ticket ${relatedTicketInput.trim()}.`);
        setRelatedTicketInput('');
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to link ticket.');
    } finally {
      setIsLinking(false);
    }
  };

  // 8. Unlink related ticket
  const handleUnlinkRelated = async (relatedId) => {
    try {
      const res = await incidentApi.unlinkRelated(incident._id, relatedId);
      if (res.success) {
        showSuccess('Related ticket unlinked.');
        await fetchIncident();
      }
    } catch (err) {
      showError(err.message || 'Failed to unlink ticket.');
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
        <RefreshCw size={24} className="spin" style={{ marginBottom: '0.75rem' }} />
        <div>Retrieving live incident record from database...</div>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div>
        <button
          onClick={() => navigate('/incidents')}
          className="btn-subtle"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', marginBottom: '1rem' }}
        >
          <ArrowLeft size={14} /> Back to Incidents Queue
        </button>
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <AlertCircle size={32} style={{ color: 'var(--color-p1)', marginBottom: '0.5rem' }} />
          <h2>Incident Record Unavailable</h2>
          <p>{error || `No active record matching identifier '${id}'.`}</p>
          <button onClick={() => navigate('/incidents')} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Return to Queue
          </button>
        </div>
      </div>
    );
  }

  const currentStepIdx = LIFECYCLE_STEPS.indexOf(incident.status);

  return (
    <div>
      <PageHeader
        title={
          isEditing ? (
            <input
              type="text"
              className="form-input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ fontSize: '1.25rem', fontWeight: 700 }}
            />
          ) : (
            incident.title
          )
        }
        subtitle={`Ticket Number: ${incident.incidentNumber} • Service: ${incident.affectedService}`}
        badge={<PriorityBadge priority={incident.priority} />}
        breadcrumbs={
          <button
            onClick={() => navigate('/incidents')}
            className="btn-subtle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', padding: 0 }}
          >
            <ArrowLeft size={13} /> Back to Incidents Queue
          </button>
        }
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <StatusBadge status={incident.status} />
            {user?.role !== 'end_user' && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="btn btn-secondary"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
              >
                {isEditing ? <X size={13} /> : <Edit2 size={13} />} {isEditing ? 'Cancel Edit' : 'Edit Details'}
              </button>
            )}
            {isEditing && (
              <button
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="btn btn-primary"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
              >
                <Check size={13} /> {isSavingEdit ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        }
      />

      {/* Lifecycle State Pipeline */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
          Permitted Lifecycle State Transitions
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
          {LIFECYCLE_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIdx;
            const isCurrent = idx === currentStepIdx;
            return (
              <div
                key={step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8rem',
                  padding: '0.35rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isCurrent
                    ? 'var(--accent-forest)'
                    : isCompleted
                    ? 'var(--accent-forest-subtle)'
                    : 'var(--bg-subtle)',
                  color: isCurrent
                    ? '#FFFFFF'
                    : isCompleted
                    ? 'var(--accent-forest)'
                    : 'var(--text-secondary)',
                  fontWeight: isCurrent || isCompleted ? 600 : 500,
                  textTransform: 'capitalize',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{idx + 1}. {step}</span>
              </div>
            );
          })}
        </div>

        {/* Transition Quick Action Triggers */}
        {user?.role !== 'end_user' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', borderTop: '1px solid var(--border-neutral)', paddingTop: '0.75rem', flexWrap: 'wrap' }}>
            {['triggered', 'new'].includes(incident.status) && (
              <button
                onClick={() => handleInitiateTransition('acknowledged')}
                className="btn btn-primary"
                style={{ fontSize: '0.8rem' }}
              >
                <CheckCircle2 size={14} /> Acknowledge Alert
              </button>
            )}

            {['acknowledged', 'triggered', 'new', 'reopened'].includes(incident.status) && (
              <button
                onClick={() => handleInitiateTransition('investigating')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
              >
                <Play size={14} /> Begin Investigation
              </button>
            )}

            {['acknowledged', 'investigating', 'reopened'].includes(incident.status) && (
              <button
                onClick={() => handleInitiateTransition('mitigated')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
              >
                Mitigate Disruption
              </button>
            )}

            {['acknowledged', 'investigating', 'mitigated', 'reopened'].includes(incident.status) && (
              <button
                onClick={() => handleInitiateTransition('resolved')}
                className="btn btn-primary"
                style={{ fontSize: '0.8rem' }}
              >
                <CheckCircle2 size={14} /> Record Resolution
              </button>
            )}

            {incident.status === 'resolved' && (
              <button
                onClick={() => handleInitiateTransition('closed')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
              >
                Close Ticket
              </button>
            )}

            {['resolved', 'closed'].includes(incident.status) && (
              <button
                onClick={() => handleInitiateTransition('reopened')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', color: '#B43B3B' }}
              >
                <RotateCcw size={14} /> Reopen Ticket
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Grid: Details, Notes & History vs Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Incident Details Card */}
          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Incident Description</h3>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <textarea
                  className="form-textarea"
                  rows={4}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <div>
                  <label className="form-label">Reproduction Steps</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={editReproductionSteps}
                    onChange={(e) => setEditReproductionSteps(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.6', marginBottom: '1rem' }}>
                  {incident.description}
                </p>

                {incident.reproductionSteps && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      Reproduction Steps
                    </div>
                    <pre style={{ fontSize: '0.825rem', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {incident.reproductionSteps}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {incident.classificationMetadata?.tags?.map((tag, idx) => (
                <span
                  key={idx}
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-xs)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          {/* Phase 6: Evidence-Backed Resolution Recommendations Panel */}
          <div className="card" style={{ border: '1px solid var(--accent-forest)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Lightbulb size={18} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: 600 }}>Evidence-Backed Resolution Recommendations</h3>
              </div>
              <button
                type="button"
                onClick={handleFetchResolutionRecommendation}
                disabled={resolutionRecLoading}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Sparkles size={13} className={resolutionRecLoading ? 'spin' : ''} />
                {resolutionRecLoading ? 'Querying Knowledge Base...' : resolutionRec ? 'Refresh Recommendation' : 'Request Resolution Recommendation'}
              </button>
            </div>

            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Synthesizes diagnostic hypotheses grounded strictly in <strong>verified closed resolutions</strong> and active error telemetry. Untrusted inputs are sanitized to eliminate secret leaks and prompt injections.
            </p>

            {resolutionRecLoading ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Searching verified historical resolutions & evaluating evidence thresholds...
                </div>
              </div>
            ) : !resolutionRec ? (
              <div style={{ padding: '1.25rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Click <strong>"Request Resolution Recommendation"</strong> to search the knowledge base for verified cases and synthesize grounded root cause hypotheses.
                </p>
              </div>
            ) : !resolutionRec.hasSufficientEvidence ? (
              /* Insufficient Evidence Alert */
              <div style={{ padding: '1rem', border: '1px solid #F59E0B', backgroundColor: '#FFFDF0', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <AlertTriangle size={18} style={{ color: '#D97706' }} />
                  <strong style={{ color: '#92400E', fontSize: '0.9rem' }}>Insufficient Historical Evidence</strong>
                </div>
                <p style={{ fontSize: '0.825rem', color: '#78350F', marginBottom: '0.75rem' }}>
                  {resolutionRec.explanation || 'No verified historical resolutions exceed the minimum relevance threshold (0.40). ResolveIQ strictly refuses to invent historical outcomes without grounded support.'}
                </p>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#92400E', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                  Recommended Manual Investigation Steps:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: '#78350F' }}>
                  {resolutionRec.suggestedInvestigationSteps?.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : (
              /* Grounded Resolution Hypothesis */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Method & Verification Status Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="badge badge-primary" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                      {resolutionRec.generationMethod === 'gemini_ai_copilot' ? '⚡ Gemini AI Copilot' : '⚙️ Deterministic KB Synthesis'}
                    </span>
                    <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                      {resolutionRec.verificationStatus === 'ai_generated_hypothesis' ? 'AI Hypothesis (Unverified)' : 'Derived from Verified Case'}
                    </span>
                  </div>
                  {resolutionRec.modelConfidenceScore && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Confidence: <strong>{Math.round(resolutionRec.modelConfidenceScore * 100)}%</strong>
                    </span>
                  )}
                </div>

                {/* Probable Root Cause */}
                <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-forest)' }}>
                  <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Probable Root Cause
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {resolutionRec.probableRootCause}
                  </div>
                </div>

                {/* Supporting Incident Evidence */}
                {resolutionRec.supportingIncidentEvidence?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Supporting Telemetry & Pattern Evidence
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                      {resolutionRec.supportingIncidentEvidence.map((ev, i) => (
                        <li key={i}>{ev}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Retrieved Historical Verified Cases */}
                {resolutionRec.retrievedCases?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Grounded Historical Precedents ({resolutionRec.retrievedCases.length})
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.65rem' }}>
                      {resolutionRec.retrievedCases.map((c) => (
                        <div
                          key={c.incidentNumber}
                          style={{
                            padding: '0.65rem',
                            border: '1px solid var(--border-neutral)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--bg-card)',
                            fontSize: '0.8rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <button
                              onClick={() => navigate(`/incidents/${c.incidentNumber}`)}
                              className="btn-subtle"
                              style={{ padding: 0, fontWeight: 700, color: 'var(--accent-forest)' }}
                            >
                              {c.incidentNumber}
                            </button>
                            <span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>
                              {Math.round(c.similarityScore * 100)}% match
                            </span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                            Root Cause: <strong>{c.rootCauseCategory}</strong>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)' }}>
                            {c.summary}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Investigation Steps */}
                {resolutionRec.suggestedInvestigationSteps?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Suggested Diagnostic Investigation Steps
                    </div>
                    <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                      {resolutionRec.suggestedInvestigationSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Potential Resolution Steps */}
                {resolutionRec.potentialResolutionSteps?.length > 0 && (
                  <div style={{ padding: '0.75rem', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Potential Resolution & Remediation Steps
                    </div>
                    <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.825rem', color: '#14532D' }}>
                      {resolutionRec.potentialResolutionSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Prevention Advice */}
                {resolutionRec.preventionAdvice?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Prevention & Reliability Hardening
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                      {resolutionRec.preventionAdvice.map((act, i) => (
                        <li key={i}>{act}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Missing Information & Uncertainty */}
                {resolutionRec.missingInformationAndUncertainty && (
                  <div style={{ padding: '0.65rem 0.85rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-xs)', fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    <strong>Diagnostic Uncertainty & Caveats:</strong> {resolutionRec.missingInformationAndUncertainty}
                  </div>
                )}

                {/* Verification Notice */}
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                  ⚠️ <em>Only verified resolutions are presented as confirmed knowledge. Record engineer-confirmed causes and outcomes separately from AI-generated hypotheses.</em>
                </div>

                {/* Engineer Feedback & Review Actions */}
                {user?.role !== 'end_user' && (
                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-neutral)' }}>
                    <button
                      type="button"
                      disabled={isSubmittingResFeedback}
                      onClick={() => handleOpenResolutionConfirmModal('accepted')}
                      className="btn btn-primary"
                      style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CheckCircle2 size={14} /> Accept & Confirm Resolution
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingResFeedback}
                      onClick={() => handleOpenResolutionConfirmModal('edited')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Sliders size={14} /> Edit & Override
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingResFeedback}
                      onClick={() => handleOpenResolutionConfirmModal('rejected')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', color: '#B43B3B', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <XCircle size={14} /> Reject Hypothesis
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Verified Resolution Record (if resolved or resolution exists) */}
          {incident.resolution && (
            <div className="card" style={{ borderLeft: '4px solid #16A34A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <CheckCircle2 size={18} style={{ color: '#16A34A' }} />
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Verified Resolution Record</h3>
              </div>

              <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <strong>Root Cause:</strong> <span className="badge badge-neutral">{incident.resolution.rootCauseCategory}</span>
              </div>
              <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                {incident.resolution.summary}
              </p>

              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Remediation Steps Applied:</div>
                <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0, fontSize: '0.825rem' }}>
                  {incident.resolution.remediationSteps?.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>

              {incident.resolution.preventativeActions?.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Preventative Actions:</div>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0, fontSize: '0.825rem' }}>
                    {incident.resolution.preventativeActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Investigation Notes Feed */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <MessageSquare size={16} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Investigation Notes</h3>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                {incident.investigationNotes?.length || 0}
              </span>
            </div>

            {user?.role !== 'end_user' && (
              <form onSubmit={handleAddNote} style={{ marginBottom: '1.25rem' }}>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="Record diagnostic findings, stack trace insights, or status updates..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    type="submit"
                    disabled={isSubmittingNote || !newNote.trim()}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                  >
                    <Plus size={13} /> {isSubmittingNote ? 'Saving...' : 'Add Note'}
                  </button>
                </div>
              </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {incident.investigationNotes?.length === 0 ? (
                <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No investigation notes recorded yet.
                </div>
              ) : (
                incident.investigationNotes?.map((note, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem',
                      backgroundColor: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      borderLeft: '3px solid var(--accent-forest)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      <strong>{note.authorName} ({note.authorRole})</strong>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>{note.note}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Immutable Audit Log Timeline */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <History size={16} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Immutable Audit Trail</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {incident.auditLogs?.map((log, idx) => (
                <div
                  key={log._id || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    paddingBottom: '0.75rem',
                    borderBottom: idx < (incident.auditLogs.length - 1) ? '1px solid var(--border-neutral)' : 'none',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-forest)',
                      marginTop: '6px',
                    }}
                  />
                  <div style={{ flex: 1, fontSize: '0.825rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <strong>{log.action}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                      By: <strong>{log.actorName}</strong> ({log.actorRole})
                    </div>
                    {log.reason && (
                      <div style={{ color: 'var(--text-primary)', fontStyle: 'italic', fontSize: '0.775rem' }}>
                        "{log.reason}"
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Controls, Assignment & Related Tickets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Metadata Card */}
          <div className="card">
            <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Ticket Information
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ticket ID:</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{incident.incidentNumber}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Service:</span>
                <strong>{incident.affectedService}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Environment:</span>
                <span className="badge badge-neutral" style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                  {incident.classificationMetadata?.environment || 'production'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Source:</span>
                <strong>{incident.source || 'manual'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Reporter:</span>
                <strong>{incident.reporter?.name || 'Automated Monitor'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Created At:</span>
                <span>{new Date(incident.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Phase 5: Triage Intelligence & AI Copilot Panel */}
          <div className="card" style={{ border: '1px solid var(--accent-forest)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={16} style={{ color: 'var(--accent-forest)' }} />
                <h4 style={{ fontSize: '0.85rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Triage Intelligence
                </h4>
              </div>
              <button
                type="button"
                onClick={() => fetchTriage(incident.incidentNumber || incident._id)}
                disabled={triageLoading}
                className="btn-subtle"
                style={{ fontSize: '0.75rem', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Refresh recommendations"
              >
                <RefreshCw size={12} className={triageLoading ? 'spin' : ''} />
              </button>
            </div>

            {triageLoading ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                Computing explainable triage recommendations...
              </div>
            ) : triageRecommendation ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <span
                    className={`badge ${triageRecommendation.classificationMethod === 'gemini_ai_copilot' ? 'badge-primary' : 'badge-neutral'}`}
                    style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}
                  >
                    {triageRecommendation.classificationMethod === 'gemini_ai_copilot' ? '⚡ Gemini AI Copilot' : '⚙️ Rule-Based Heuristic'}
                  </span>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                    {triageRecommendation.confidenceInfo?.heuristicMatchScore
                      ? `Heuristic Signal: ${Math.round(triageRecommendation.confidenceInfo.heuristicMatchScore * 100)}%`
                      : `Confidence: ${Math.round((triageRecommendation.confidenceInfo?.modelConfidenceScore || 0.85) * 100)}%`}
                  </span>
                </div>

                <div style={{ padding: '0.6rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Category:</span>
                    <strong style={{ textTransform: 'capitalize' }}>{triageRecommendation.suggestedCategory}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Priority:</span>
                    <PriorityBadge priority={triageRecommendation.suggestedPriority} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Team:</span>
                    <strong>{triageRecommendation.suggestedTeam}</strong>
                  </div>
                </div>

                <div style={{ fontSize: '0.775rem', color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                  "{triageRecommendation.explanation}"
                </div>

                {triageRecommendation.evidence && triageRecommendation.evidence.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                      Evidence & Rule Signals
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                      {triageRecommendation.evidence.slice(0, 3).map((ev, i) => (
                        <li key={i}>{ev}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {triageRecommendation.confidenceInfo?.disclaimer || 'Heuristic rule score reflecting keyword pattern matches, not a calibrated probability.'}
                </div>

                {/* Review & Feedback Actions */}
                {user?.role !== 'end_user' && (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={handleAcceptRecommendation}
                      className="btn btn-secondary"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      title="Accept suggested category, priority & team"
                    >
                      <ThumbsUp size={12} style={{ color: 'var(--accent-forest)' }} /> Accept
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={() => setOverrideModalOpen(true)}
                      className="btn btn-secondary"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      title="Customize suggested attributes"
                    >
                      <Sliders size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={handleRejectRecommendation}
                      className="btn btn-secondary"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      title="Decline suggestions"
                    >
                      <ThumbsDown size={12} style={{ color: '#B43B3B' }} /> Reject
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                No active recommendations. Click refresh to run triage analysis.
              </div>
            )}
          </div>

          {/* Suspected Duplicate Incidents Panel */}
          {duplicateCandidates.length > 0 && (
            <div className="card" style={{ border: '1px solid #E69B00', backgroundColor: '#FFFDF9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <AlertTriangle size={16} style={{ color: '#D97706' }} />
                <h4 style={{ fontSize: '0.85rem', margin: 0, color: '#92400E', fontWeight: 600 }}>
                  Suspected Duplicates ({duplicateCandidates.filter((d) => d.isSuspectedDuplicate).length})
                </h4>
              </div>

              <p style={{ fontSize: '0.725rem', color: '#78350F', marginBottom: '0.5rem' }}>
                TF-IDF cosine similarity detected matching incidents. Tickets are <strong>never automatically merged or deleted</strong>.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {duplicateCandidates.map((dup) => (
                  <div
                    key={dup.candidateId}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #FDE68A',
                      borderRadius: 'var(--radius-xs)',
                      backgroundColor: '#FFFFFF',
                      fontSize: '0.775rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <button
                        onClick={() => navigate(`/incidents/${dup.incidentNumber}`)}
                        className="btn-subtle"
                        style={{ padding: 0, fontWeight: 600, color: 'var(--accent-forest)' }}
                      >
                        {dup.incidentNumber}
                      </button>
                      <span className={`badge ${dup.isSuspectedDuplicate ? 'badge-danger' : 'badge-neutral'}`} style={{ fontSize: '0.65rem' }}>
                        {Math.round(dup.similarityScore * 100)}% match
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.3rem', color: 'var(--text-primary)' }}>
                      {dup.title}
                    </div>
                    {dup.matchingEvidence && dup.matchingEvidence.length > 0 && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                        Tokens: <em>{dup.matchingEvidence.join(', ')}</em>
                      </div>
                    )}
                    {user?.role !== 'end_user' && (
                      <button
                        type="button"
                        onClick={() => handleLinkDuplicate(dup.incidentNumber)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', width: '100%' }}
                      >
                        Link as Related Ticket
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response & Resolution SLA Commitments */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Clock size={16} style={{ color: 'var(--accent-forest)' }} />
              <h4 style={{ fontSize: '0.85rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                SLA Commitments
              </h4>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Response Deadline:</span>
                <span>{incident.sla?.responseDeadline ? new Date(incident.sla.responseDeadline).toLocaleTimeString() : 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Resolution Target:</span>
                <span>{incident.sla?.resolutionDeadline ? new Date(incident.sla.resolutionDeadline).toLocaleTimeString() : 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Team and Engineer Assignment Widget */}
          {user?.role !== 'end_user' && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Users2 size={16} style={{ color: 'var(--accent-forest)' }} />
                <h4 style={{ fontSize: '0.85rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Team & Resolver Assignment
                </h4>
              </div>

              <form onSubmit={handleSaveAssignment}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Assigned Team</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '0.825rem' }}
                    value={assignTeam}
                    onChange={(e) => setAssignTeam(e.target.value)}
                  >
                    {teamList.map((t) => (
                      <option key={t._id || t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Assigned Engineer</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '0.825rem' }}
                    value={assignEngineerId}
                    onChange={(e) => setAssignEngineerId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {userList.map((u) => (
                      <option key={u._id} value={u._id}>{u.name} ({u.team || 'Responder'})</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isAssigning}
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem' }}
                >
                  {isAssigning ? 'Updating...' : 'Update Assignment'}
                </button>

                <button
                  type="button"
                  onClick={() => navigate(`/team-workload?incidentId=${incident._id}`)}
                  className="btn btn-subtle"
                  style={{
                    width: '100%',
                    fontSize: '0.78rem',
                    marginTop: '0.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    color: 'var(--accent-forest)',
                    fontWeight: 600,
                  }}
                >
                  <Sliders size={13} />
                  Simulate What-If Assignment →
                </button>
              </form>
            </div>
          )}

          {/* Related Tickets Widget */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <LinkIcon size={16} style={{ color: 'var(--accent-forest)' }} />
              <h4 style={{ fontSize: '0.85rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Related Incidents
              </h4>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                {incident.relatedIncidents?.length || 0}
              </span>
            </div>

            {user?.role !== 'end_user' && (
              <form onSubmit={handleLinkRelated} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '0.775rem', padding: '0.35rem 0.5rem' }}
                  placeholder="Link INC-1002..."
                  value={relatedTicketInput}
                  onChange={(e) => setRelatedTicketInput(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={isLinking || !relatedTicketInput.trim()}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                >
                  Link
                </button>
              </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {incident.relatedIncidents?.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No related incidents linked.
                </div>
              ) : (
                incident.relatedIncidents?.map((rel) => {
                  const relId = rel._id || rel;
                  const relNumber = rel.incidentNumber || relId;
                  return (
                    <div
                      key={relId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.4rem 0.6rem',
                        backgroundColor: 'var(--bg-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.8rem',
                      }}
                    >
                      <button
                        onClick={() => navigate(`/incidents/${relNumber}`)}
                        className="btn-subtle"
                        style={{ padding: 0, fontWeight: 600, color: 'var(--accent-forest)' }}
                      >
                        {relNumber}
                      </button>
                      {user?.role !== 'end_user' && (
                        <button
                          onClick={() => handleUnlinkRelated(relId)}
                          className="btn-subtle"
                          style={{ padding: '2px', color: 'var(--text-muted)' }}
                          title="Unlink ticket"
                        >
                          <Unlink size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for standard state transition */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title={`Advance Lifecycle State to ${selectedTransition?.toUpperCase()}`}
        message={`Are you sure you want to transition this incident to ${selectedTransition?.toUpperCase()}? An audit log entry will be permanently appended.`}
        confirmLabel={isTransitioning ? 'Transitioning...' : 'Confirm Transition'}
        onConfirm={handleConfirmTransition}
        onCancel={() => {
          setConfirmOpen(false);
          setSelectedTransition(null);
        }}
      />

      {/* Resolution Recording Modal */}
      {resolutionModalOpen && (
        <div className="modal-overlay" onClick={() => setResolutionModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={18} style={{ color: '#16A34A' }} />
                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Record Incident Resolution</h3>
              </div>
              <button onClick={() => setResolutionModalOpen(false)} className="btn btn-subtle" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitResolution}>
              <div className="form-group">
                <label className="form-label">Root Cause Category *</label>
                <select
                  className="form-select"
                  value={resolutionCategory}
                  onChange={(e) => setResolutionCategory(e.target.value)}
                >
                  <option value="code_defect">Code Defect (Application Bug)</option>
                  <option value="configuration_drift">Configuration Drift / Bad Deployment</option>
                  <option value="hardware_failure">Hardware / Cloud Host Failure</option>
                  <option value="third_party_outage">Third-Party SaaS / Vendor Outage</option>
                  <option value="capacity_exhaustion">Capacity Exhaustion / Resource Starvation</option>
                  <option value="security_incident">Security Incident / Credential Revocation</option>
                  <option value="human_error">Human Error / Operational Mistake</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Resolution Summary *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  required
                  placeholder="Summary of how degradation was resolved..."
                  value={resolutionSummary}
                  onChange={(e) => setResolutionSummary(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Remediation Steps Applied (one per line) *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  required
                  placeholder="1. Rolled back deployment to v2.1.2&#10;2. Purged CDN edge caches&#10;3. Verified 200 OK traffic recovery"
                  value={resolutionSteps}
                  onChange={(e) => setResolutionSteps(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Preventative Actions (optional, one per line)</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="e.g. Add synthetic health check in CI pipeline"
                  value={preventativeActions}
                  onChange={(e) => setPreventativeActions(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Runbook URL (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://wiki.internal/runbooks/ingress-recovery"
                  value={runbookUrl}
                  onChange={(e) => setRunbookUrl(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setResolutionModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Verify & Mark Resolved
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reopen Incident Modal */}
      {reopenModalOpen && (
        <div className="modal-overlay" onClick={() => setReopenModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <RotateCcw size={18} style={{ color: '#B43B3B' }} />
                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Reopen Operational Ticket</h3>
              </div>
              <button onClick={() => setReopenModalOpen(false)} className="btn btn-subtle" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitReopen}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Reopening this incident resets its state to <strong>REOPENED</strong> for continued triage. A mandatory reason is required for the audit log.
              </p>

              <div className="form-group">
                <label className="form-label">Mandatory Reopening Reason *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  required
                  placeholder="e.g. Elevated 502 error rates re-emerged on European edge cluster..."
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setReopenModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger">
                  Confirm Reopen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Phase 5: Recommendation Custom Override Modal */}
      {overrideModalOpen && (
        <div className="modal-overlay" onClick={() => setOverrideModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sliders size={18} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Review & Override Triage Recommendations</h3>
              </div>
              <button onClick={() => setOverrideModalOpen(false)} className="btn btn-subtle" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveOverrideFeedback}>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Modify the suggested triage fields. Your custom selection will be recorded in the audit log as <strong>manually overridden</strong>.
              </p>

              <div className="form-group">
                <label className="form-label">Classification Category</label>
                <select
                  className="form-select"
                  value={overrideCategory}
                  onChange={(e) => setOverrideCategory(e.target.value)}
                >
                  <option value="availability">Availability</option>
                  <option value="latency">Latency</option>
                  <option value="data_integrity">Data Integrity</option>
                  <option value="security">Security</option>
                  <option value="infrastructure">Infrastructure</option>
                  <option value="deployment">Deployment</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Priority Tier</label>
                <select
                  className="form-select"
                  value={overridePriority}
                  onChange={(e) => setOverridePriority(e.target.value)}
                >
                  <option value="P1">P1 - Critical (15 min SLA)</option>
                  <option value="P2">P2 - Major (30 min SLA)</option>
                  <option value="P3">P3 - Moderate (2 hr SLA)</option>
                  <option value="P4">P4 - Minor (4 hr SLA)</option>
                  <option value="P5">P5 - Informational (8 hr SLA)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Resolver Response Team</label>
                <select
                  className="form-select"
                  value={overrideTeam}
                  onChange={(e) => setOverrideTeam(e.target.value)}
                >
                  <option value="Platform SRE">Platform SRE</option>
                  <option value="Payments Core">Payments Core</option>
                  <option value="Database Ops">Database Ops</option>
                  <option value="Edge & CDN">Edge & CDN</option>
                  <option value="Identity Service">Identity Service</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Override Reason / Audit Note</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="e.g. Traffic impact contained to canary cluster; downgraded priority to P3."
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setOverrideModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingFeedback} className="btn btn-primary">
                  {isSubmittingFeedback ? 'Recording...' : 'Apply & Record Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phase 6: Engineer Resolution Confirmation & Verification Modal */}
      {resFeedbackModalOpen && (
        <div className="modal-overlay" onClick={() => setResFeedbackModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={18} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Resolution Learning Loop Review</h3>
              </div>
              <button onClick={() => setResFeedbackModalOpen(false)} className="btn btn-subtle" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmitResolutionFeedback(); }}>
              {/* Separate AI Hypotheses from Ground Truth Facts */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '1rem',
                  lineHeight: 1.4,
                  borderLeft: '3px solid var(--accent-forest)',
                }}
              >
                <strong>Knowledge Separation:</strong> AI-generated hypotheses remain logged as tentative suggestions. Ground-truth causes and verified fixes are permanently recorded into the search index.
              </div>

              {/* Decision Toggle */}
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Engineer Review Decision</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => { setResDecision('accepted'); setFixAttempted(true); setFixWorked(true); }}
                    className={resDecision === 'accepted' ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ flex: 1, fontSize: '0.78rem' }}
                  >
                    Accept Hypothesis
                  </button>
                  <button
                    type="button"
                    onClick={() => { setResDecision('edited'); setFixAttempted(true); setFixWorked(true); }}
                    className={resDecision === 'edited' ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ flex: 1, fontSize: '0.78rem' }}
                  >
                    Edit & Custom Fix
                  </button>
                  <button
                    type="button"
                    onClick={() => { setResDecision('rejected'); setFixWorked(false); }}
                    className={resDecision === 'rejected' ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ flex: 1, fontSize: '0.78rem', color: resDecision === 'rejected' ? '#FFF' : '#DC2626' }}
                  >
                    Reject Hypothesis
                  </button>
                </div>
              </div>

              {/* Fix Attempted & Fix Worked Radios */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Was Proposed Fix Attempted?</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="fixAttempted"
                        checked={fixAttempted === true}
                        onChange={() => setFixAttempted(true)}
                      />
                      Yes, Attempted
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="fixAttempted"
                        checked={fixAttempted === false}
                        onChange={() => { setFixAttempted(false); setFixWorked(false); }}
                      />
                      No, Skipped
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Did the Remediation Work?</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="fixWorked"
                        disabled={!fixAttempted || resDecision === 'rejected'}
                        checked={fixWorked === true}
                        onChange={() => setFixWorked(true)}
                      />
                      Yes, Succeeded
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="fixWorked"
                        checked={fixWorked === false}
                        onChange={() => setFixWorked(false)}
                      />
                      No, Ineffective
                    </label>
                  </div>
                </div>
              </div>

              {/* Rejection Reason (shown if rejected) */}
              {resDecision === 'rejected' && (
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Primary Rejection Reason *</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '0.8rem' }}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  >
                    <option value="wrong_root_cause">Incorrect Root Cause Hypothesis</option>
                    <option value="ineffective_remediation">Remediation Steps Did Not Resolve Issue</option>
                    <option value="outdated_precedent">Historical Precedent Is Obsolete / Deprecated</option>
                    <option value="harmful_steps">Remediation Steps Unsafe or Harmful</option>
                    <option value="insufficient_detail">Insufficient Grounding Evidence</option>
                    <option value="other">Other Operational Reason</option>
                  </select>
                </div>
              )}

              {/* Confirmed Root Cause */}
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>
                  Engineer-Confirmed Root Cause {resDecision !== 'rejected' ? '*' : '(Optional)'}
                </label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  required={resDecision !== 'rejected'}
                  placeholder="State the verified physical or logical root cause..."
                  value={confirmedCause}
                  onChange={(e) => setConfirmedCause(e.target.value)}
                  style={{ fontSize: '0.825rem' }}
                />
              </div>

              {/* Confirmed Outcome / Applied Remediation */}
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>
                  Engineer-Confirmed Outcome & Applied Remediation {resDecision !== 'rejected' ? '*' : '(Optional)'}
                </label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  required={resDecision !== 'rejected'}
                  placeholder="Detail the verified mitigation outcome..."
                  value={confirmedOutcome}
                  onChange={(e) => setConfirmedOutcome(e.target.value)}
                  style={{ fontSize: '0.825rem' }}
                />
              </div>

              {/* Verification Notes */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Audit Feedback Notes</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Verified cluster recovery via Prometheus dashboard telemetry"
                  value={resFeedbackNotes}
                  onChange={(e) => setResFeedbackNotes(e.target.value)}
                  style={{ fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" onClick={() => setResFeedbackModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingResFeedback} className="btn btn-primary">
                  {isSubmittingResFeedback ? 'Recording...' : 'Submit Decision to Learning Loop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
