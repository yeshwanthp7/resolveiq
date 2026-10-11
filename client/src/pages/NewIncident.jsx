import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import PriorityBadge from '../components/common/PriorityBadge';
import { incidentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ArrowLeft, Shield, Clock, AlertTriangle, Check, AlertCircle, Sparkles, Copy, ExternalLink } from 'lucide-react';

// Client-side preview of deterministic ITIL calculation matching priorityMatrix.js
function previewPriority(impact, urgency) {
  if (impact === 'enterprise') {
    if (urgency === 'critical') return { code: 'P1', label: 'Critical', response: '15 min', resolve: '2 hours' };
    if (urgency === 'moderate') return { code: 'P2', label: 'Major', response: '30 min', resolve: '4 hours' };
    if (urgency === 'low') return { code: 'P3', label: 'Moderate', response: '2 hours', resolve: '12 hours' };
  }
  if (impact === 'department') {
    if (urgency === 'critical') return { code: 'P2', label: 'Major', response: '30 min', resolve: '4 hours' };
    if (urgency === 'moderate') return { code: 'P3', label: 'Moderate', response: '2 hours', resolve: '12 hours' };
    if (urgency === 'low') return { code: 'P4', label: 'Minor', response: '4 hours', resolve: '24 hours' };
  }
  if (impact === 'single_user') {
    if (urgency === 'critical') return { code: 'P4', label: 'Minor', response: '4 hours', resolve: '24 hours' };
    if (urgency === 'moderate') return { code: 'P4', label: 'Minor', response: '4 hours', resolve: '24 hours' };
    if (urgency === 'low') return { code: 'P5', label: 'Informational', response: '8 hours', resolve: '72 hours' };
  }
  return { code: 'P4', label: 'Minor', response: '4 hours', resolve: '24 hours' };
}

