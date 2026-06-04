import { verifyToken } from '../utils/jwt.js';
import { unauthorized } from '../utils/response.js';

/**
 * Middleware: Require JWT authentication
 * Extracts user info from Authorization header and adds to request context
 */
export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return { error: unauthorized() };
  }

  const payload = await verifyToken(token, env.JWT_SECRET || 'dev-secret-change-me');
  if (!payload) {
    return { error: unauthorized('登录已过期，请重新登录') };
  }

  return { user: payload };
}

/**
 * Middleware: Require admin access
 */
export async function requireAdmin(request, env) {
  // Admin only needs password, no login required
  const adminPass = request.headers.get('X-Admin-Password') || '';
  const expectedPass = env.ADMIN_PASSWORD || 'admin888';

  if (adminPass !== expectedPass) {
    return { error: unauthorized('管理员密码错误') };
  }

  return { user: { userId: 0, email: 'admin', isAdmin: true } };
}
