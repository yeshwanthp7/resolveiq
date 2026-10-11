import DeploymentEvent from '../models/DeploymentEvent.js';
import AuditLog from '../models/AuditLog.js';
import { emitIncidentEvent } from '../services/socketService.js';

/**
 * 1. Query deployments with filtering, search, and pagination
 */
export async function getDeployments(req, res, next) {
  try {
    const { service, environment, status, search, startDate, endDate, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (service && service !== 'all') {
      filter.$or = [
        { service: service.toLowerCase().trim() },
        { serviceName: service.toLowerCase().trim() },
      ];
    }

    if (environment && environment !== 'all') {
      filter.environment = environment;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.deployedAt = {};
      if (startDate) filter.deployedAt.$gte = new Date(startDate);
      if (endDate) filter.deployedAt.$lte = new Date(endDate);
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchRegex = new RegExp(q, 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { service: searchRegex },
          { serviceName: searchRegex },
          { version: searchRegex },
          { commitHash: searchRegex },
          { changeSummary: searchRegex },
          { changeReference: searchRegex },
        ],
      });
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [total, deployments] = await Promise.all([
      DeploymentEvent.countDocuments(filter),
      DeploymentEvent.find(filter)
        .sort({ deployedAt: -1 })
        .skip(skip)
        .limit(take)
        .populate('correlatedIncidents', 'incidentNumber title priority status affectedService')
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page, 10),
      limit: take,
      deployments,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Get single deployment event by ID
 */
export async function getDeploymentById(req, res, next) {
  try {
    const { id } = req.params;
    const deployment = await DeploymentEvent.findById(id)
      .populate('correlatedIncidents', 'incidentNumber title priority status affectedService assignedTeam createdAt')
      .lean();

    if (!deployment) {
      return res.status(404).json({ success: false, error: 'Deployment event not found.' });
    }

    res.status(200).json({
      success: true,
      deployment,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Create a deployment event (restricted to authorized roles)
 */
export async function createDeployment(req, res, next) {
  try {
    const {
      service,
      serviceName,
      version,
      environment = 'production',
      deployedAt = new Date(),
      status = 'success',
      changeSummary,
      changeReference,
      commitHash,
    } = req.body;

    const targetService = (service || serviceName || '').toLowerCase().trim();

    if (!targetService || !version || !changeSummary) {
      return res.status(400).json({
        success: false,
        error: 'service, version, and changeSummary are required fields.',
      });
    }

    const deployment = await DeploymentEvent.create({
      service: targetService,
      serviceName: targetService,
      version: version.trim(),
      environment,
      deployedAt: new Date(deployedAt),
      status,
      changeSummary: changeSummary.trim(),
      changeReference: changeReference ? changeReference.trim() : '',
      commitHash: commitHash ? commitHash.trim() : undefined,
      deployedBy: req.user ? `${req.user.name} (${req.user.role})` : 'ci/cd-pipeline',
    });

    // Record in AuditLog
    await AuditLog.create({
      incidentId: deployment._id, // References deployment ID for audit tracking
      actorId: req.user?._id || null,
      actorName: req.user?.name || 'Automation Pipeline',
      actorRole: req.user?.role || 'system',
      action: 'DEPLOYMENT_RECORDED',
      newState: {
        service: deployment.service,
        version: deployment.version,
        environment: deployment.environment,
        status: deployment.status,
      },
      reason: `Deployment ${deployment.version} recorded for ${deployment.service}: ${changeSummary}`,
    });

    emitIncidentEvent('deployment:created', deployment);

    res.status(201).json({
      success: true,
      deployment,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Update deployment event
 */
export async function updateDeployment(req, res, next) {
  try {
    const { id } = req.params;
    const { status, changeSummary, changeReference, correlatedIncidents } = req.body;

    const deployment = await DeploymentEvent.findById(id);
    if (!deployment) {
      return res.status(404).json({ success: false, error: 'Deployment event not found.' });
    }

    if (status) deployment.status = status;
    if (changeSummary) deployment.changeSummary = changeSummary.trim();
    if (changeReference !== undefined) deployment.changeReference = changeReference.trim();
    if (correlatedIncidents && Array.isArray(correlatedIncidents)) {
      deployment.correlatedIncidents = correlatedIncidents;
    }

    await deployment.save();

    res.status(200).json({
      success: true,
      deployment,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Delete deployment event (admin only)
 */
export async function deleteDeployment(req, res, next) {
  try {
    const { id } = req.params;
    const deployment = await DeploymentEvent.findByIdAndDelete(id);
    if (!deployment) {
      return res.status(404).json({ success: false, error: 'Deployment event not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Deployment event deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
}