export default function NewIncident() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [affectedService, setAffectedService] = useState('ingress-gateway');
  const [impact, setImpact] = useState('enterprise');
  const [urgency, setUrgency] = useState('critical');
  const [source, setSource] = useState('manual');
  const [reproductionSteps, setReproductionSteps] = useState('');
  const [assignedTeam, setAssignedTeam] = useState('Platform SRE');
  const [environment, setEnvironment] = useState('production');
  const [category, setCategory] = useState('availability');
  const [tags, setTags] = useState('production, alert');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  // Phase 5: Triage and Duplicate Detection State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [triageResult, setTriageResult] = useState(null);
  const [duplicates, setDuplicates] = useState([]);

  const priorityCalc = previewPriority(impact, urgency);

  const handleRunTriage = async () => {
    if (!title.trim() && !description.trim()) {
      showError('Please provide a title or description before running triage analysis.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await incidentApi.getRecommendations({
        title,
        description,
        affectedService,
        impact,
        urgency,
        reproductionSteps,
        category,
      });
      if (res.success) {
        setTriageResult(res.recommendation);
        setDuplicates(res.duplicateCandidates || []);
        showInfo('Triage analysis & duplicate scan complete.');
      }
    } catch (err) {
      showError(err.message || 'Failed to fetch recommendations');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyAllSuggestions = () => {
    if (!triageResult) return;
    if (triageResult.suggestedCategory) setCategory(triageResult.suggestedCategory);
    if (triageResult.suggestedTeam) setAssignedTeam(triageResult.suggestedTeam);
    showSuccess('Applied triage recommendations to incident form.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationErrors([]);

    if (!title.trim()) {
      setValidationErrors(['Incident title is required.']);
      return;
    }
    if (!description.trim()) {
      setValidationErrors(['Incident description is required.']);
      return;
    }
    if (!affectedService.trim()) {
      setValidationErrors(['Affected service is required.']);
      return;
    }

    setIsSubmitting(true);

    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        title: title.trim(),
        description: description.trim(),
        reproductionSteps: reproductionSteps.trim(),
        affectedService: affectedService.trim().toLowerCase(),
        impact,
        urgency,
        source,
        category,
        assignedTeam,
        environment,
        tags: tagList,
      };

      const res = await incidentApi.createIncident(payload);

      if (res.success && res.incident) {
        showSuccess(`Incident ${res.incident.incidentNumber} created successfully.`);
        navigate(`/incidents/${res.incident.incidentNumber || res.incident._id}`);
      }
    } catch (err) {
      const msg = err.message || 'Failed to record incident.';
      setValidationErrors([msg]);
      showError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Declare Operational Incident"
        subtitle="Initiate triage queue record, deterministic priority matrix, and SLA countdowns"
        breadcrumbs={
          <button
            onClick={() => navigate('/incidents')}
            className="btn-subtle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', padding: 0 }}
          >
            <ArrowLeft size={13} /> Back to Incident Queue
          </button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Form Container */}
        <div className="card">
          {validationErrors.length > 0 && (
            <div className="alert-box alert-error" style={{ marginBottom: '1.25rem' }}>
              <AlertCircle size={16} />
              <div>
                <strong>Validation Errors:</strong>
                <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="title">
                Incident Title *
              </label>
              <input
                id="title"
                type="text"
                required
                className="form-input"
                placeholder="e.g. Elevate HTTP 502 Rate on Ingress Envoy Pods"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="affectedService">
                  Affected Service *
                </label>
                <input
                  id="affectedService"
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. ingress-gateway, payments-api"
                  value={affectedService}
                  onChange={(e) => setAffectedService(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="environment">
                  Deployment Environment
                </label>
                <select
                  id="environment"
                  className="form-select"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="impact">
                  Operational Impact *
                </label>
                <select
                  id="impact"
                  className="form-select"
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                >
                  <option value="enterprise">Enterprise (Widespread Customer Impact)</option>
                  <option value="department">Department (Subsystem / Group Degradation)</option>
                  <option value="single_user">Single User (Isolated Inconvenience)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="urgency">
                  Operational Urgency *
                </label>
                <select
                  id="urgency"
                  className="form-select"
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                >
                  <option value="critical">Critical (Immediate Response Required)</option>
                  <option value="moderate">Moderate (Standard Operating Protocol)</option>
                  <option value="low">Low (Non-Blocking / Next Shift)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="source">
                  Detection Source
                </label>
                <select
                  id="source"
                  className="form-select"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="manual">Manual / Human Operator</option>
                  <option value="prometheus">Prometheus Alertmanager</option>
                  <option value="datadog">Datadog Monitor</option>
                  <option value="cloudwatch">AWS CloudWatch</option>
                  <option value="synthetic">Synthetic Healthcheck</option>
                  <option value="webhook">Generic Webhook Ingestion</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="assignedTeam">
                  Assigned Response Team
                </label>
                <select
                  id="assignedTeam"
                  className="form-select"
                  value={assignedTeam}
                  onChange={(e) => setAssignedTeam(e.target.value)}
                >
                  <option value="Platform SRE">Platform SRE</option>
                  <option value="Payments Core">Payments Core</option>
                  <option value="Database Ops">Database Ops</option>
                  <option value="Edge & CDN">Edge & CDN</option>
                  <option value="Identity Service">Identity Service</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="description">
                Incident Description & Failure Symptoms *
              </label>
              <textarea
                id="description"
                rows={4}
                required
                className="form-textarea"
                placeholder="Detail error codes, logs, spike time, and observed user degradation..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reproductionSteps">
                Optional Reproduction Steps / Traces
              </label>
              <textarea
                id="reproductionSteps"
                rows={3}
                className="form-textarea"
                placeholder="1. Send POST /api/checkout with payload...&#10;2. Observe 504 Gateway Timeout in ingress logs"
                value={reproductionSteps}
                onChange={(e) => setReproductionSteps(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="tags">
                Classification Tags (comma-separated)
              </label>
              <input
                id="tags"
                type="text"
                className="form-input"
                placeholder="production, envoy, k8s, latency"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => navigate('/incidents')}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? 'Provisioning Ticket...' : 'Declare Incident'}
              </button>
            </div>
          </form>
        </div>

        {/* Right Sidebar: ITIL Matrix + Phase 5 Triage Intelligence & Duplicate Detector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Phase 5 Triage Copilot Card */}
          <div className="card" style={{ border: '1px solid var(--accent-forest)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={18} style={{ color: 'var(--accent-forest)' }} />
                <h3 style={{ fontSize: '0.95rem', margin: 0, fontWeight: 600 }}>Triage Intelligence</h3>
              </div>
              <button
                type="button"
                onClick={handleRunTriage}
                disabled={isAnalyzing}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
              >
                {isAnalyzing ? 'Analyzing...' : 'Run Triage Analysis'}
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Analyzes incident text, error patterns, and service responsibilities via Gemini AI with deterministic fallback.
            </p>

            {triageResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Method & Confidence Info */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <span
                    className={`badge ${triageResult.classificationMethod === 'gemini_ai_copilot' ? 'badge-primary' : 'badge-neutral'}`}
                    style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}
                  >
                    {triageResult.classificationMethod === 'gemini_ai_copilot' ? '⚡ Gemini AI Copilot' : '⚙️ Rule-Based Heuristic'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {triageResult.confidenceInfo?.heuristicMatchScore
                      ? `Heuristic Signal: ${Math.round(triageResult.confidenceInfo.heuristicMatchScore * 100)}%`
                      : `Confidence: ${Math.round((triageResult.confidenceInfo?.modelConfidenceScore || 0.85) * 100)}%`}
                  </span>
                </div>

                {/* Suggestions Grid */}
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.825rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Category:</span>
                    <strong style={{ textTransform: 'capitalize' }}>{triageResult.suggestedCategory}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Priority:</span>
                    <PriorityBadge priority={triageResult.suggestedPriority} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Suggested Team:</span>
                    <strong>{triageResult.suggestedTeam}</strong>
                  </div>
                </div>

                {/* Explanation */}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                  "{triageResult.explanation}"
                </div>

                {/* Evidence Tokens */}
                {triageResult.evidence && triageResult.evidence.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      Supporting Evidence
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {triageResult.evidence.slice(0, 3).map((ev, i) => (
                        <li key={i}>{ev}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Uncalibrated Disclaimer */}
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {triageResult.confidenceInfo?.disclaimer || 'Heuristic rule score reflecting keyword pattern matches, not a calibrated probability.'}
                </div>

                <button
                  type="button"
                  onClick={handleApplyAllSuggestions}
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', marginTop: '0.25rem' }}
                >
                  <Check size={14} /> Apply Triage Suggestions to Form
                </button>
              </div>
            ) : (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Click "Run Triage Analysis" to generate category, priority, and resolver team suggestions.
              </div>
            )}
          </div>

          {/* Suspected Duplicate Detection Warning Card */}
          {duplicates.length > 0 && (
            <div className="card" style={{ border: '1px solid #E69B00', backgroundColor: '#FFFDF9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <AlertTriangle size={17} style={{ color: '#D97706' }} />
                <h4 style={{ fontSize: '0.9rem', margin: 0, color: '#92400E', fontWeight: 600 }}>
                  Suspected Duplicate Incidents ({duplicates.filter((d) => d.isSuspectedDuplicate).length})
                </h4>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#78350F', marginBottom: '0.75rem' }}>
                Lexical TF-IDF cosine similarity detected matching historical incidents. <strong>ResolveIQ never automatically merges or deletes tickets.</strong>
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {duplicates.map((dup) => (
                  <div
                    key={dup.candidateId}
                    style={{
                      padding: '0.6rem',
                      border: '1px solid #FDE68A',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: '#FFFFFF',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--accent-forest)' }}>
                        {dup.incidentNumber}
                      </span>
                      <span
                        className={`badge ${dup.isSuspectedDuplicate ? 'badge-danger' : 'badge-neutral'}`}
                        style={{ fontSize: '0.68rem' }}
                      >
                        {Math.round(dup.similarityScore * 100)}% match
                      </span>
                    </div>
                    <div style={{ fontSize: '0.775rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                      {dup.title}
                    </div>
                    {dup.matchingEvidence && dup.matchingEvidence.length > 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Matching tokens: <em>{dup.matchingEvidence.join(', ')}</em>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deterministic ITIL Matrix */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Shield size={18} style={{ color: 'var(--accent-forest)' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Deterministic ITIL Matrix</h3>
            </div>

            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              ResolveIQ prioritizes incidents via a deterministic 3×3 matrix of operational impact and urgency.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem',
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Calculated Priority</div>
                <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                  {priorityCalc.code} — {priorityCalc.label}
                </div>
              </div>
              <PriorityBadge priority={priorityCalc.code} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={13} /> Response SLA Target:
                </span>
                <strong>{priorityCalc.response}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={13} /> Resolution SLA Target:
                </span>
                <strong>{priorityCalc.resolve}</strong>
              </div>
            </div>
          </div>

          <div className="card" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Automated Server Handlers</h4>
            <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', margin: 0 }}>
              <li>Sequential ticket ID generated via database counter (`INC-XXXX`)</li>
              <li>Reporter locked to session user: <strong>{user?.name || 'Authorized Responder'}</strong></li>
              <li>Immutable audit log initialized for compliance</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
