import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor to format errors cleanly and handle session expiration
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected network error occurred';
    return Promise.reject(new Error(message));
  }
);

export const authApi = {
  register: (payload) => api.post('/auth/register', payload).then((res) => res.data),
  login: (payload) => api.post('/auth/login', payload).then((res) => res.data),
  logout: () => api.post('/auth/logout').then((res) => res.data),
  getMe: () => api.get('/auth/me').then((res) => res.data),
  getUsers: (params) => api.get('/auth/users', { params }).then((res) => res.data),
};

export const incidentApi = {
  getIncidents: (params) => api.get('/incidents', { params }).then((res) => res.data),
  getIncidentById: (id) => api.get(`/incidents/${id}`).then((res) => res.data),
  createIncident: (payload) => api.post('/incidents', payload).then((res) => res.data),
  updateIncident: (id, payload) => api.patch(`/incidents/${id}`, payload).then((res) => res.data),
  updateStatus: (id, payload) => api.patch(`/incidents/${id}/status`, payload).then((res) => res.data),
  reopenIncident: (id, payload) => api.post(`/incidents/${id}/reopen`, payload).then((res) => res.data),
  reassign: (id, payload) => api.patch(`/incidents/${id}/reassign`, payload).then((res) => res.data),
  recordResolution: (id, payload) => api.post(`/incidents/${id}/resolution`, payload).then((res) => res.data),
  addNote: (id, payload) => api.post(`/incidents/${id}/notes`, payload).then((res) => res.data),
  linkRelated: (id, payload) => api.post(`/incidents/${id}/related`, payload).then((res) => res.data),
  unlinkRelated: (id, relatedId) => api.delete(`/incidents/${id}/related/${relatedId}`).then((res) => res.data),
  getRecommendations: (payload) => api.post('/incidents/recommendations', payload).then((res) => res.data),
  getIncidentRecommendations: (id) => api.get(`/incidents/${id}/recommendations`).then((res) => res.data),
  submitRecommendationFeedback: (id, payload) => api.post(`/incidents/${id}/recommendations/feedback`, payload).then((res) => res.data),
  getDuplicates: (id) => api.get(`/incidents/${id}/duplicates`).then((res) => res.data),
  getResolutionRecommendation: (id) => api.get(`/incidents/${id}/resolution-recommendations`).then((res) => res.data),
  submitResolutionFeedback: (id, payload) => api.post(`/incidents/${id}/resolution-recommendations/feedback`, payload).then((res) => res.data),
  searchKnowledgeBase: (params) => api.get('/incidents/knowledge-base/search', { params }).then((res) => res.data),
  flagResolution: (id, payload) => api.post(`/incidents/knowledge-base/${id}/flag`, payload).then((res) => res.data),
  unflagResolution: (id) => api.post(`/incidents/knowledge-base/${id}/unflag`).then((res) => res.data),
  getFeedbackAnalytics: () => api.get('/incidents/knowledge-base/feedback-analytics').then((res) => res.data),
  getCandidateResponders: (id) => api.get(`/incidents/${id}/candidate-responders`).then((res) => res.data),
  simulateWhatIf: (id, payload) => api.post(`/incidents/${id}/what-if`, payload).then((res) => res.data),
};

export const teamApi = {
  getTeams: () => api.get('/teams').then((res) => res.data),
};

export const analyticsApi = {
  getOverview: () => api.get('/analytics').then((res) => res.data),
  getWorkload: () => api.get('/analytics/workload').then((res) => res.data),
  getWorkloadDetails: () => api.get('/analytics/workload-details').then((res) => res.data),
  getDashboard: (params) => api.get('/analytics/dashboard', { params }).then((res) => res.data),
};

export const deploymentApi = {
  getDeployments: (params) => api.get('/deployments', { params }).then((res) => res.data),
  getDeploymentById: (id) => api.get(`/deployments/${id}`).then((res) => res.data),
  createDeployment: (payload) => api.post('/deployments', payload).then((res) => res.data),
  updateDeployment: (id, payload) => api.patch(`/deployments/${id}`, payload).then((res) => res.data),
  deleteDeployment: (id) => api.delete(`/deployments/${id}`).then((res) => res.data),
};

export const correlationApi = {
  getGraph: (params) => api.get('/correlations/graph', { params }).then((res) => res.data),
  getIncidentCorrelations: (id) => api.get(`/correlations/incident/${id}`).then((res) => res.data),
  submitDecision: (payload) => api.post('/correlations/decision', payload).then((res) => res.data),
};

export const systemApi = {
  getHealth: () => api.get('/health').then((res) => res.data),
};

export const integrationApi = {
  getIntegrations: () => api.get('/integrations').then((res) => res.data),
  createIntegration: (payload) => api.post('/integrations', payload).then((res) => res.data),
  revokeIntegration: (id) => api.post(`/integrations/${id}/revoke`).then((res) => res.data),
  toggleIntegration: (id, payload) => api.patch(`/integrations/${id}`, payload).then((res) => res.data),
  deleteIntegration: (id) => api.delete(`/integrations/${id}`).then((res) => res.data),
};

