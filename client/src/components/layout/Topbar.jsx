import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { systemApi } from '../../services/api';
import { LogOut, Activity, Search, Menu } from 'lucide-react';

export default function Topbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [healthStatus, setHealthStatus] = useState('checking');

  useEffect(() => {
    let isMounted = true;
    async function checkHealth() {
      try {
        const data = await systemApi.getHealth();
        if (isMounted) {
          setHealthStatus(data.status === 'healthy' ? 'online' : 'degraded');
        }
      } catch (err) {
        if (isMounted) {
          setHealthStatus('standalone'); // Graceful frontend local state
        }
      }
    }

    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'admin':
        return 'badge-p1';
      case 'manager':
      case 'commander':
        return 'badge-p4';
      case 'support_engineer':
      case 'resolver':
        return 'badge-p3';
      case 'end_user':
      case 'observer':
      default:
        return 'badge-p5';
    }
  };

  return (
    <header className="app-topbar">
      {/* Left: Mobile Menu Toggle & Global Quick Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <button
          onClick={onToggleSidebar}
          className="btn btn-subtle mobile-menu-btn"
          aria-label="Toggle navigation drawer"
          title="Open navigation menu"
          style={{ padding: '0.4rem', borderRadius: 'var(--radius-sm)' }}
        >
          <Menu size={20} />
        </button>

        <button
          onClick={() => navigate('/incidents')}
          className="btn btn-secondary topbar-search-btn"
          style={{
            fontSize: '0.8rem',
            padding: '0.35rem 0.65rem',
            color: 'var(--text-secondary)',
            gap: '0.4rem',
          }}
          title="Jump to Incident Triage"
        >
          <Search size={14} />
          <span className="search-text">Quick Search</span>
          <kbd
            className="desktop-only-kbd"
            style={{
              fontSize: '0.65rem',
              backgroundColor: 'var(--bg-subtle)',
              padding: '1px 4px',
              borderRadius: '2px',
              border: '1px solid var(--border-neutral)',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Connectivity Status & User Session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* System Health */}
        <div
          className="topbar-health-indicator"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            borderRight: '1px solid var(--border-neutral)',
            paddingRight: '0.75rem',
          }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                healthStatus === 'online'
                  ? '#16A34A'
                  : healthStatus === 'degraded'
                  ? '#D97736'
                  : '#747A74',
            }}
          />
          <span>
            {healthStatus === 'online'
              ? 'API Active'
              : healthStatus === 'degraded'
              ? 'Degraded'
              : 'Standby'}
          </span>
        </div>

        {/* User Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {user?.name || 'Authorized Responder'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.35rem' }}>
              <span className={`badge ${getRoleBadgeClass(user?.role)}`}>
                {user?.role || 'Observer'}
              </span>
              <span className="desktop-only" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {user?.team || 'Platform SRE'}
              </span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="btn btn-subtle"
            style={{ padding: '0.4rem', borderRadius: 'var(--radius-sm)' }}
            title="Sign Out of Session"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
