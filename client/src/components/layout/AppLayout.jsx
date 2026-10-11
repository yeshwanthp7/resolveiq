import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppLayout() {
  return (
    <div className="app-shell">
      {/* Enterprise Left Sidebar */}
      <Sidebar />

      {/* Main App Workspace */}
      <div className="app-main">
        <Topbar />

        <main className="content-container">
          <Outlet />
        </main>

        <footer
          style={{
            borderTop: '1px solid var(--border-neutral)',
            backgroundColor: 'var(--bg-surface)',
            padding: '0.75rem 2rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
          }}
        >
          <div>
            ResolveIQ Incident Intelligence & Lifecycle Platform • Phase 1 Enterprise UI
          </div>
          <div>
            Warm Ivory Canvas • Deterministic SLA Matrix • Strict RBAC Guard
          </div>
        </footer>
      </div>
    </div>
  );
}
