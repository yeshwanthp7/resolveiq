/**
 * ResolveIQ SLA Engine & Operational Compliance Monitor
 *
 * CALENDAR HOURS ASSUMPTION:
 * All SLA countdown targets, elapsed durations, and deadlines operate strictly on
 * continuous calendar hours (24x7x365). Calculations run continuously without pause
 * across nights, weekends, and statutory holidays. This reflects modern high-availability
 * cloud infrastructure operations and site reliability engineering (SRE) expectations.
 * If business-hours policies are introduced in the future, calendar hours remains the
 * foundational deterministic baseline.
 */

export const SLA_TARGETS = {
  P1: { responseMinutes: 15, resolutionMinutes: 120, label: 'Critical' },
  P2: { responseMinutes: 30, resolutionMinutes: 240, label: 'High' },
  P3: { responseMinutes: 120, resolutionMinutes: 720, label: 'Moderate' },
  P4: { responseMinutes: 240, resolutionMinutes: 1440, label: 'Low' },
  P5: { responseMinutes: 480, resolutionMinutes: 4320, label: 'Informational' },
};

export const SLA_STATES = {
  ON_TRACK: 'On Track',
  AT_RISK: 'At Risk',
  BREACHED: 'Breached',
  MET: 'Met',
  NOT_APPLICABLE: 'Not Applicable',
};

// Default threshold where active incidents enter 'At Risk' warning state (80% of budget)
export const DEFAULT_AT_RISK_THRESHOLD_RATIO = 0.8;

/**
 * Compute response and resolution targets and deadlines
 * Uses calendar hours (continuous elapsed time)
 */
export function computeSlaTargets(priority, createdAt = new Date(), customTargets = null) {
  const baseDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const validBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;

  const targets = customTargets || SLA_TARGETS[priority] || SLA_TARGETS.P4;
  const responseMinutes = targets.responseMinutes ?? targets.responseTargetMinutes ?? 240;
  const resolutionMinutes = targets.resolutionMinutes ?? targets.resolutionTargetMinutes ?? 1440;

  const responseDeadline = new Date(validBase.getTime() + responseMinutes * 60 * 1000);
  const resolutionDeadline = new Date(validBase.getTime() + resolutionMinutes * 60 * 1000);

  return {
    responseTargetMinutes: responseMinutes,
    resolutionTargetMinutes: resolutionMinutes,
    responseDeadline,
    resolutionDeadline,
    isResponseBreached: false,
    isResolutionBreached: false,
  };
}

/**
 * Calculate acknowledgement time in minutes (or null if unacknowledged / missing timestamps)
 */
export function calculateAcknowledgementTimeMinutes(incident) {
  if (!incident || !incident.acknowledgedAt || !incident.createdAt) {
    return null;
  }
  const created = new Date(incident.createdAt).getTime();
  const acked = new Date(incident.acknowledgedAt).getTime();
  if (isNaN(created) || isNaN(acked)) return null;

  return Math.max(0, Math.round((acked - created) / 60000));
}

/**
 * Calculate resolution time in minutes (or null if unresolved / missing timestamps)
 * Excludes unresolved incidents (returns null)
 */
export function calculateResolutionTimeMinutes(incident) {
  if (!incident || !incident.resolvedAt || !incident.createdAt) {
    return null;
  }
  // If incident status is reopened, it is unresolved
  if (incident.status === 'reopened') {
    return null;
  }

  const created = new Date(incident.createdAt).getTime();
  const resolved = new Date(incident.resolvedAt).getTime();
  if (isNaN(created) || isNaN(resolved)) return null;

  return Math.max(0, Math.round((resolved - created) / 60000));
}

/**
 * Calculate time remaining until a deadline (positive if remaining, negative if overdue)
 */
export function calculateTimeRemainingMinutes(deadline, now = new Date()) {
  if (!deadline) return null;
  const dTime = new Date(deadline).getTime();
  const nTime = new Date(now).getTime();
  if (isNaN(dTime) || isNaN(nTime)) return null;

  return Math.round((dTime - nTime) / 60000);
}

