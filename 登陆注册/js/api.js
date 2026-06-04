/**
 * API Client for Recruitment Platform
 * Handles HTTP requests, JWT token management, and auth state
 */

// Base URL for the Worker API
// In production: set by Cloudflare Pages env or hardcode your Worker URL
const API_BASE = window.API_BASE_URL || '';

// JWT Token management
const TOKEN_KEY = 'recruitment_token';
const USER_KEY = 'recruitment_user';

export const api = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),

  setToken(token) {
    this.token = token;
    localStorage.setItem(TOKEN_KEY, token);
  },

  setUser(user) {
    this.user = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  isLoggedIn() {
    return !!this.token;
  },

  getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  },

  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const config = {
      headers: this.getAuthHeaders(),
      ...options,
    };

    // Don't override Content-Type for FormData
    if (options.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok && data.code === 'UNAUTHORIZED') {
        this.clearAuth();
        window.location.href = '/登陆注册/login.html';
        return null;
      }

      return data;
    } catch (err) {
      console.error('API request failed:', err);
      return { success: false, message: '网络错误，请检查网络连接', code: 'NETWORK_ERROR' };
    }
  },

  // Auth endpoints
  async register(email, password) {
    const result = await this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (result.success && result.data.token) {
      this.setToken(result.data.token);
      this.setUser(result.data.user);
    }
    return result;
  },

  async login(email, password) {
    const result = await this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (result.success && result.data.token) {
      this.setToken(result.data.token);
      this.setUser(result.data.user);
    }
    return result;
  },

  async verifyEmail(token) {
    const result = await this.request('/api/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    if (result.success && result.data.token) {
      this.setToken(result.data.token);
      if (result.data.subscription) {
        // User info not in this response, but we have token for subsequent calls
      }
    }
    return result;
  },

  logout() {
    this.clearAuth();
    window.location.href = '/';
  },

  // Company data
  async getCompanies(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/v1/companies/all${query ? '?' + query : ''}`);
  },

  async getCompaniesFull(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/v1/companies/all-full${query ? '?' + query : ''}`);
  },

  async getCompanyStats() {
    return this.request('/api/v1/companies/stats');
  },

  // Subscription
  async getSubscriptionStatus() {
    return this.request('/api/v1/subscription/status');
  },

  async getSubscriptionHistory() {
    return this.request('/api/v1/subscription/history');
  },

  // Payment
  async createOrder() {
    return this.request('/api/v1/payment/create-order', { method: 'POST' });
  },

  async uploadProof(orderId, file) {
    const formData = new FormData();
    formData.append('proof', file);
    formData.append('orderId', orderId);
    return this.request('/api/v1/payment/upload-proof', {
      method: 'POST',
      body: formData,
    });
  },

  async getPaymentOrders() {
    return this.request('/api/v1/payment/orders');
  },

  // Profile
  async getProfile() {
    return this.request('/api/v1/user/profile');
  },

  // Admin (only needs admin password, no login required)
  async adminGetPendingPayments(adminPassword) {
    return await fetch(`${API_BASE}/api/v1/admin/pending-payments`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword,
      },
    }).then(r => r.json()).catch(() => ({ success: false, message: '网络错误' }));
  },

  async adminVerifyPayment(orderId, action, adminPassword) {
    return await fetch(`${API_BASE}/api/v1/admin/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword,
      },
      body: JSON.stringify({ orderId, action }),
    }).then(r => r.json()).catch(() => ({ success: false, message: '网络错误' }));
  },

  async adminGetStats(adminPassword) {
    return await fetch(`${API_BASE}/api/v1/admin/stats`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword,
      },
    }).then(r => r.json()).catch(() => ({ success: false, message: '网络错误' }));
  },
};
