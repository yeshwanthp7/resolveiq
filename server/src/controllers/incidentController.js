import mongoose from 'mongoose';
import Incident from '../models/Incident.js';
import Resolution from '../models/Resolution.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { calculatePriority } from '../utils/priorityMatrix.js';
import { computeSlaTargets, evaluateSlaStatus } from '../utils/slaEngine.js';
import { normalizeRole } from '../middleware/auth.js';
import { emitIncidentEvent } from '../services/socketService.js';

export const PERMITTED_TRANSITIONS = {
  triggered: ['acknowledged', 'investigating', 'in_progress', 'closed'],
  new: ['acknowledged', 'investigating', 'in_progress', 'closed'],
  acknowledged: ['investigating', 'in_progress', 'mitigated', 'resolved', 'closed'],
  investigating: ['in_progress', 'mitigated', 'resolved', 'closed'],
  in_progress: ['investigating', 'mitigated', 'resolved', 'closed'],
  mitigated: ['investigating', 'in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'investigating', 'in_progress', 'reopened'],
  closed: ['investigating', 'in_progress', 'reopened', 'acknowledged'],
  reopened: ['investigating', 'in_progress', 'mitigated', 'resolved', 'closed'],
};

/**
 * 1. Create a new incident
 * Derives initial priority deterministically via 3x3 ITIL matrix
 * Computes initial SLA countdown targets
 * Locks reporter to authenticated user identity
 */
export async function createIncident(req, res, next) {
  try {
    const {
      title,
      description,
      affectedService,
      impact,
      urgency,
      source,
      category,
      assignedTeam,
      reproductionSteps,
      environment,
      tags,
      relatedIncidents,
    } = req.body;

    if (!title || !description || !affectedService || !impact || !urgency) {
      return res.status(400).json({
        success: false,
        error: 'Missing required incident fields: title, description, affectedService, impact, and urgency are required.',
      });
    }

    const priorityCalc = calculatePriority(impact, urgency);
    const sla = computeSlaTargets(priorityCalc.code, new Date());

    const tagList = Array.isArray(tags)
      ? tags
      : typeof tags === 'string'
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const incident = await Incident.create({
      title: title.trim(),
      description: description.trim(),
      reproductionSteps: reproductionSteps ? reproductionSteps.trim() : '',
      affectedService: affectedService.toLowerCase().trim(),
      source: source || 'manual',
      category: category || 'availability',
      impact,
      urgency,
      priority: priorityCalc.code,
      assignedTeam: assignedTeam || 'Platform SRE',
      reporter: req.user._id,
      sla,
      relatedIncidents: Array.isArray(relatedIncidents) ? relatedIncidents : [],
      classificationMetadata: {
        environment: environment || 'production',
        tags: tagList,
        confidenceScore: 1.0,
      },
    });

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INCIDENT_CREATED',
      newState: {
        incidentNumber: incident.incidentNumber,
        priority: incident.priority,
        status: incident.status,
      },
      reason: `Deterministic priority ${priorityCalc.code} (${priorityCalc.label}) initialized`,
    });

    emitIncidentEvent('incident:created', incident);

    res.status(201).json({
      success: true,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Query incidents with filtering, search, pagination, and role boundary scoping
 */
export async function getIncidents(req, res, next) {
  try {
    const userRole = normalizeRole(req.user.role);
    const filter = {};

    // Role-based boundary scoping
    if (userRole === 'end_user') {
      filter.$or = [{ reporter: req.user._id }, { reporter: req.user.name }, { reporter: req.user.email }];
    } else if (userRole === 'support_engineer') {
      filter.$or = [{ assignedTeam: req.user.team }, { assignee: req.user._id }];
    }

    // Additional query filters
    const { status, priority, service, team, environment, search, page, limit } = req.query;

    if (status && status !== 'all') {
      if (status.includes(',')) {
        filter.status = { $in: status.split(',').map((s) => s.trim()) };
      } else {
        filter.status = status;
      }
    }

    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    if (service && service !== 'all') {
      filter.affectedService = service.toLowerCase().trim();
    }

    if (team && team !== 'all') {
      filter.assignedTeam = team;
    }

    if (environment && environment !== 'all') {
      filter['classificationMetadata.environment'] = environment;
    }

    if (search) {
      const q = search.trim();
      const searchCondition = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { incidentNumber: { $regex: q, $options: 'i' } },
        { affectedService: { $regex: q, $options: 'i' } },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchCondition }];
        delete filter.$or;
      } else {
        filter.$or = searchCondition;
      }
    }

    const total = await Incident.countDocuments(filter);

    const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const limitNum = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 20;
    const skip = (pageNum - 1) * limitNum;

    const queryBuilder = Incident.find(filter)
      .populate('assignee', 'name email role team activeIncidentCount')
      .populate('reporter', 'name email role team')
      .sort({ createdAt: -1 });

    if (page || (limit && limit !== 'all')) {
      queryBuilder.skip(skip).limit(limitNum);
    }

    const incidents = await queryBuilder;

    res.status(200).json({
      success: true,
      count: incidents.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      incidents,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Retrieve single incident with full audit logs, resolution, and linked tickets
 */
export async function getIncidentById(req, res, next) {
  try {
    const { id } = req.params;
    const query = id.startsWith('INC-') ? { incidentNumber: id } : { _id: id };

    const incident = await Incident.findOne(query)
      .populate('assignee', 'name email role team activeIncidentCount')
      .populate('reporter', 'name email role team')
      .populate('relatedIncidents', 'incidentNumber title priority status affectedService assignedTeam');

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: `Incident '${id}' not found.`,
      });
    }

    // Role-based boundary verification
    const userRole = normalizeRole(req.user.role);
    if (userRole === 'end_user') {
      const isOwner =
        incident.reporter?.toString() === req.user._id.toString() ||
        incident.reporter === req.user.email ||
        incident.reporter === req.user.name ||
        incident.reporter?._id?.toString() === req.user._id.toString();

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: End users are only authorized to view incidents they reported.',
        });
      }
    } else if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee &&
        (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only access incidents assigned to their team or directly to them.',
        });
      }
    }

    const auditLogs = await AuditLog.find({ incidentId: incident._id }).sort({ timestamp: -1 });
    const resolution = await Resolution.findOne({ incidentId: incident._id });

    let populatedReporter = incident.reporter;
    if (incident.reporter && mongoose.isValidObjectId(incident.reporter)) {
      const u = await User.findById(incident.reporter).select('name email role team');
      if (u) {
        populatedReporter = u;
      }
    }

    const slaStatus = evaluateSlaStatus(incident, new Date());

    res.status(200).json({
      success: true,
      incident: {
        ...incident.toObject(),
        slaStatus,
        reporter: populatedReporter,
        auditLogs,
        resolution,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Edit non-restricted incident fields
 * Prevents unauthorized tampering of restricted fields (priority, SLA, status, assignee)
 */
export async function updateIncident(req, res, next) {
  try {
    const { id } = req.params;
    const { title, description, reproductionSteps, affectedService, category, environment, tags } = req.body;

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    // Role boundary: end users can only edit their own incident if not closed
    const userRole = normalizeRole(req.user.role);
    if (userRole === 'end_user') {
      const isOwner =
        incident.reporter?.toString() === req.user._id.toString() ||
        incident.reporter === req.user.email ||
        incident.reporter === req.user.name;
      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'Access denied: Cannot edit incidents reported by others.' });
      }
    } else if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee && (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();
      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only edit incidents assigned to their team or directly to them.',
        });
      }
    }

    const prevSnapshot = {
      title: incident.title,
      description: incident.description,
      reproductionSteps: incident.reproductionSteps,
      affectedService: incident.affectedService,
      category: incident.category,
    };

    const changes = [];
    if (title && title.trim() !== incident.title) {
      incident.title = title.trim();
      changes.push('title');
    }
    if (description && description.trim() !== incident.description) {
      incident.description = description.trim();
      changes.push('description');
    }
    if (reproductionSteps !== undefined && reproductionSteps !== incident.reproductionSteps) {
      incident.reproductionSteps = reproductionSteps.trim();
      changes.push('reproductionSteps');
    }
    if (affectedService && affectedService.toLowerCase().trim() !== incident.affectedService) {
      incident.affectedService = affectedService.toLowerCase().trim();
      changes.push('affectedService');
    }
    if (category && category !== incident.category) {
      incident.category = category;
      changes.push('category');
    }
    if (environment) {
      incident.classificationMetadata.environment = environment;
      changes.push('environment');
    }
    if (tags !== undefined) {
      const tagList = Array.isArray(tags)
        ? tags
        : typeof tags === 'string'
        ? tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
      incident.classificationMetadata.tags = tagList;
      changes.push('tags');
    }

    if (changes.length > 0) {
      await incident.save();

      await AuditLog.create({
        incidentId: incident._id,
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'INCIDENT_EDITED',
        previousState: prevSnapshot,
        newState: {
          title: incident.title,
          description: incident.description,
          reproductionSteps: incident.reproductionSteps,
          affectedService: incident.affectedService,
          category: incident.category,
        },
        reason: `Fields modified: ${changes.join(', ')}`,
      });
    }

    res.status(200).json({
      success: true,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Lifecycle status transition with validation of permitted state machine paths
 */
export async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = [
      'triggered',
      'new',
      'acknowledged',
      'investigating',
      'in_progress',
      'mitigated',
      'resolved',
      'closed',
      'reopened',
    ];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Permitted statuses: ${validStatuses.join(', ')}`,
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee &&
        (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only update incidents assigned to their team or directly to them.',
        });
      }
    }

    const currentStatus = incident.status;
    const permittedNext = PERMITTED_TRANSITIONS[currentStatus] || [];

    if (!permittedNext.includes(status) && currentStatus !== status) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition from '${currentStatus}' to '${status}'. Permitted next states: [${permittedNext.join(', ')}]`,
      });
    }

    const prevStatus = incident.status;
    incident.status = status;

    // Timestamps and specific lifecycle hooks
    if (status === 'acknowledged' && !incident.acknowledgedAt) {
      incident.acknowledgedAt = new Date();
    } else if (status === 'mitigated' && !incident.mitigatedAt) {
      incident.mitigatedAt = new Date();
    } else if (status === 'resolved' && !incident.resolvedAt) {
      incident.resolvedAt = new Date();
    } else if (status === 'closed' && !incident.closedAt) {
      incident.closedAt = new Date();
    } else if (status === 'reopened') {
      incident.reopenedAt = new Date();
      incident.reopenedCount += 1;
      incident.reopenReason = reason || 'Reopened for investigation';
    }

    // Evaluate and persist SLA breach state
    const slaStatus = evaluateSlaStatus(incident, new Date());
    if (incident.sla) {
      incident.sla.isResponseBreached = slaStatus.isResponseBreached;
      incident.sla.isResolutionBreached = slaStatus.isResolutionBreached;
    }

    await incident.save();

    const isReopen = status === 'reopened' || ((prevStatus === 'resolved' || prevStatus === 'closed') && (status === 'investigating' || status === 'in_progress'));

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: isReopen ? 'INCIDENT_REOPENED' : 'STATUS_TRANSITION',
      previousState: { status: prevStatus },
      newState: { status },
      reason: reason || (isReopen ? `Incident reopened: transitioned from ${prevStatus} to ${status}` : `Status updated from ${prevStatus} to ${status}`),
    });

    emitIncidentEvent('incident:updated', incident);

    res.status(200).json({
      success: true,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Explicit Reopen Endpoint
 * Permitted reopening path from resolved or closed
 */
export async function reopenIncident(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: 'A mandatory reason is required when reopening an incident.',
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    if (incident.status !== 'resolved' && incident.status !== 'closed') {
      return res.status(400).json({
        success: false,
        error: `Only resolved or closed incidents can be reopened. Current status: '${incident.status}'`,
      });
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee &&
        (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only reopen incidents assigned to their team or directly to them.',
        });
      }
    }

    const prevStatus = incident.status;
    incident.status = 'reopened';
    incident.reopenedAt = new Date();
    incident.reopenedCount += 1;
    const slaStatus = evaluateSlaStatus(incident, new Date());
    if (incident.sla) {
      incident.sla.isResolutionBreached = slaStatus.isResolutionBreached;
    }
    await incident.save();

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INCIDENT_REOPENED',
      previousState: { status: prevStatus },
      newState: { status: 'reopened', reopenedCount: incident.reopenedCount },
      reason: reason.trim(),
    });

    emitIncidentEvent('incident:reopened', incident);

    res.status(200).json({
      success: true,
      message: `Incident ${incident.incidentNumber} reopened successfully.`,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. Reassign incident team and engineer
 */
export async function reassignIncident(req, res, next) {
  try {
    const { id } = req.params;
    const { assigneeId, assignedTeam, reason } = req.body;

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    let newAssigneeUser = null;
    if (assigneeId) {
      newAssigneeUser = await User.findById(assigneeId);
      if (!newAssigneeUser) {
        return res.status(404).json({ success: false, error: 'Assignee engineer not found.' });
      }
      if (!newAssigneeUser.isActive) {
        return res.status(400).json({ success: false, error: 'Cannot assign incident to an inactive user.' });
      }
      if (newAssigneeUser.role === 'end_user') {
        return res.status(400).json({ success: false, error: 'Cannot assign incident to an end user.' });
      }
    }

    const prevAssignee = incident.assignee;
    const prevTeam = incident.assignedTeam;

    if (assigneeId !== undefined) {
      incident.assignee = assigneeId || null;
    }
    if (assignedTeam) {
      incident.assignedTeam = assignedTeam;
    }

    await incident.save();

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESOLVER_ASSIGNED',
      previousState: { assignee: prevAssignee, assignedTeam: prevTeam },
      newState: { assignee: incident.assignee, assignedTeam: incident.assignedTeam },
      reason: reason || `Assigned to ${newAssigneeUser?.name || 'Unassigned'} (${incident.assignedTeam})`,
    });

    emitIncidentEvent('incident:reassigned', incident);

    res.status(200).json({
      success: true,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 8. Record verified resolution
 */
export async function recordResolution(req, res, next) {
  try {
    const { id } = req.params;
    const { rootCauseCategory, summary, remediationSteps, preventativeActions, runbookUrl } = req.body;

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee &&
        (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only record resolutions for incidents assigned to their team or directly to them.',
        });
      }
    }

    if (!rootCauseCategory || !summary || !remediationSteps || !Array.isArray(remediationSteps) || remediationSteps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'rootCauseCategory, summary, and non-empty remediationSteps array are required.',
      });
    }

    const resolution = await Resolution.findOneAndUpdate(
      { incidentId: incident._id },
      {
        $set: {
          incidentId: incident._id,
          rootCauseCategory,
          summary: summary.trim(),
          remediationSteps,
          preventativeActions: preventativeActions || [],
          resolvedBy: req.user._id,
          resolvedAt: new Date(),
          runbookUrl: runbookUrl || '',
        },
      },
      { upsert: true, new: true }
    );

    incident.status = 'resolved';
    incident.resolvedAt = new Date();
    await incident.save();

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESOLUTION_RECORDED',
      newState: { resolutionId: resolution._id, rootCauseCategory },
      reason: `Verified resolution logged: ${summary}`,
    });

    emitIncidentEvent('incident:resolved', incident);

    res.status(200).json({
      success: true,
      resolution,
      incident,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 9. Append investigation note
 */
export async function addInvestigationNote(req, res, next) {
  try {
    const { id } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Investigation note text is required.',
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === 'support_engineer') {
      const isTeamIncident = incident.assignedTeam === req.user.team;
      const isAssigned =
        incident.assignee && (incident.assignee._id || incident.assignee).toString() === req.user._id.toString();

      if (!isTeamIncident && !isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Support Engineers can only append notes to their team incidents.',
        });
      }
    }

    const newNote = {
      authorId: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      note: note.trim(),
      createdAt: new Date(),
    };

    incident.investigationNotes.push(newNote);
    await incident.save();

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'NOTE_ADDED',
      newState: { noteSnippet: note.slice(0, 80) },
      reason: `Investigation note added by ${req.user.name}`,
    });

    res.status(201).json({
      success: true,
      note: newNote,
      investigationNotes: incident.investigationNotes,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 10. Link related ticket
 */
export async function linkRelatedIncident(req, res, next) {
  try {
    const { id } = req.params;
    const { relatedTicketId } = req.body;

    if (!relatedTicketId) {
      return res.status(400).json({
        success: false,
        error: 'relatedTicketId (ID or INC-number) is required.',
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const targetQuery = relatedTicketId.startsWith('INC-')
      ? { incidentNumber: relatedTicketId }
      : { _id: relatedTicketId };

    const targetIncident = await Incident.findOne(targetQuery);
    if (!targetIncident) {
      return res.status(404).json({
        success: false,
        error: `Target incident '${relatedTicketId}' to link not found.`,
      });
    }

    if (targetIncident._id.toString() === incident._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'An incident cannot link to itself.',
      });
    }

    const alreadyLinked = incident.relatedIncidents.some(
      (rel) => rel.toString() === targetIncident._id.toString()
    );

    if (!alreadyLinked) {
      incident.relatedIncidents.push(targetIncident._id);
      await incident.save();

      // Bidirectional link
      if (!targetIncident.relatedIncidents.includes(incident._id)) {
        targetIncident.relatedIncidents.push(incident._id);
        await targetIncident.save();
      }

      await AuditLog.create({
        incidentId: incident._id,
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'RELATED_TICKET_LINKED',
        newState: { linkedIncidentNumber: targetIncident.incidentNumber },
        reason: `Linked to related ticket ${targetIncident.incidentNumber}`,
      });
    }

    const populated = await Incident.findById(incident._id).populate(
      'relatedIncidents',
      'incidentNumber title priority status affectedService assignedTeam'
    );

    res.status(200).json({
      success: true,
      relatedIncidents: populated.relatedIncidents,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 11. Unlink related ticket
 */
export async function unlinkRelatedIncident(req, res, next) {
  try {
    const { id, relatedId } = req.params;

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    incident.relatedIncidents = incident.relatedIncidents.filter(
      (rel) => rel.toString() !== relatedId.toString()
    );
    await incident.save();

    await AuditLog.create({
      incidentId: incident._id,
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RELATED_TICKET_UNLINKED',
      newState: { unlinkedId: relatedId },
      reason: `Unlinked related ticket ${relatedId}`,
    });

    res.status(200).json({
      success: true,
      message: 'Related incident unlinked successfully.',
      relatedIncidents: incident.relatedIncidents,
    });
  } catch (err) {
    next(err);
  }
}
