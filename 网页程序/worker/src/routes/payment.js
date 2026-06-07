import { generateOrderId } from '../utils/jwt.js';
import { success, error } from '../utils/response.js';
import { activatePaidSubscription } from '../services/subscription.js';
import { sendPaymentConfirmation, notifyAdminNewPayment } from '../services/email.js';
import { precreate, query, verifyNotify, isConfigured } from '../services/alipay.js';

/**
 * GET /api/v1/payment/config-status
 * Check if Alipay is configured (for frontend feature detection)
 */
export async function configStatus(request, env) {
  const ready = isConfigured(env);
  return success({ alipayReady: ready });
}

/**
 * POST /api/v1/payment/create-order
 * Create a payment order. If Alipay is configured, generates dynamic QR code.
 * Falls back to static QR code + manual upload if Alipay is not configured.
 */
export async function createOrder(request, env, userId) {
  try {
    const user = await env.DB.prepare(
      'SELECT email FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) {
      return error('用户不存在', 404);
    }

    const price = parseFloat(env.PRICE_CNY) || 9.90;
    const orderId = generateOrderId();

    // Insert payment record
    await env.DB.prepare(
      `INSERT INTO payments (user_id, order_id, amount, status)
       VALUES (?, ?, ?, 'pending')`
    ).bind(userId, orderId, price).run();

    // ── Try Alipay dynamic order ──
    if (isConfigured(env)) {
      try {
        const subDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
        const result = await precreate(env, {
          outTradeNo: orderId,
          totalAmount: price,
          subject: `招聘信息网订阅 - ${subDays}天`,
          timeoutExpress: '30m',
        });

        return success({
          orderId,
          amount: price,
          status: 'pending',
          payMethod: 'alipay',
          qrCode: result.qrCode,       // URL string → render as QR image on frontend
          qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(result.qrCode)}`,
          message: `请使用支付宝扫码支付 ¥${price.toFixed(2)}`,
          instructions: [
            `金额：¥${price.toFixed(2)}`,
            `订单号：${orderId}`,
            '扫码后自动开通，无需上传截图',
          ],
        });
      } catch (alipayErr) {
        console.error('Alipay precreate error, falling back to manual mode:', alipayErr.message);
        // Fall through to static QR mode
      }
    }

    // ── Fallback: static QR code + manual upload ──
    return success({
      orderId,
      amount: price,
      status: 'pending',
      payMethod: 'manual',
      qrAlipay: '/images/alipay_qr.png',
      message: `请支付 ¥${price.toFixed(2)} 并上传付款截图`,
      instructions: [
        `1. 使用支付宝扫描收款码`,
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
 * Upload payment screenshot (fallback when Alipay is not configured)
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

    const order = await env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ? AND user_id = ?'
    ).bind(orderId, userId).first();

    if (!order) {
      return error('订单不存在', 404);
    }

    if (order.status !== 'pending') {
      return error('订单状态不正确，当前状态：' + order.status);
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return error('请上传 JPG/PNG/WebP/GIF 格式的图片');
    }

    if (file.size > 5 * 1024 * 1024) {
      return error('图片大小不能超过5MB');
    }

    const fileName = `proof-${orderId}-${Date.now()}.${file.type.split('/')[1]}`;
    try {
      await env.PAYMENT_BUCKET.put(fileName, file.stream(), {
        httpMetadata: { contentType: file.type },
      });
    } catch (r2Err) {
      console.error('R2 upload error:', r2Err);
      return error('文件上传服务未配置，请联系管理员', 500, 'R2_NOT_CONFIGURED');
    }

    await env.DB.prepare(
      'UPDATE payments SET payment_proof = ? WHERE order_id = ?'
    ).bind(fileName, orderId).run();

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
 * POST /api/v1/payment/alipay-notify
 * Alipay async notification — called by Alipay servers when payment completes.
 *
 * NO auth required (Alipay calls this directly). Security: RSA2 signature verification.
 *
 * Requirements:
 *   - Must respond with the literal string 'success' within 30s
 *   - Must be idempotent (Alipay retries if no 'success' response)
 */
export async function alipayNotify(request, env) {
  try {
    const body = await request.text();

    // Parse form-urlencoded body
    const params = {};
    for (const pair of body.split('&')) {
      const [key, val] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }

    console.log('[Alipay Notify]', JSON.stringify(params, null, 2));

    // 1. Verify signature + trade status
    const verified = await verifyNotify(env, params);
    if (!verified.valid) {
      console.error('[Alipay Notify] Verification failed:', verified.reason);
      // Still return 'success' to prevent Alipay retrying invalid signatures forever
      return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    const { outTradeNo, tradeNo, totalAmount, buyerLogonId } = verified;

    // 2. Find the order
    const payment = await env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ? AND status = \'pending\''
    ).bind(outTradeNo).first();

    if (!payment) {
      console.error(`[Alipay Notify] Order not found or already processed: ${outTradeNo}`);
      return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // 3. Optional: verify amount matches
    const expectedAmount = payment.amount;
    if (parseFloat(totalAmount) !== expectedAmount) {
      console.error(`[Alipay Notify] Amount mismatch: expected ${expectedAmount}, got ${totalAmount}`);
      // Still accept but log it
    }

    // 4. Update payment record
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE payments
       SET status = 'completed',
           payment_method = 'alipay',
           completed_at = ?,
           verified_at = ?
       WHERE order_id = ?`
    ).bind(now, now, outTradeNo).run();

    // 5. Activate subscription
    const subscriptionDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
    const sub = await activatePaidSubscription(env.DB, payment.user_id, subscriptionDays);

    // 6. Get user email for notification
    const user = await env.DB.prepare(
      'SELECT email FROM users WHERE id = ?'
    ).bind(payment.user_id).first();

    // 7. Send confirmation email
    if (user) {
      await sendPaymentConfirmation(user.email, outTradeNo, env);
    }

    console.log(`[Alipay Notify] ✅ Payment completed: ${outTradeNo}, trade: ${tradeNo}, buyer: ${buyerLogonId}`);

    // 8. Respond with EXACT string 'success' — Alipay expects this
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    console.error('[Alipay Notify] Error:', err);
    // Return 'success' even on error to avoid infinite retries
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
}

/**
 * GET /api/v1/payment/query
 * Query the current status of a payment order.
 * Query params: ?orderId=PAY-xxx
 *
 * If Alipay is configured and order is still pending, queries Alipay for real-time status.
 */
export async function queryPaymentStatus(request, env, userId) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');

    if (!orderId) {
      return error('请提供订单号');
    }

    const order = await env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ? AND user_id = ?'
    ).bind(orderId, userId).first();

    if (!order) {
      return error('订单不存在', 404);
    }

    // If order is already completed in DB, return directly
    if (order.status === 'completed') {
      // Get subscription info
      const subStatus = await env.DB.prepare(
        `SELECT * FROM subscriptions
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`
      ).bind(userId).first();

      return success({
        orderId: order.order_id,
        status: 'completed',
        paid: true,
        subscription: subStatus ? {
          type: subStatus.type,
          expiresAt: subStatus.expires_at,
        } : null,
      });
    }

    // If still pending and Alipay is configured, query Alipay for real-time status
    if (order.status === 'pending' && isConfigured(env)) {
      try {
        const aliResult = await query(env, orderId);

        if (aliResult.tradeStatus === 'TRADE_SUCCESS') {
          // Payment confirmed via query — auto-complete
          const now = new Date().toISOString();
          await env.DB.prepare(
            `UPDATE payments
             SET status = 'completed',
                 payment_method = 'alipay',
                 completed_at = ?,
                 verified_at = ?
             WHERE order_id = ?`
          ).bind(now, now, orderId).run();

          const subscriptionDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
          const sub = await activatePaidSubscription(env.DB, userId, subscriptionDays);

          const user = await env.DB.prepare(
            'SELECT email FROM users WHERE id = ?'
          ).bind(userId).first();

          if (user) {
            await sendPaymentConfirmation(user.email, orderId, env);
          }

          return success({
            orderId,
            status: 'completed',
            paid: true,
            subscription: {
              type: sub.type,
              expiresAt: sub.expiresAt,
            },
          });
        }

        // Still waiting
        return success({
          orderId,
          status: 'pending',
          paid: false,
          tradeStatus: aliResult.tradeStatus,
        });
      } catch (queryErr) {
        console.error('Alipay query error during status check:', queryErr.message);
        // Fall through to returning DB status
      }
    }

    // Return current DB status
    return success({
      orderId: order.order_id,
      status: order.status,
      paid: false,
    });
  } catch (err) {
    console.error('Query payment status error:', err);
    return error('查询失败', 500);
  }
}

