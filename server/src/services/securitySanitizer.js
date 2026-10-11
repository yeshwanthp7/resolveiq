/**
 * Security & Sanitization Service for GenAI / LLM Ingestion
 * 
 * Enforces strict boundaries on untrusted incident inputs:
 * 1. Strips credentials, tokens, connection strings, and unnecessary PII.
 * 2. Defends against prompt injection attempts (e.g., "ignore previous instructions").
 * 3. Encases untrusted user text into rigid XML data delimiters.
 */

const SECRET_PATTERNS = [
  // JWT tokens
  { regex: /eyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}/g, replacement: '[REDACTED_JWT]' },
  // Bearer tokens
  { regex: /bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // AWS Access Keys
  { regex: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  // Private keys
  { regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  // Passwords, secrets, api keys in key=value or key: value format
  { regex: /(api_key|apikey|secret|password|passwd|auth_token|client_secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-.~!@#$%^&*]{6,}['"]?/gi, replacement: '$1: "[REDACTED_CREDENTIAL]"' },
  // Database connection strings with embedded credentials
  { regex: /([a-zA-Z+]+:\/\/)[^:]+:[^@]+@([a-zA-Z0-9.-]+)/gi, replacement: '$1[REDACTED_USER:PASS]@$2' },
  // Email addresses (PII minimization)
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
];

const PROMPT_INJECTION_SIGNALS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
  /override\s+(the\s+)?system\s+(prompt|rules|instructions)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|developer)\s+mode/i,
  /system\s+prompt\s*:/i,
  /bypass\s+(all\s+)?(safety|security)\s+filters/i,
];

/**
 * Sanitizes untrusted text by redacting secrets, credentials, and unnecessary PII
 */
export function sanitizeUntrustedText(text) {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text;
  let redactionCount = 0;

  for (const { regex, replacement } of SECRET_PATTERNS) {
    const matches = sanitized.match(regex);
    if (matches) {
      redactionCount += matches.length;
      sanitized = sanitized.replace(regex, replacement);
    }
  }

  // Detect and neutralize prompt injection attempts
  let hasInjectionAttempt = false;
  for (const pattern of PROMPT_INJECTION_SIGNALS) {
    if (pattern.test(sanitized)) {
      hasInjectionAttempt = true;
      sanitized = sanitized.replace(pattern, '[SECURITY_BLOCKED_PROMPT_INJECTION]');
    }
  }

  return {
    sanitized,
    redactionCount,
    hasInjectionAttempt,
  };
}

/**
 * Prepares safely encapsulated prompt input context
 */
export function encapsulateUntrustedInput(incident, historicalCases = []) {
  const sanitizedTitle = sanitizeUntrustedText(incident.title || '').sanitized;
  const sanitizedDesc = sanitizeUntrustedText(incident.description || '').sanitized;
  const sanitizedSteps = sanitizeUntrustedText(incident.reproductionSteps || '').sanitized;
  const sanitizedService = sanitizeUntrustedText(incident.affectedService || '').sanitized;

  const sanitizedCases = historicalCases.map((c) => ({
    incidentNumber: c.incidentNumber,
    title: sanitizeUntrustedText(c.title || '').sanitized,
    affectedService: sanitizeUntrustedText(c.affectedService || '').sanitized,
    rootCauseCategory: c.rootCauseCategory,
    summary: sanitizeUntrustedText(c.summary || '').sanitized,
    remediationSteps: (c.remediationSteps || []).map((s) => sanitizeUntrustedText(s).sanitized),
    preventativeActions: (c.preventativeActions || []).map((a) => sanitizeUntrustedText(a).sanitized),
    similarityScore: c.similarityScore,
    isVerified: c.isVerified,
  }));

  return {
    currentIncidentBlock: `
<untrusted_incident_input>
Ticket: ${incident.incidentNumber || 'UNSAVED'}
Service: ${sanitizedService}
Title: ${sanitizedTitle}
Description: ${sanitizedDesc}
Reproduction / Logs: ${sanitizedSteps || 'None'}
Impact: ${incident.impact || 'department'}
Urgency: ${incident.urgency || 'moderate'}
</untrusted_incident_input>`,
    historicalCasesBlock: `
<untrusted_historical_cases count="${sanitizedCases.length}">
${sanitizedCases
  .map(
    (c, idx) => `
[Case ${idx + 1}] Ticket: ${c.incidentNumber} (Verified Resolution, Match Score: ${c.similarityScore})
- Service: ${c.affectedService}
- Title: ${c.title}
- Root Cause: ${c.rootCauseCategory}
- Resolution Summary: ${c.summary}
- Remediation Steps: ${c.remediationSteps.join(' | ')}
- Preventative Actions: ${c.preventativeActions.join(' | ')}`
  )
  .join('\n')}
</untrusted_historical_cases>`,
    sanitizedCases,
  };
}