/**
 * Evaluate SLA state and metrics for an incident
 *
 * Business Rules & State Transitions:
 * 1. RESPONSE SLA:
 *    - If acknowledged:
 *      - If acknowledgedAt <= responseDeadline -> 'Met'
 *      - Else -> 'Breached'
 *    - If unacknowledged:
 *      - If now > responseDeadline -> 'Breached'
 *      - Else if (now - createdAt) / (responseDeadline - createdAt) >= 0.80 -> 'At Risk'
 *      - Else -> 'On Track'
 *
 * 2. RESOLUTION SLA:
 *    - If reopened:
 *      - Active resolution clock is ticking against original resolution target.
 *      - If now > resolutionDeadline -> 'Breached'
 *      - Else if elapsed / target >= 0.80 -> 'At Risk'
 *      - Else -> 'On Track'
 *    - If resolved or closed (and not reopened):
 *      - If resolvedAt:
 *        - If resolvedAt <= resolutionDeadline -> 'Met'
 *        - Else -> 'Breached'
 *      - If resolvedAt is missing: defaults to 'Met' if closed within deadline, else 'Breached'
 *    - If unresolved / open:
 *      - If now > resolutionDeadline -> 'Breached'
 *      - Else if (now - createdAt) / (resolutionDeadline - createdAt) >= 0.80 -> 'At Risk'
 *      - Else -> 'On Track'
 *
 * 3. OVERALL STATE:
 *    - If response or resolution is 'Breached' -> 'Breached'
 *    - Else if response or resolution is 'At Risk' -> 'At Risk'
 *    - Else if resolution is 'Met' and (response is 'Met' or unbreached) -> 'Met'
 *    - Else -> 'On Track'
 */
