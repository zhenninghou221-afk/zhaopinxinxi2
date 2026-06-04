/**
 * Email service using Resend API
 * Free tier: 100 emails/day
 */
export async function sendVerificationEmail(to, token, env) {
  const verifyUrl = `${env.BASE_URL || 'http://localhost:8787'}/verify-email.html?token=${token}`;

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
      <h2 style="color:#2563eb;">📧 验证你的邮箱</h2>
      <p>感谢注册招聘信息网！请点击下方按钮验证你的邮箱地址：</p>
      <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0;">验证邮箱</a>
      <p style="color:#64748b;">或复制以下链接到浏览器：</p>
      <p style="color:#64748b;word-break:break-all;">${verifyUrl}</p>
      <p style="color:#94a3b8;font-size:12px;">此链接24小时内有效。注册后你将获得<strong>1天免费试用</strong>。</p>
    </div>
  `;

  // Try Resend API if key is available
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'resend.dev'}>`,
          to: [to],
          subject: '验证你的邮箱 - 招聘信息网',
          html: html,
        }),
      });

      if (response.ok) {
        return { success: true, method: 'resend' };
      }

      const errBody = await response.text();
      console.error('Resend API error:', errBody);
    } catch (e) {
      console.error('Resend send error:', e);
    }
  }

  // Fallback: if no Resend API key, log the verification URL
  console.log('='.repeat(60));
  console.log(`[EMAIL] Verification email for: ${to}`);
  console.log(`[EMAIL] Verify URL: ${verifyUrl}`);
  console.log('='.repeat(60));

  return { success: true, method: 'console', verifyUrl };
}

/**
 * Send payment confirmation email to user
 */
export async function sendPaymentConfirmation(to, orderId, env) {
  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
      <h2 style="color:#16a34a;">✅ 支付确认</h2>
      <p>你的付款已确认！订单号：<strong>${orderId}</strong></p>
      <p>订阅有效期已延长90天，现在可以查看全部招聘信息了。</p>
      <a href="${env.BASE_URL || ''}/dashboard.html" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">查看完整信息</a>
    </div>
  `;

  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'resend.dev'}>`,
          to: [to],
          subject: '付款确认 - 招聘信息网',
          html: html,
        }),
      });
    } catch (e) {
      console.error('Payment confirmation email error:', e);
    }
  }

  return { success: true };
}

/**
 * Notify admin about a new payment proof upload
 */
export async function notifyAdminNewPayment(userEmail, orderId, env) {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return { success: false, reason: 'no admin email' };

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
      <h2>📢 新支付待审核</h2>
      <p>用户 <strong>${userEmail}</strong> 上传了付款截图</p>
      <p>订单号：<strong>${orderId}</strong></p>
      <a href="${env.BASE_URL || ''}/admin.html" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;">去审核</a>
    </div>
  `;

  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'resend.dev'}>`,
          to: [adminEmail],
          subject: `新支付待审核 - ${userEmail}`,
          html: html,
        }),
      });
    } catch (e) {
      console.error('Admin notification error:', e);
    }
  }

  return { success: true };
}
