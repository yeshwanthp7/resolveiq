import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Incidents from './pages/Incidents';
import NewIncident from './pages/NewIncident';
import IncidentDetail from './pages/IncidentDetail';
import KnowledgeBase from './pages/KnowledgeBase';
import CorrelationGraph from './pages/CorrelationGraph';
import DeploymentEvents from './pages/DeploymentEvents';
import Analytics from './pages/Analytics';
import TeamWorkload from './pages/TeamWorkload';
import IntegrationSettings from './pages/IntegrationSettings';
import GeneralSettings from './pages/GeneralSettings';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Authentication Views */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected Enterprise Operations Shell */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="incidents/new" element={<NewIncident />} />
              <Route path="incidents/:id" element={<IncidentDetail />} />
              <Route
                path="correlation-graph"
                element={
                  <ProtectedRoute allowedRoles={['support_engineer', 'manager', 'admin']}>
                    <CorrelationGraph />
                  </ProtectedRoute>
                }
              />
              <Route
                path="deployments"
                element={
                  <ProtectedRoute allowedRoles={['support_engineer', 'manager', 'admin']}>
                    <DeploymentEvents />
                  </ProtectedRoute>
                }
              />
              <Route path="knowledge-base" element={<KnowledgeBase />} />
              <Route
                path="analytics"
                element={
                  <ProtectedRoute allowedRoles={['manager', 'admin']}>
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="team-workload"
                element={
                  <ProtectedRoute allowedRoles={['support_engineer', 'manager', 'admin']}>
                    <TeamWorkload />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings/integrations"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <IntegrationSettings />
                  </ProtectedRoute>
                }
              />
              <Route path="settings/general" element={<GeneralSettings />} />
            </Route>

            {/* Fallback Catch-All */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
