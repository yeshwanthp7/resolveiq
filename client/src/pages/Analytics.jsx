import React from 'react';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import PriorityBadge from '../components/common/PriorityBadge';
import { Clock, CheckCircle2, TrendingUp, AlertCircle, BarChart3 } from 'lucide-react';

export default function Analytics() {
  const severityBreakdown = [
    { priority: 'P1', total: 4, withinSla: 4, breached: 0, compliance: '100.0%' },
    { priority: 'P2', total: 9, withinSla: 8, breached: 1, compliance: '88.9%' },
    { priority: 'P3', total: 14, withinSla: 13, breached: 1, compliance: '92.8%' },
    { priority: 'P4', total: 22, withinSla: 22, breached: 0, compliance: '100.0%' },
    { priority: 'P5', total: 6, withinSla: 6, breached: 0, compliance: '100.0%' },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics & SLA Performance Evaluation"
        subtitle="MTTR, MTTD, response budgets, and human-in-the-loop recommendation accuracy"
        badge={<span className="badge badge-preview">[PREVIEW DATASET]</span>}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <StatCard
          title="Overall SLA Compliance"
          value="94.2%"
          subtitle="Target: 95.0% threshold"
          icon={Clock}
          isPreview
        />
        <StatCard
          title="MTTD (Time to Detect)"
          value="4.2 min"
          subtitle="Alert ingestion latency"
          icon={CheckCircle2}
          isPreview
        />
        <StatCard
          title="MTTA (Time to Acknowledge)"
          value="8.1 min"
          subtitle="Responder triage response"
          icon={TrendingUp}
          isPreview
        />
        <StatCard
          title="Recommendation Accuracy"
          value="87.5%"
          subtitle="Commander acceptance rate"
          icon={BarChart3}
          isPreview
        />
      </div>

      {/* Severity Breakdown Table */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>SLA Compliance by Priority Class</h3>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Total Incidents</th>
                <th>Within SLA</th>
                <th>Breached SLA</th>
                <th>Compliance Rate</th>
              </tr>
            </thead>
            <tbody>
              {severityBreakdown.map((row) => (
                <tr key={row.priority}>
                  <td><PriorityBadge priority={row.priority} /></td>
                  <td style={{ fontWeight: 600 }}>{row.total}</td>
                  <td style={{ color: 'var(--accent-forest)', fontWeight: 600 }}>{row.withinSla}</td>
                  <td style={{ color: row.breached > 0 ? '#B43B3B' : 'var(--text-secondary)' }}>
                    {row.breached}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{row.compliance}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
