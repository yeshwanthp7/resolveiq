import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, Lock, Mail, User as UserIcon, Shield, AlertCircle, ArrowRight } from 'lucide-react';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('end_user');
  const [team, setTeam] = useState('Platform SRE');
  const [skills, setSkills] = useState('kubernetes, nodejs, linux');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);

    const skillsArray = skills
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    try {
      await register({
        name,
        email,
        password,
        role,
        team,
        skills: skillsArray,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. Please verify the information entered.');
    } finally {
      setIsSubmitting(false);
    }
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
        padding: '2rem 1.5rem',
      }}
    >
      <div style={{ maxWidth: '480px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
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
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>Register Responder Account</h1>
          <p>Join the enterprise incident triage roster</p>
        </div>

        <div className="card">
          {error && (
            <div className="alert-box alert-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="name">
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="name"
                  type="text"
                  required
                  className="form-input"
                  style={{ width: '100%', paddingLeft: '2.25rem' }}
                  placeholder="e.g. Maya Lin"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <UserIcon
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
                  placeholder="maya.lin@resolveiq.io"
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
                Password (min 6 characters)
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

            <div className="form-grid-2col">
              <div className="form-group">
                <label className="form-label" htmlFor="role">
                  Operational Role
                </label>
                <select
                  id="role"
                  className="form-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="end_user">End User (Report Incidents)</option>
                  <option value="support_engineer">Support Engineer (Investigate & Resolve)</option>
                  <option value="manager">Manager (Workload & Reassign)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="team">
                  Assigned Team
                </label>
                <select
                  id="team"
                  className="form-select"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                >
                  <option value="Platform SRE">Platform SRE</option>
                  <option value="Payments Core">Payments Core</option>
                  <option value="Database Ops">Database Ops</option>
                  <option value="Edge & CDN">Edge & CDN</option>
                  <option value="Identity Service">Identity Service</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="skills">
                Technical Skills (comma-separated)
              </label>
              <input
                id="skills"
                type="text"
                className="form-input"
                placeholder="k8s, postgres, nodejs, aws"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.75rem' }}
            >
              {isSubmitting ? 'Registering...' : 'Create Responder Profile'}
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
            Already registered?{' '}
            <Link to="/login" style={{ color: 'var(--accent-forest)', fontWeight: 600 }}>
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
