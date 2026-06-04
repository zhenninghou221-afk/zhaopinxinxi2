import { generateOrderId } from '../utils/jwt.js';
import { success, error } from '../utils/response.js';
import { activatePaidSubscription } from '../services/subscription.js';
import { sendPaymentConfirmation, notifyAdminNewPayment } from '../services/email.js';

/**
 * POST /api/v1/payment/create-order
 * Create a payment order, return order info + QR code URLs
 */
export async function createOrder(request, env, userId) {
  try {
    // Get user email
    const user = await env.DB.prepare(
      'SELECT email FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) {
      return error('用户不存在', 404);
    }

    // Check for existing pending order
    const pending = await env.DB.prepare(
      'SELECT * FROM payments WHERE user_id = ? AND status = \'pending\' ORDER BY created_at DESC LIMIT 1'
    ).bind(userId).first();

    if (pending) {
      // Return existing pending order
      const createdTime = new Date(pending.created_at);
      const now = new Date();
      const diffMinutes = Math.floor((now - createdTime) / 60000);

      if (diffMinutes < 30) {
        return success({
          orderId: pending.order_id,
          amount: pending.amount,
          status: 'pending',
          message: '你有一个待支付的订单，请在30分钟内完成支付',
          qrAlipay: '/images/alipay_qr.png',
          qrWechat: '/images/wechat_qr.png',
        });
      }

      // Expire old pending order
      await env.DB.prepare(
        'UPDATE payments SET status = \'expired\' WHERE id = ?'
      ).bind(pending.id).run();
    }

    const price = parseFloat(env.PRICE_CNY) || 9.90;
    const orderId = generateOrderId();

    await env.DB.prepare(
      `INSERT INTO payments (user_id, order_id, amount, status)
       VALUES (?, ?, ?, 'pending')`
    ).bind(userId, orderId, price).run();

    return success({
      orderId,
      amount: price,
      status: 'pending',
      message: `请支付 ¥${price.toFixed(2)} 并上传付款截图`,
      qrAlipay: '/images/alipay_qr.png',
      qrWechat: '/images/wechat_qr.png',
      instructions: [
        `1. 使用支付宝或微信扫描收款码`,
        `2. 支付金额：¥${price.toFixed(2)}`,
        `3. 在转账备注中填写订单号：${orderId}`,
        '4. 截图保存支付成功页面',
        '5. 点击"上传付款截图"按钮上传',
      ],
    });
  } catch (err) {
    console.error('Create order error:', err);
    return error('创建订单失败', 500);
  }
}

/**
 * POST /api/v1/payment/upload-proof
 * Upload payment screenshot
 * Body: FormData with 'proof' file field + 'orderId'
 */
export async function uploadProof(request, env, userId) {
  try {
    const formData = await request.formData();
    const file = formData.get('proof');
    const orderId = formData.get('orderId');

    if (!file || !orderId) {
      return error('请提供付款截图和订单号');
    }

    // Verify order belongs to user
    const order = await env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ? AND user_id = ?'
    ).bind(orderId, userId).first();

    if (!order) {
      return error('订单不存在', 404);
    }

    if (order.status !== 'pending') {
      return error('订单状态不正确，当前状态：' + order.status);
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return error('请上传 JPG/PNG/WebP/GIF 格式的图片');
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return error('图片大小不能超过5MB');
    }

    // Upload to R2
    const fileName = `proof-${orderId}-${Date.now()}.${file.type.split('/')[1]}`;
    try {
      await env.PAYMENT_BUCKET.put(fileName, file.stream(), {
        httpMetadata: { contentType: file.type },
      });
    } catch (r2Err) {
      console.error('R2 upload error:', r2Err);
      // If R2 is not configured, store filename only for now
      return error('文件上传服务未配置，请联系管理员', 500, 'R2_NOT_CONFIGURED');
    }

    // Update payment record
    await env.DB.prepare(
      'UPDATE payments SET payment_proof = ? WHERE order_id = ?'
    ).bind(fileName, orderId).run();

    // Notify admin
    const user = await env.DB.prepare(
      'SELECT email FROM users WHERE id = ?'
    ).bind(userId).first();

    await notifyAdminNewPayment(user.email, orderId, env);

    return success({
      orderId,
      status: 'pending_verify',
      message: '付款截图已上传，管理员审核中，通常1小时内完成',
    }, '上传成功，等待审核');
  } catch (err) {
    console.error('Upload proof error:', err);
    return error('上传失败，请稍后重试', 500);
  }
}

/**
 * GET /api/v1/payment/orders
 * Get user's payment orders
 */
export async function getOrders(request, env, userId) {
  try {
    const orders = await env.DB.prepare(
      `SELECT * FROM payments
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(userId).all();

    return success({
      orders: orders.results,
      total: orders.results.length,
    });
  } catch (err) {
    console.error('Get orders error:', err);
    return error('获取订单失败', 500);
  }
}
