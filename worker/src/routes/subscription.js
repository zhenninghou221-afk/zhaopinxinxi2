import { success, error } from '../utils/response.js';
import { getSubscriptionStatus } from '../services/subscription.js';

/**
 * GET /api/v1/subscription/status
 * Get current user's subscription status
 */
export async function getStatus(request, env, userId) {
  try {
    const status = await getSubscriptionStatus(env.DB, userId);
    return success(status);
  } catch (err) {
    console.error('Get subscription status error:', err);
    return error('获取订阅状态失败', 500);
  }
}

/**
 * GET /api/v1/subscription/history
 * Get user's subscription history
 */
export async function getHistory(request, env, userId) {
  try {
    const subs = await env.DB.prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(userId).all();

    return success({
      subscriptions: subs.results,
      total: subs.results.length,
    });
  } catch (err) {
    console.error('Get subscription history error:', err);
    return error('获取历史记录失败', 500);
  }
}
