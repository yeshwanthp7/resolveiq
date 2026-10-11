import React, { useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import { Settings, Check, Clock, Bell } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function GeneralSettings() {
  const { showSuccess } = useToast();

  const [orgName, setOrgName] = useState('Acme Global Infrastructure');
  const [defaultEnv, setDefaultEnv] = useState('production');
  const [slaPolicy, setSlaPolicy] = useState('24x7');
  const [escalationTimeout, setEscalationTimeout] = useState('15');
  const [notifyOnP1, setNotifyOnP1] = useState(true);

  const handleSave = (e) => {
    e.preventDefault();
    showSuccess('General operational preferences updated.');
  };

  return (
    <div>
      <PageHeader
        title="General System Settings"
        subtitle="Operational defaults, SLA policy scheduling, and global escalation timers"
      />

      <form onSubmit={handleSave} style={{ maxWidth: '800px' }}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Settings size={18} style={{ color: 'var(--accent-forest)' }} />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Organization & Environment Defaults</h3>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="orgName">
              Organization Name
            </label>
            <input
              id="orgName"
              type="text"
              className="form-input"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="defaultEnv">
              Default Incident Triage Environment
            </label>
            <select
              id="defaultEnv"
              className="form-select"
              value={defaultEnv}
              onChange={(e) => setDefaultEnv(e.target.value)}
            >
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
          </div>
        </div>

        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Clock size={18} style={{ color: 'var(--accent-forest)' }} />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>SLA Policy Timing Engine</h3>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="slaPolicy">
              SLA Clock Operation Mode
            </label>
            <select
              id="slaPolicy"
              className="form-select"
              value={slaPolicy}
              onChange={(e) => setSlaPolicy(e.target.value)}
            >
              <option value="24x7">24x7 Continuous (Mission-critical production)</option>
              <option value="business_hours">Business Hours (8am - 6pm UTC)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="escTime">
              P1 Escalation Unacknowledged Alert Warning (Minutes)
            </label>
            <input
              id="escTime"
              type="number"
              className="form-input"
              value={escalationTimeout}
              onChange={(e) => setEscalationTimeout(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary">
          <Check size={15} /> Save Settings
        </button>
      </form>
    </div>
  );
}
