import { INITIAL_PREVIEW_INCIDENTS } from '../data/previewData';

const STORAGE_KEY = 'resolveiq_incidents_store';

export function getStoredIncidents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[IncidentStore] Failed to read from localStorage:', err);
  }
  // Initialize with preview dataset
  localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_PREVIEW_INCIDENTS));
  return INITIAL_PREVIEW_INCIDENTS;
}

export function saveStoredIncidents(incidents) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
  } catch (err) {
    console.warn('[IncidentStore] Failed to save to localStorage:', err);
  }
}

export function addIncident(newIncident) {
  const current = getStoredIncidents();
  const nextNumber = `INC-${1000 + current.length + 1}`;
  const record = {
    ...newIncident,
    id: `inc-${Date.now()}`,
    incidentNumber: nextNumber,
    createdAt: new Date().toISOString(),
    status: 'triggered',
    isResponseBreached: false,
    isResolutionBreached: false,
    auditLogs: [
      {
        id: `aud-${Date.now()}`,
        action: 'INCIDENT_CREATED',
        actorName: newIncident.authorName || 'Triage Officer',
        timestamp: new Date().toISOString(),
        reason: 'Manually logged through ResolveIQ Intake Console',
      },
    ],
  };

  const updated = [record, ...current];
  saveStoredIncidents(updated);
  return record;
}

export function getIncidentById(id) {
  const list = getStoredIncidents();
  return list.find((inc) => inc.id === id || inc.incidentNumber === id);
}

export function updateIncidentStatus(id, newStatus, reason = '', actorName = 'Commander') {
  const list = getStoredIncidents();
  const idx = list.findIndex((inc) => inc.id === id || inc.incidentNumber === id);
  if (idx === -1) return null;

  const target = { ...list[idx] };
  const prevStatus = target.status;
  target.status = newStatus;

  if (newStatus === 'acknowledged' && !target.respondedAt) {
    target.respondedAt = new Date().toISOString();
  }
  if (newStatus === 'resolved' && !target.resolvedAt) {
    target.resolvedAt = new Date().toISOString();
  }

  target.auditLogs = [
    {
      id: `aud-${Date.now()}`,
      action: 'STATUS_TRANSITION',
      actorName,
      timestamp: new Date().toISOString(),
      reason: reason || `Status transitioned from ${prevStatus} to ${newStatus}`,
    },
    ...(target.auditLogs || []),
  ];

  list[idx] = target;
  saveStoredIncidents(list);
  return target;
}
