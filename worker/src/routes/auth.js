import { hashPassword, verifyPassword } from '../utils/hash.js';
import { generateToken, generateRandomToken } from '../utils/jwt.js';
import { success, error, unauthorized } from '../utils/response.js';
import { sendVerificationEmail } from '../services/email.js';
import { createTrialSubscription, getSubscriptionStatus } from '../services/subscription.js';

/**
 * POST /api/v1/auth/register
 * Body: { email, password }
 */
export async function register(request, env) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return error('邮箱和密码不能为空');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return error('邮箱格式不正确');
    }

    if (password.length < 8) {
      return error('密码至少需要8个字符');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await env.DB.prepare(
      'SELECT id, email_verified FROM users WHERE email = ?'
    ).bind(normalizedEmail).first();

    if (existing) {
      if (existing.email_verified) {
        return error('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');
      }
      // User exists but not verified - resend verification
      const token = generateRandomToken(32);
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        'UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE email = ?'
      ).bind(token, expires, normalizedEmail).run();

      await sendVerificationEmail(normalizedEmail, token, env);

      return success({ email: normalizedEmail }, '验证邮件已重新发送，请检查邮箱');
    }

    // Create new user
    const passwordHash = await hashPassword(password);
    const verifyToken = generateRandomToken(32);
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO users (email, password_hash, email_verified, email_verify_token, email_verify_expires)
       VALUES (?, ?, 0, ?, ?)`
    ).bind(normalizedEmail, passwordHash, verifyToken, verifyExpires).run();

    // Send verification email
    await sendVerificationEmail(normalizedEmail, verifyToken, env);

    return success(
      { email: normalizedEmail },
      '注册成功！请检查邮箱完成验证（如未收到请查看垃圾邮件）'
    );
  } catch (err) {
    console.error('Register error:', err);
    return error('注册失败，请稍后重试', 500);
  }
}

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 */
export async function login(request, env) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return error('邮箱和密码不能为空');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = 1'
    ).bind(normalizedEmail).first();

    if (!user) {
      return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.email_verified) {
      // Check if verification token expired
      const now = new Date().toISOString();
      if (user.email_verify_expires < now) {
        // Generate new token
        const newToken = generateRandomToken(32);
        const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          'UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE id = ?'
        ).bind(newToken, newExpires, user.id).run();

        await sendVerificationEmail(normalizedEmail, newToken, env);
      }
      return error('请先验证邮箱后再登录（验证邮件已发送）', 403, 'EMAIL_NOT_VERIFIED');
    }

    // Update last login
    await env.DB.prepare(
      'UPDATE users SET last_login = datetime(\'now\') WHERE id = ?'
    ).bind(user.id).run();

    // Generate JWT
    const token = await generateToken(
      { userId: user.id, email: user.email },
      env.JWT_SECRET || 'dev-secret-change-me',
      '7d'
    );

    // Get subscription status
    const subStatus = await getSubscriptionStatus(env.DB, user.id);

    return success({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
      subscription: subStatus,
    }, '登录成功');
  } catch (err) {
    console.error('Login error:', err);
    return error('登录失败，请稍后重试', 500);
  }
}

/**
 * POST /api/v1/auth/verify-email
 * Body: { token }
 */
export async function verifyEmail(request, env) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return error('验证令牌不能为空');
    }

    const now = new Date().toISOString();
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE email_verify_token = ? AND email_verify_expires > ?'
    ).bind(token, now).first();

    if (!user) {
      return error('验证链接已过期或无效，请重新注册', 400, 'INVALID_TOKEN');
    }

    if (user.email_verified) {
      return success({ email: user.email }, '邮箱已验证，请登录');
    }

    // Verify the email
    await env.DB.prepare(
      'UPDATE users SET email_verified = 1, email_verify_token = \'\', email_verify_expires = \'\' WHERE id = ?'
    ).bind(user.id).run();

    // Check if user already has a trial (prevent double trial)
    const existingSub = await env.DB.prepare(
      'SELECT id FROM subscriptions WHERE user_id = ? AND type = \'trial\''
    ).bind(user.id).first();

    if (!existingSub) {
      // Create trial subscription
      const trialHours = parseInt(env.TRIAL_HOURS) || 24;
      await createTrialSubscription(env.DB, user.id, trialHours);
    }

    // Generate JWT for auto-login
    const jwtToken = await generateToken(
      { userId: user.id, email: user.email },
      env.JWT_SECRET || 'dev-secret-change-me',
      '7d'
    );

    const subStatus = await getSubscriptionStatus(env.DB, user.id);

    return success({
      token: jwtToken,
      subscription: subStatus,
    }, '邮箱验证成功！已自动开通1天免费试用');
  } catch (err) {
    console.error('Verify email error:', err);
    return error('验证失败，请稍后重试', 500);
  }
}

/**
 * GET /api/v1/user/profile
 * Requires auth
 */
export async function getProfile(request, env, userId) {
  try {
    const user = await env.DB.prepare(
      'SELECT id, email, display_name, email_verified, created_at, last_login FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) {
      return error('用户不存在', 404);
    }

    const subStatus = await getSubscriptionStatus(env.DB, userId);

    return success({
      user,
      subscription: subStatus,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return error('获取用户信息失败', 500);
  }
}
