import { handleCors, json, error } from './utils/response.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';

import * as authRoutes from './routes/auth.js';
import * as companiesRoutes from './routes/companies.js';
import * as subscriptionRoutes from './routes/subscription.js';
import * as paymentRoutes from './routes/payment.js';
import * as adminRoutes from './routes/admin.js';

async function router(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  // ──── Public Routes ────
  if (method === 'GET' && path === '/api/v1/health') {
    return json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  if (method === 'POST' && path === '/api/v1/auth/register') {
    return authRoutes.register(request, env);
  }

  if (method === 'POST' && path === '/api/v1/auth/login') {
    return authRoutes.login(request, env);
  }

  if (method === 'POST' && path === '/api/v1/auth/verify-email') {
    return authRoutes.verifyEmail(request, env);
  }

  if (method === 'GET' && path === '/api/v1/companies') {
    return companiesRoutes.getCompaniesPublic(request, env);
  }

  if (method === 'GET' && path === '/api/v1/companies/all') {
    return companiesRoutes.getAllCompaniesPublic(request, env);
  }

  if (method === 'GET' && path === '/api/v1/companies/stats') {
    return companiesRoutes.getCompanyStats(request, env);
  }

  // ──── Admin Routes (password only, no login required) ────
  if (method === 'GET' && path === '/api/v1/admin/pending-payments') {
    const adminCheck = requireAdmin(request, env);
    if (adminCheck.error) return adminCheck.error;
    return adminRoutes.getPendingPayments(request, env);
  }

  if (method === 'POST' && path === '/api/v1/admin/verify-payment') {
    const adminCheck = requireAdmin(request, env);
    if (adminCheck.error) return adminCheck.error;
    return adminRoutes.verifyPayment(request, env);
  }

  if (method === 'GET' && path === '/api/v1/admin/stats') {
    const adminCheck = requireAdmin(request, env);
    if (adminCheck.error) return adminCheck.error;
    return adminRoutes.getStats(request, env);
  }

  // ──── Auth Required Routes ────
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;
  const userId = auth.user.userId;

  if (method === 'GET' && path === '/api/v1/user/profile') {
    return authRoutes.getProfile(request, env, userId);
  }

  if (method === 'GET' && path === '/api/v1/companies/full') {
    return companiesRoutes.getCompaniesFull(request, env, userId);
  }

  if (method === 'GET' && path === '/api/v1/companies/all-full') {
    return companiesRoutes.getAllCompaniesFull(request, env, userId);
  }

  if (method === 'GET' && path === '/api/v1/subscription/status') {
    return subscriptionRoutes.getStatus(request, env, userId);
  }

  if (method === 'GET' && path === '/api/v1/subscription/history') {
    return subscriptionRoutes.getHistory(request, env, userId);
  }

  if (method === 'POST' && path === '/api/v1/payment/create-order') {
    return paymentRoutes.createOrder(request, env, userId);
  }

  if (method === 'POST' && path === '/api/v1/payment/upload-proof') {
    return paymentRoutes.uploadProof(request, env, userId);
  }

  if (method === 'GET' && path === '/api/v1/payment/orders') {
    return paymentRoutes.getOrders(request, env, userId);
  }

  return error('接口不存在', 404, 'NOT_FOUND');
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await router(request, env, ctx);
    } catch (err) {
      console.error('Unhandled error:', err.message, err.stack);
      return error('服务器内部错误: ' + err.message, 500, 'INTERNAL_ERROR');
    }
  },
};
