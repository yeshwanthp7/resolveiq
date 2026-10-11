import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Authenticating enterprise session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles) {
    const normalizeRole = (r) => {
      if (r === 'commander') return 'manager';
      if (r === 'resolver') return 'support_engineer';
      if (r === 'observer') return 'end_user';
      return r;
    };
    const userRole = normalizeRole(user?.role);
    const normalizedAllowed = allowedRoles.map(normalizeRole);

    if (!normalizedAllowed.includes(userRole)) {
      return (
        <div className="content-wrapper">
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <h2 style={{ marginBottom: '0.5rem', color: 'var(--color-p1)' }}>Access Restricted</h2>
            <p>
              Your current role (<strong>{user?.role}</strong>) does not have permission to access this section.
            </p>
          </div>
        </div>
      );
    }
  }

  return children;
}