/**
 * POST /api/v1/payment/self-confirm
 * User self-confirms payment — auto-activates subscription immediately.
 *
 * This is the lightweight flow when no payment API is integrated.
 * Body: { orderId }
 *
 * Security notes:
 *   - Order must belong to the authenticated user
 *   - Order must be in 'pending' status (one-time use)
 *   - IP + timestamp logged for audit
 */
export async function selfConfirm(request, env, userId) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return error('请提供订单号');
    }

    // Verify order belongs to this user
    const order = await env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ? AND user_id = ?'
    ).bind(orderId, userId).first();

    if (!order) {
      return error('订单不存在', 404);
    }

    if (order.status !== 'pending') {
      return error(`订单状态为 ${order.status}，无法确认`);
    }

    // Record IP for audit
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const now = new Date().toISOString();

    // Update payment to completed
    await env.DB.prepare(
      `UPDATE payments
       SET status = 'completed',
           payment_method = 'manual_self_confirm',
           completed_at = ?,
           verified_at = ?
       WHERE order_id = ?`
    ).bind(now, now, orderId).run();

    // Activate subscription
    const subscriptionDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
    const sub = await activatePaidSubscription(env.DB, userId, subscriptionDays);

    console.log(`[SelfConfirm] Order ${orderId} confirmed by user ${userId} from IP ${ip}`);

    // Send confirmation email if configured
    const user = await env.DB.prepare(
      'SELECT email FROM users WHERE id = ?'
    ).bind(userId).first();
    if (user) {
      await sendPaymentConfirmation(user.email, orderId, env);
    }

    return success({
      orderId,
      status: 'completed',
      subscription: sub,
      message: '订阅已开通！',
    }, '支付确认成功，订阅已开通');
  } catch (err) {
    console.error('Self confirm error:', err);
    return error('确认失败，请稍后重试', 500);
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
