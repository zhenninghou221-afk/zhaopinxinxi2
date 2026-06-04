import { success, error } from '../utils/response.js';
import { activatePaidSubscription } from '../services/subscription.js';
import { sendPaymentConfirmation } from '../services/email.js';

/**
 * GET /api/v1/admin/pending-payments
 * List all pending payments (waiting for admin verification)
 */
export async function getPendingPayments(request, env) {
  try {
    const payments = await env.DB.prepare(
      `SELECT p.*, u.email as user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE p.status = 'pending' AND p.payment_proof != ''
       ORDER BY p.created_at ASC`
    ).all();

    return success({
      payments: payments.results,
      total: payments.results.length,
    });
  } catch (err) {
    console.error('Get pending payments error:', err);
    return error('获取待审核列表失败', 500);
  }
}

/**
 * POST /api/v1/admin/verify-payment
 * Body: { orderId, action: 'approve' | 'reject' }
 */
export async function verifyPayment(request, env) {
  try {
    const body = await request.json();
    const { orderId, action } = body;

    if (!orderId || !action) {
      return error('请提供订单号和操作');
    }

    if (!['approve', 'reject'].includes(action)) {
      return error('操作只能是 approve 或 reject');
    }

    // Get payment
    const payment = await env.DB.prepare(
      `SELECT p.*, u.email as user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE p.order_id = ?`
    ).bind(orderId).first();

    if (!payment) {
      return error('订单不存在', 404);
    }

    if (payment.status !== 'pending') {
      return error(`订单状态为 ${payment.status}，无法操作`);
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      // Update payment status
      await env.DB.prepare(
        'UPDATE payments SET status = \'completed\', completed_at = ?, verified_at = ? WHERE order_id = ?'
      ).bind(now, now, orderId).run();

      // Activate subscription
      const subscriptionDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
      const sub = await activatePaidSubscription(env.DB, payment.user_id, subscriptionDays);

      // Send confirmation email
      await sendPaymentConfirmation(payment.user_email, orderId, env);

      return success({
        orderId,
        status: 'completed',
        subscription: sub,
      }, '付款已确认，订阅已开通');
    } else {
      // Reject
      await env.DB.prepare(
        'UPDATE payments SET status = \'cancelled\', completed_at = ? WHERE order_id = ?'
      ).bind(now, orderId).run();

      return success({
        orderId,
        status: 'cancelled',
      }, '已拒绝该付款');
    }
  } catch (err) {
    console.error('Verify payment error:', err);
    return error('操作失败', 500);
  }
}

/**
 * GET /api/v1/admin/stats
 * Admin dashboard stats
 */
export async function getStats(request, env) {
  try {
    const [totalUsers, totalPayments, totalRevenue, activeSubs] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM payments WHERE status = \'completed\'').first(),
      env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = \'completed\'').first(),
      env.DB.prepare(
        'SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1 AND expires_at > datetime(\'now\')'
      ).first(),
    ]);

    return success({
      totalUsers: totalUsers ? totalUsers.count : 0,
      totalCompletedPayments: totalPayments ? totalPayments.count : 0,
      totalRevenue: totalRevenue ? totalRevenue.total : 0,
      activeSubscriptions: activeSubs ? activeSubs.count : 0,
    });
  } catch (err) {
    console.error('Get admin stats error:', err);
    return error('获取统计数据失败', 500);
  }
}
