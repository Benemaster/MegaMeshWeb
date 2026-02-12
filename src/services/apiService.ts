import axios, { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../config/api';
import { LoginCredentials, RegisterCredentials, User } from '../types/auth';
import { Message } from '../types/messaging';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  async login(credentials: LoginCredentials): Promise<{ user: User; token: string }> {
    const response = await this.api.post(API_ENDPOINTS.AUTH.LOGIN, credentials);
    return response.data;
  }

  async register(credentials: RegisterCredentials): Promise<{ user: User; token: string }> {
    const response = await this.api.post(API_ENDPOINTS.AUTH.REGISTER, credentials);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.api.post(API_ENDPOINTS.AUTH.LOGOUT);
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.api.get(API_ENDPOINTS.AUTH.ME);
    return response.data;
  }

  async getMessages(contactId: string): Promise<Message[]> {
    const response = await this.api.get(`${API_ENDPOINTS.MESSAGES.LIST}?contact=${contactId}`);
    return response.data;
  }

  async sendMessage(content: string, receiver: string): Promise<Message> {
    const response = await this.api.post(API_ENDPOINTS.MESSAGES.SEND, {
      content,
      receiver,
    });
    return response.data;
  }

  async syncMessages(messages: Message[]): Promise<void> {
    await this.api.post(API_ENDPOINTS.MESSAGES.SYNC, { messages });
  }

  async getNodes(): Promise<any[]> {
    const response = await this.api.get(API_ENDPOINTS.NODES.LIST);
    return response.data;
  }

  async registerNode(nodeId: string, name: string): Promise<any> {
    const response = await this.api.post(API_ENDPOINTS.NODES.REGISTER, {
      nodeId,
      name,
    });
    return response.data;
  }
}

export const apiService = new ApiService();
