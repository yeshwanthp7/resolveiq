import User from '../models/User.js';
import Team from '../models/Team.js';
import Incident from '../models/Incident.js';
import Resolution from '../models/Resolution.js';
import SLAPolicy from '../models/SLAPolicy.js';
import { computeSlaTargets } from '../utils/slaEngine.js';

/**
 * Repeatable, idempotent seeder for ResolveIQ foundation.
 * Safely executes on repeated runs without duplicating records.
 */
export async function seedInitialData() {
  console.log('[Seed] Checking and seeding enterprise foundation data...');

  // 1. Seed Teams
  const teamsData = [
    {
      name: 'Platform SRE',
      tier: 'tier-1',
      services: ['order-processing', 'kubernetes-cluster'],
      description: 'Core infrastructure reliability and cluster orchestration',
    },
    {
      name: 'Payments Core',
      tier: 'tier-1',
      services: ['payments-service'],
      description: 'Stripe and banking settlement pipeline',
    },
    {
      name: 'Database Ops',
      tier: 'tier-1',
      services: ['database-cluster'],
      description: 'MongoDB replica sets and transactional datastores',
    },
    {
      name: 'Edge & CDN',
      tier: 'tier-1',
      services: ['ingress-gateway'],
      description: 'Cloudflare, Envoy edge routing, and TLS termination',
    },
    {
      name: 'Identity Service',
      tier: 'tier-2',
      services: ['auth-service'],
      description: 'SSO, JWT authorization, and user directory',
    },
  ];

  for (const t of teamsData) {
    await Team.findOneAndUpdate({ name: t.name }, { $set: t }, { upsert: true, new: true });
  }

  // 2. Seed Users
  const usersData = [
    {
      name: 'Commander Sarah Chen',
      email: 'commander.chen@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'commander',
      team: 'Core Incident Response',
      skills: ['k8s', 'incident-command', 'aws', 'payments'],
    },
    {
      name: 'SRE Raj Patel',
      email: 'resolver.raj@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'resolver',
      team: 'Platform SRE',
      skills: ['kubernetes', 'postgres', 'docker', 'networking'],
    },
    {
      name: 'Admin Alex Rivera',
      email: 'admin.ops@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'admin',
      team: 'Database Ops',
      skills: ['security', 'mongodb', 'iam', 'infrastructure'],
    },
    {
      name: 'Observer Jordan Taylor',
      email: 'observer.taylor@resolveiq.io',
      password: 'EnterprisePass123!',
      role: 'observer',
      team: 'Compliance & Risk',
      skills: ['audit', 'sla-reporting', 'soc2'],
    },
  ];

  for (const u of usersData) {
    const existing = await User.findOne({ email: u.email });
    if (!existing) {
      await User.create(u);
    }
  }

  const sarahUser = await User.findOne({ email: 'commander.chen@resolveiq.io' });
  const rajUser = await User.findOne({ email: 'resolver.raj@resolveiq.io' });

  // 3. Seed SLA Policies
  const policies = [
    { name: 'P1 Mission Critical', priority: 'P1', responseTargetMinutes: 15, resolutionTargetMinutes: 120 },
    { name: 'P2 Major Degradation', priority: 'P2', responseTargetMinutes: 30, resolutionTargetMinutes: 240 },
    { name: 'P3 Moderate Business', priority: 'P3', responseTargetMinutes: 120, resolutionTargetMinutes: 720 },
    { name: 'P4 Minor Issue', priority: 'P4', responseTargetMinutes: 240, resolutionTargetMinutes: 1440 },
    { name: 'P5 Informational Query', priority: 'P5', responseTargetMinutes: 480, resolutionTargetMinutes: 4320 },
  ];

  for (const p of policies) {
    await SLAPolicy.findOneAndUpdate({ priority: p.priority }, { $set: p }, { upsert: true });
  }

  // 4. Seed Historical Incidents & Verified Resolutions (Idempotent by incidentNumber)
  const historicalIncidents = [
    {
      incidentNumber: 'INC-1001',
      title: 'High HTTP 502 Rate on Ingress Gateway during Checkout Surge',
      description: 'Upstream payment processing pods throwing connection timeouts. 14% of client requests failing at the edge ingress router.',
      affectedService: 'ingress-gateway',
      source: 'datadog',
      category: 'availability',
      impact: 'enterprise',
      urgency: 'critical',
      priority: 'P1',
      status: 'investigating',
      assignedTeam: 'Edge & CDN',
      assignee: rajUser?._id,
      acknowledgedAt: new Date(Date.now() - 25 * 60 * 1000),
      sla: computeSlaTargets('P1', new Date(Date.now() - 35 * 60 * 1000)),
      classificationMetadata: {
        environment: 'production',
        tags: ['edge', '502-bad-gateway', 'traffic-spike'],
        confidenceScore: 0.95,
      },
    },
    {
      incidentNumber: 'INC-1004',
      title: 'Stripe Webhook Signature Mismatch on Currency Conversion Service',
      description: 'Payload signature verification rejected 12 events. Secret rotation completed without reloading worker process pods.',
      affectedService: 'payments-service',
      source: 'manual',
      category: 'security',
      impact: 'single_user',
      urgency: 'moderate',
      priority: 'P4',
      status: 'resolved',
      assignedTeam: 'Payments Core',
      assignee: rajUser?._id,
      acknowledgedAt: new Date(Date.now() - 180 * 60 * 1000),
      mitigatedAt: new Date(Date.now() - 60 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 45 * 60 * 1000),
      sla: computeSlaTargets('P4', new Date(Date.now() - 240 * 60 * 1000)),
      classificationMetadata: {
        environment: 'production',
        tags: ['payments', 'stripe', 'secret-rotation'],
        confidenceScore: 1.0,
      },
    },
  ];

  for (const inc of historicalIncidents) {
    const existing = await Incident.findOne({ incidentNumber: inc.incidentNumber });
    if (!existing) {
      const created = await Incident.create(inc);

      // If resolved, seed verified resolution record
      if (inc.status === 'resolved' && rajUser) {
        await Resolution.findOneAndUpdate(
          { incidentId: created._id },
          {
            $set: {
              incidentId: created._id,
              rootCauseCategory: 'configuration_drift',
              summary: 'Secret rotation was completed on AWS Secrets Manager but Kubernetes worker pods held stale environment variable.',
              remediationSteps: [
                'Triggered rolling restart of payment worker deployment: kubectl rollout restart deploy/payment-worker',
                'Validated Stripe webhook signature verification on test webhook payload',
                'Replayed 12 dropped transaction events through Stripe batch replay API',
              ],
              preventativeActions: [
                'Implement dynamic secret reload via HashiCorp Vault / External Secrets Operator',
              ],
              resolvedBy: rajUser._id,
              resolvedAt: new Date(Date.now() - 45 * 60 * 1000),
              runbookUrl: 'https://wiki.resolveiq.io/runbooks/payments-secret-rotation',
            },
          },
          { upsert: true }
        );
      }
    }
  }

  console.log('[Seed] Enterprise foundation data verified and seeded.');
}
