export const IMPACT_LEVELS = {
  ENTERPRISE: 'enterprise',
  DEPARTMENT: 'department',
  SINGLE_USER: 'single_user',
};

export const URGENCY_LEVELS = {
  CRITICAL: 'critical',
  MODERATE: 'moderate',
  LOW: 'low',
};

export const PRIORITY_CONFIG = {
  P1: { code: 'P1', label: 'Critical', color: '#B43B3B', description: 'Catastrophic business impact or widespread outage' },
  P2: { code: 'P2', label: 'Major', color: '#D97736', description: 'Severe degradation affecting significant customer operations' },
  P3: { code: 'P3', label: 'Moderate', color: '#B88822', description: 'Moderate business disruption with partial workaround' },
  P4: { code: 'P4', label: 'Minor', color: '#526B58', description: 'Minor operational inconvenience or localized issue' },
  P5: { code: 'P5', label: 'Informational', color: '#747A74', description: 'Low impact cosmetic, query, or planned maintenance' },
};

export function calculatePriority(impact, urgency) {
  const normImpact = (impact || '').toLowerCase().trim();
  const normUrgency = (urgency || '').toLowerCase().trim();

  if (normImpact === IMPACT_LEVELS.ENTERPRISE) {
    if (normUrgency === URGENCY_LEVELS.CRITICAL) return PRIORITY_CONFIG.P1;
    if (normUrgency === URGENCY_LEVELS.MODERATE) return PRIORITY_CONFIG.P2;
    if (normUrgency === URGENCY_LEVELS.LOW) return PRIORITY_CONFIG.P3;
  }

  if (normImpact === IMPACT_LEVELS.DEPARTMENT) {
    if (normUrgency === URGENCY_LEVELS.CRITICAL) return PRIORITY_CONFIG.P2;
    if (normUrgency === URGENCY_LEVELS.MODERATE) return PRIORITY_CONFIG.P3;
    if (normUrgency === URGENCY_LEVELS.LOW) return PRIORITY_CONFIG.P4;
  }

  if (normImpact === IMPACT_LEVELS.SINGLE_USER) {
    if (normUrgency === URGENCY_LEVELS.CRITICAL) return PRIORITY_CONFIG.P4;
    if (normUrgency === URGENCY_LEVELS.MODERATE) return PRIORITY_CONFIG.P4;
    if (normUrgency === URGENCY_LEVELS.LOW) return PRIORITY_CONFIG.P5;
  }

  return PRIORITY_CONFIG.P4;
}
