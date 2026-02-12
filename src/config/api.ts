const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: `${API_BASE_URL}/auth/login`,
    REGISTER: `${API_BASE_URL}/auth/register`,
    LOGOUT: `${API_BASE_URL}/auth/logout`,
    ME: `${API_BASE_URL}/auth/me`,
  },
  MESSAGES: {
    LIST: `${API_BASE_URL}/messages`,
    SEND: `${API_BASE_URL}/messages/send`,
    SYNC: `${API_BASE_URL}/messages/sync`,
  },
  NODES: {
    LIST: `${API_BASE_URL}/nodes`,
    REGISTER: `${API_BASE_URL}/nodes/register`,
  },
};