export function evaluateSlaStatus(incident, now = new Date(), options = {}) {
  if (!incident) {
    return {
      overallState: SLA_STATES.NOT_APPLICABLE,
      responseState: SLA_STATES.NOT_APPLICABLE,
      resolutionState: SLA_STATES.NOT_APPLICABLE,
      isBreached: false,
    };
  }

  const currentDate = now instanceof Date ? now : new Date(now);
  const nowMs = isNaN(currentDate.getTime()) ? Date.now() : currentDate.getTime();

  const createdDate = incident.createdAt ? new Date(incident.createdAt) : new Date();
  const createdMs = isNaN(createdDate.getTime()) ? nowMs : createdDate.getTime();

  // Targets and deadlines
  const targets = SLA_TARGETS[incident.priority] || SLA_TARGETS.P4;
  const responseTargetMin = incident.sla?.responseTargetMinutes || targets.responseMinutes;
  const resolutionTargetMin = incident.sla?.resolutionTargetMinutes || targets.resolutionMinutes;

  const responseDeadlineMs = incident.sla?.responseDeadline
    ? new Date(incident.sla.responseDeadline).getTime()
    : createdMs + responseTargetMin * 60 * 1000;

  const resolutionDeadlineMs = incident.sla?.resolutionDeadline
    ? new Date(incident.sla.resolutionDeadline).getTime()
    : createdMs + resolutionTargetMin * 60 * 1000;

  const responseDeadline = new Date(responseDeadlineMs);
  const resolutionDeadline = new Date(resolutionDeadlineMs);

  const atRiskRatio = options.warningPercent
    ? options.warningPercent / 100
    : DEFAULT_AT_RISK_THRESHOLD_RATIO;

  // 1. Response State
  let responseState = SLA_STATES.ON_TRACK;
  let isResponseBreached = false;
  let responseTimeRemainingMinutes = null;

  if (incident.acknowledgedAt) {
    const ackMs = new Date(incident.acknowledgedAt).getTime();
    if (!isNaN(ackMs)) {
      if (ackMs <= responseDeadlineMs) {
        responseState = SLA_STATES.MET;
      } else {
        responseState = SLA_STATES.BREACHED;
        isResponseBreached = true;
      }
    }
  } else {
    // Unacknowledged
    responseTimeRemainingMinutes = Math.round((responseDeadlineMs - nowMs) / 60000);
    if (nowMs > responseDeadlineMs) {
      responseState = SLA_STATES.BREACHED;
      isResponseBreached = true;
    } else {
      const responseDurationMs = responseDeadlineMs - createdMs;
      const responseElapsedMs = Math.max(0, nowMs - createdMs);
      const ratio = responseDurationMs > 0 ? responseElapsedMs / responseDurationMs : 0;
      if (ratio >= atRiskRatio) {
        responseState = SLA_STATES.AT_RISK;
      } else {
        responseState = SLA_STATES.ON_TRACK;
      }
    }
  }

  // 2. Resolution State
  let resolutionState = SLA_STATES.ON_TRACK;
  let isResolutionBreached = false;
  let resolutionTimeRemainingMinutes = null;

  const isResolvedOrClosed = ['resolved', 'closed'].includes(incident.status);
  const isReopened = incident.status === 'reopened' || (incident.reopenedCount > 0 && !isResolvedOrClosed);

  if (isReopened) {
    // Reopened incident: resolution clock is open
    resolutionTimeRemainingMinutes = Math.round((resolutionDeadlineMs - nowMs) / 60000);
    if (nowMs > resolutionDeadlineMs) {
      resolutionState = SLA_STATES.BREACHED;
      isResolutionBreached = true;
    } else {
      const resolutionDurationMs = resolutionDeadlineMs - createdMs;
      const resolutionElapsedMs = Math.max(0, nowMs - createdMs);
      const ratio = resolutionDurationMs > 0 ? resolutionElapsedMs / resolutionDurationMs : 0;
      if (ratio >= atRiskRatio) {
        resolutionState = SLA_STATES.AT_RISK;
      } else {
        resolutionState = SLA_STATES.ON_TRACK;
      }
    }
  } else if (isResolvedOrClosed) {
    // Resolved / Closed
    if (incident.resolvedAt) {
      const resMs = new Date(incident.resolvedAt).getTime();
      if (!isNaN(resMs)) {
        if (resMs <= resolutionDeadlineMs) {
          resolutionState = SLA_STATES.MET;
        } else {
          resolutionState = SLA_STATES.BREACHED;
          isResolutionBreached = true;
        }
      } else {
        resolutionState = SLA_STATES.MET;
      }
    } else {
      resolutionState = nowMs <= resolutionDeadlineMs ? SLA_STATES.MET : SLA_STATES.BREACHED;
      if (resolutionState === SLA_STATES.BREACHED) isResolutionBreached = true;
    }
  } else {
    // Unresolved & Open
    resolutionTimeRemainingMinutes = Math.round((resolutionDeadlineMs - nowMs) / 60000);
    if (nowMs > resolutionDeadlineMs) {
      resolutionState = SLA_STATES.BREACHED;
      isResolutionBreached = true;
    } else {
      const resolutionDurationMs = resolutionDeadlineMs - createdMs;
      const resolutionElapsedMs = Math.max(0, nowMs - createdMs);
      const ratio = resolutionDurationMs > 0 ? resolutionElapsedMs / resolutionDurationMs : 0;
      if (ratio >= atRiskRatio) {
        resolutionState = SLA_STATES.AT_RISK;
      } else {
        resolutionState = SLA_STATES.ON_TRACK;
      }
    }
  }

  // 3. Overall State
  let overallState = SLA_STATES.ON_TRACK;
  if (isResponseBreached || isResolutionBreached) {
    overallState = SLA_STATES.BREACHED;
  } else if (responseState === SLA_STATES.AT_RISK || resolutionState === SLA_STATES.AT_RISK) {
    overallState = SLA_STATES.AT_RISK;
  } else if (resolutionState === SLA_STATES.MET && (responseState === SLA_STATES.MET || !incident.acknowledgedAt)) {
    overallState = SLA_STATES.MET;
  } else {
    overallState = SLA_STATES.ON_TRACK;
  }

  return {
    overallState,
    responseState,
    resolutionState,
    isBreached: isResponseBreached || isResolutionBreached,
    isResponseBreached,
    isResolutionBreached,
    responseDeadline,
    resolutionDeadline,
    responseTimeRemainingMinutes,
    resolutionTimeRemainingMinutes,
    acknowledgementTimeMinutes: calculateAcknowledgementTimeMinutes(incident),
    resolutionTimeMinutes: calculateResolutionTimeMinutes(incident),
  };
}
