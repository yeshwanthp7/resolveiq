import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoFill = (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1.5rem',
      }}
    >
      <div style={{ maxWidth: '440px', width: '100%' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              backgroundColor: 'var(--accent-forest)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              marginBottom: '0.75rem',
            }}
          >
            <Activity size={24} />
          </div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>ResolveIQ Console</h1>
          <p>Full-Stack Incident Response & Reliability Engineering</p>
        </div>

        {/* Login Form Card */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1.25rem' }}>Sign In to Enterprise Workspace</h2>

          {error && (
            <div className="alert-box alert-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">
                Corporate Email
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="email"
                  type="email"
                  required
                  className="form-input"
                  style={{ width: '100%', paddingLeft: '2.25rem' }}
                  placeholder="engineer@resolveiq.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Mail
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-secondary)',
                  }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type="password"
                  required
                  className="form-input"
                  style={{ width: '100%', paddingLeft: '2.25rem' }}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-secondary)',
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.75rem' }}
            >
              {isSubmitting ? 'Authenticating...' : 'Sign In'}
              <ArrowRight size={16} />
            </button>
          </form>

          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--border-neutral)',
              textAlign: 'center',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
            }}
          >
            Need an incident responder account?{' '}
            <Link to="/register" style={{ color: 'var(--accent-forest)', fontWeight: 600 }}>
              Register Responder
            </Link>
          </div>
        </div>

        {/* Demo Roles Helper */}
        <div
          className="card"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            padding: '1rem',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
              marginBottom: '0.5rem',
            }}
          >
            Phase 3 Role Quick-Pick
          </div>
          <div className="form-grid-2col" style={{ gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'flex-start' }}
              onClick={() => handleDemoFill('user@resolveiq.io', 'EnterprisePass123!')}
            >
              End User
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'flex-start' }}
              onClick={() => handleDemoFill('engineer@resolveiq.io', 'EnterprisePass123!')}
            >
              Support Engineer
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'flex-start' }}
              onClick={() => handleDemoFill('manager@resolveiq.io', 'EnterprisePass123!')}
            >
              Manager
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'flex-start' }}
              onClick={() => handleDemoFill('admin@resolveiq.io', 'EnterprisePass123!')}
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
