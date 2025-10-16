import axios from 'axios';
import type { LoginResponse, CreateSessionResponse, Session, Question, QuestionCluster, ChatMessage } from '../types';

// Runtime config from window.ENV or build-time env
// @ts-ignore
const API_URL = (typeof window !== 'undefined' && window.ENV?.VITE_API_URL !== undefined)
  ? window.ENV.VITE_API_URL
  : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

console.log('API_URL:', API_URL);

const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Don't redirect if we're already on login page or this is a login request
      const isLoginRequest = error.config?.url?.includes('/auth/login');
      const isOnLoginPage = window.location.pathname.includes('/login');

      if (!isLoginRequest && !isOnLoginPage) {
        console.error('Authentication failed. Please login again.');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }),

  logout: () => api.post('/auth/logout'),
};

// Sessions API
export const sessionsAPI = {
  list: () => api.get<{ sessions: Session[] }>('/sessions'),

  create: (title: string, description: string, collection_timer_duration = 60) =>
    api.post<CreateSessionResponse>('/sessions', { title, description, collection_timer_duration }),

  get: (id: string) => api.get<{ session: Session }>(`/sessions/${id}`),

  start: (id: string) => api.post<{ session: Session }>(`/sessions/${id}/start`),

  end: (id: string) => api.post<{ session: Session }>(`/sessions/${id}/end`),

  delete: (id: string) => api.delete(`/sessions/${id}`),

  newQuestion: (id: string, description: string, collection_timer_duration?: number) =>
    api.post<{ session: Session }>(`/sessions/${id}/new-question`, { description, collection_timer_duration }),

  analyze: (id: string, iteration?: number) => api.post(`/sessions/${id}/analyze`, { iteration }),

  getQuestions: (id: string) => api.get<{ questions: Question[] }>(`/sessions/${id}/questions`),

  getClusters: (id: string) => api.get<{ clusters: QuestionCluster[] }>(`/sessions/${id}/clusters`),

  getIterationQuestions: (id: string) => api.get<{ iteration_questions: Array<{ iteration: number; question_text: string }> }>(`/sessions/${id}/iteration-questions`),
};

// Chat API
export const chatAPI = {
  send: (sessionId: string, message: string, iteration: number) =>
    api.post<{ role: 'assistant'; content: string }>(`/sessions/${sessionId}/chat`, { message, iteration }),

  getHistory: (sessionId: string) => api.get<{ messages: ChatMessage[] }>(`/sessions/${sessionId}/chat`),

  getDefaultPrompt: () => api.get<{ prompt: string }>(`/sessions/chat/default-prompt`),
};

export default api;
