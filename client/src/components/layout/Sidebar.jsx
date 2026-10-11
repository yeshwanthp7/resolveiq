import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  AlertOctagon,
  PlusCircle,
  GitBranch,
  Rocket,
  BookOpen,
  BarChart3,
  Users2,
  SlidersHorizontal,
  Settings,
  X,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    heading: 'Core Operations',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/incidents', label: 'Incident Queue', icon: AlertOctagon },
      { to: '/incidents/new', label: 'New Incident', icon: PlusCircle },
    ],
  },
  {
    heading: 'Investigation & Graph',
    items: [
      { to: '/correlation-graph', label: 'Correlation Graph', icon: GitBranch },
      { to: '/deployments', label: 'Deployments', icon: Rocket },
      { to: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
    ],
  },
  {
    heading: 'Performance & Roster',
    items: [
      { to: '/analytics', label: 'Analytics & SLA', icon: BarChart3 },
      { to: '/team-workload', label: 'Team Workload', icon: Users2 },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { to: '/settings/integrations', label: 'Integrations', icon: SlidersHorizontal },
      { to: '/settings/general', label: 'General Settings', icon: Settings },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      {/* Brand Header */}
      <div
        style={{
          height: 'var(--topbar-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1.25rem',
          borderBottom: '1px solid var(--border-neutral)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: 'var(--accent-forest)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
            }}
          >
            <Activity size={17} />
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              ResolveIQ
            </span>
            <span
              style={{
                fontSize: '0.65rem',
                marginLeft: '0.35rem',
                padding: '1px 4px',
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: '2px',
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              ENTERPRISE
            </span>
          </div>
        </div>

        {/* Mobile Close Button */}
        <button
          onClick={onClose}
          className="btn btn-subtle mobile-close-btn"
          aria-label="Close menu"
          style={{ padding: '0.25rem', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation Sections */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0.75rem' }}>
        {NAV_GROUPS.map((group, groupIdx) => (
          <div key={groupIdx} style={{ marginBottom: '1.25rem' }}>
            <div
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                padding: '0 0.5rem 0.4rem 0.5rem',
              }}
            >
              {group.heading}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => onClose && onClose()}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      padding: '0.45rem 0.65rem',
                      fontSize: '0.835rem',
                      fontWeight: isActive ? 600 : 500,
                      borderRadius: 'var(--radius-sm)',
                      color: isActive ? 'var(--accent-forest)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'var(--accent-forest-subtle)' : 'transparent',
                      transition: 'background-color 0.1s ease',
                    })}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sidebar Footer */}
      <div
        style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--border-neutral)',
          backgroundColor: 'var(--bg-surface)',
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
        }}
      >
        <div>MERN Architecture</div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Deterministic Engine v1.0</div>
      </div>
    </aside>
  );
}
