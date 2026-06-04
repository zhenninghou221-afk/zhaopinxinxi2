// ====== _worker.js - Cloudflare Pages Worker ======
// Combines all API routes into one file for zhenningyu.top/api/*

const encoder = new TextEncoder();

// ====== utils/response.js ======
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
    },
  });
}

function success(data, message = 'ok') {
  return json({ success: true, message, data }, 200);
}

function error(message, status = 400, code = 'ERROR') {
  return json({ success: false, message, code }, status);
}

function unauthorized(message = '请先登录') {
  return error(message, 401, 'UNAUTHORIZED');
}

function handleCors(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return null;
}

// ====== utils/hash.js ======
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const saltHex = Array.from(new Uint8Array(salt)).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const storedHashBytes = new Uint8Array(hashHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hashBytes = new Uint8Array(hash);
  if (hashBytes.length !== storedHashBytes.length) return false;
  return hashBytes.every((b, i) => b === storedHashBytes[i]);
}

// ====== utils/jwt.js (Web Crypto, no jose dependency) ======
function base64urlEncode(buf) {
  let str = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateToken(payload, secret, expiresIn = '7d') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  let exp;
  if (expiresIn.endsWith('d')) exp = now + parseInt(expiresIn) * 86400;
  else if (expiresIn.endsWith('h')) exp = now + parseInt(expiresIn) * 3600;
  else exp = now + parseInt(expiresIn);

  const claims = { ...payload, iat: now, exp };

  const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  const claimsB64 = base64urlEncode(encoder.encode(JSON.stringify(claims)));
  const toSign = `${headerB64}.${claimsB64}`;

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(toSign));
  const sigB64 = base64urlEncode(sig);

  return `${toSign}.${sigB64}`;
}

async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, claimsB64, sigB64] = parts;
    const toVerify = `${headerB64}.${claimsB64}`;

    const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(claimsB64)));

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;

    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = base64urlDecode(sigB64);
    const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(toVerify));
    return valid ? claims : null;
  } catch (e) {
    return null;
  }
}

function generateRandomToken(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function generateOrderId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PAY-${dateStr}-${random}`;
}

// ====== middleware/auth.js ======
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { error: unauthorized() };
  const payload = await verifyToken(token, env.JWT_SECRET || 'dev-secret-change-me');
  if (!payload) return { error: unauthorized('登录已过期，请重新登录') };
  return { user: payload };
}

function requireAdmin(request, env) {
  const adminPass = request.headers.get('X-Admin-Password') || '';
  const expectedPass = env.ADMIN_PASSWORD || 'admin888';
  if (adminPass !== expectedPass) return { error: unauthorized('管理员密码错误') };
  return { user: { userId: 0, email: 'admin', isAdmin: true } };
}

// ====== services/subscription.js ======
async function createTrialSubscription(db, userId, trialHours = 24) {
  const now = new Date();
  const expires = new Date(now.getTime() + trialHours * 60 * 60 * 1000);
  await db.prepare('INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (?, \'trial\', ?, ?, 1)').bind(userId, now.toISOString(), expires.toISOString()).run();
  return { startsAt: now.toISOString(), expiresAt: expires.toISOString(), type: 'trial' };
}

async function getActiveSubscription(db, userId) {
  return await db.prepare('SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > datetime(\'now\') ORDER BY expires_at DESC LIMIT 1').bind(userId).first() || null;
}

async function getLatestExpiry(db, userId) {
  const result = await db.prepare('SELECT expires_at FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1').bind(userId).first();
  return result ? result.expires_at : null;
}

async function activatePaidSubscription(db, userId, subscriptionDays = 90) {
  await db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').bind(userId).run();
  const latestExpiry = await getLatestExpiry(db, userId);
  const now = new Date();
  let startsAt = (latestExpiry && new Date(latestExpiry) > now) ? new Date(latestExpiry) : now;
  const expiresAt = new Date(startsAt.getTime() + subscriptionDays * 24 * 60 * 60 * 1000);
  await db.prepare('INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (?, \'paid\', ?, ?, 1)').bind(userId, startsAt.toISOString(), expiresAt.toISOString()).run();
  return { startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString(), type: 'paid' };
}

function formatRemaining(expiresAt) {
  const diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return '已过期';
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${hours} 小时`;
}

async function getSubscriptionStatus(db, userId) {
  const active = await getActiveSubscription(db, userId);
  if (!active) {
    const anySub = await db.prepare('SELECT type FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1').bind(userId).first();
    if (!anySub) return { hasAccess: false, status: 'none', message: '暂无订阅' };
    const trialUsed = await db.prepare('SELECT id FROM subscriptions WHERE user_id = ? AND type = \'trial\'').bind(userId).first();
    if (trialUsed) return { hasAccess: false, status: 'trial_expired', message: '免费试用已过期，请订阅以继续使用' };
    return { hasAccess: false, status: 'expired', message: '订阅已过期，请续费' };
  }
  return { hasAccess: true, status: active.type === 'trial' ? 'trial' : 'active', type: active.type, expiresAt: active.expires_at, remaining: formatRemaining(active.expires_at), remainingDays: Math.max(0, Math.floor((new Date(active.expires_at) - new Date()) / 86400000)), message: active.type === 'trial' ? `试用中 · ${formatRemaining(active.expires_at)}` : `订阅有效 · ${formatRemaining(active.expires_at)}` };
}

// ====== services/email.js ======
async function sendVerificationEmail(to, token, env) {
  const verifyUrl = `${env.BASE_URL || 'https://zhenningyu.top/登陆注册'}/verify-email?token=${token}`;
  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#2563eb;">📧 验证你的邮箱</h2><p>感谢注册招聘信息网！请点击下方按钮验证你的邮箱地址：</p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0;">验证邮箱</a><p style="color:#64748b;">或复制以下链接到浏览器：</p><p style="color:#64748b;word-break:break-all;">${verifyUrl}</p><p style="color:#94a3b8;font-size:12px;">此链接24小时内有效。注册后你将获得<strong>1天免费试用</strong>。</p></div>`;
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'zhenningyu.top'}>`, to: [to], subject: '验证你的邮箱 - 招聘信息网', html }) });
      if (response.ok) return { success: true, method: 'resend' };
    } catch (e) { console.error('Resend error:', e); }
  }
  console.log(`[EMAIL] Verify URL for ${to}: ${verifyUrl}`);
  return { success: true, method: 'console', verifyUrl };
}

async function sendPaymentConfirmation(to, orderId, env) {
  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#16a34a;">✅ 支付确认</h2><p>你的付款已确认！订单号：<strong>${orderId}</strong></p><p>订阅有效期已延长90天，现在可以查看全部招聘信息了。</p><a href="${env.BASE_URL || ''}/dashboard.html" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">查看完整信息</a></div>`;
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'zhenningyu.top'}>`, to: [to], subject: '付款确认 - 招聘信息网', html }) }); } catch (e) {}
  }
  return { success: true };
}

async function notifyAdminNewPayment(userEmail, orderId, env) {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return { success: false, reason: 'no admin email' };
  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2>📢 新支付待审核</h2><p>用户 <strong>${userEmail}</strong> 上传了付款截图</p><p>订单号：<strong>${orderId}</strong></p><a href="${env.BASE_URL || ''}/admin.html" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;">去审核</a></div>`;
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `招聘信息网 <noreply@${env.RESEND_DOMAIN || 'zhenningyu.top'}>`, to: [adminEmail], subject: `新支付待审核 - ${userEmail}`, html }) }); } catch (e) {}
  }
  return { success: true };
}

// ====== ROUTES ======

// auth routes
async function register(request, env) {
  try {
    const body = await request.json();
    const { email, password } = body;
    if (!email || !password) return error('邮箱和密码不能为空');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('邮箱格式不正确');
    if (password.length < 8) return error('密码至少需要8个字符');
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ?').bind(normalizedEmail).first();
    if (existing) {
      if (existing.email_verified) return error('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');
      const token = generateRandomToken(32);
      const expires = new Date(Date.now() + 86400000).toISOString();
      await env.DB.prepare('UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE email = ?').bind(token, expires, normalizedEmail).run();
      await sendVerificationEmail(normalizedEmail, token, env);
      return success({ email: normalizedEmail }, '验证邮件已重新发送，请检查邮箱');
    }

    const passwordHash = await hashPassword(password);
    const verifyToken = generateRandomToken(32);
    const verifyExpires = new Date(Date.now() + 86400000).toISOString();
    await env.DB.prepare('INSERT INTO users (email, password_hash, email_verified, email_verify_token, email_verify_expires) VALUES (?, ?, 0, ?, ?)').bind(normalizedEmail, passwordHash, verifyToken, verifyExpires).run();
    await sendVerificationEmail(normalizedEmail, verifyToken, env);
    return success({ email: normalizedEmail }, '注册成功！请检查邮箱完成验证（如未收到请查看垃圾邮件）');
  } catch (err) { console.error('Register error:', err); return error('注册失败，请稍后重试', 500); }
}

async function login(request, env) {
  try {
    const body = await request.json();
    const { email, password } = body;
    if (!email || !password) return error('邮箱和密码不能为空');
    const normalizedEmail = email.toLowerCase().trim();
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').bind(normalizedEmail).first();
    if (!user) return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');

    if (!user.email_verified) {
      const now = new Date().toISOString();
      if (user.email_verify_expires < now) {
        const newToken = generateRandomToken(32);
        const newExpires = new Date(Date.now() + 86400000).toISOString();
        await env.DB.prepare('UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE id = ?').bind(newToken, newExpires, user.id).run();
        await sendVerificationEmail(normalizedEmail, newToken, env);
      }
      return error('请先验证邮箱后再登录（验证邮件已发送）', 403, 'EMAIL_NOT_VERIFIED');
    }

    await env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(user.id).run();
    const token = await generateToken({ userId: user.id, email: user.email }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    const subStatus = await getSubscriptionStatus(env.DB, user.id);
    return success({ token, user: { id: user.id, email: user.email, displayName: user.display_name }, subscription: subStatus }, '登录成功');
  } catch (err) { console.error('Login error:', err); return error('登录失败，请稍后重试', 500); }
}

async function verifyEmail(request, env) {
  try {
    const body = await request.json();
    const { token } = body;
    if (!token) return error('验证令牌不能为空');
    const now = new Date().toISOString();
    const user = await env.DB.prepare('SELECT * FROM users WHERE email_verify_token = ? AND email_verify_expires > ?').bind(token, now).first();
    if (!user) return error('验证链接已过期或无效，请重新注册', 400, 'INVALID_TOKEN');
    if (user.email_verified) return success({ email: user.email }, '邮箱已验证，请登录');

    await env.DB.prepare('UPDATE users SET email_verified = 1, email_verify_token = \'\', email_verify_expires = \'\' WHERE id = ?').bind(user.id).run();

    const existingSub = await env.DB.prepare('SELECT id FROM subscriptions WHERE user_id = ? AND type = \'trial\'').bind(user.id).first();
    if (!existingSub) {
      const trialHours = parseInt(env.TRIAL_HOURS) || 24;
      await createTrialSubscription(env.DB, user.id, trialHours);
    }

    const jwtToken = await generateToken({ userId: user.id, email: user.email }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    const subStatus = await getSubscriptionStatus(env.DB, user.id);
    return success({ token: jwtToken, subscription: subStatus }, '邮箱验证成功！已自动开通1天免费试用');
  } catch (err) { console.error('Verify email error:', err); return error('验证失败，请稍后重试', 500); }
}

async function getProfile(request, env, userId) {
  try {
    const user = await env.DB.prepare('SELECT id, email, display_name, email_verified, created_at, last_login FROM users WHERE id = ?').bind(userId).first();
    if (!user) return error('用户不存在', 404);
    const subStatus = await getSubscriptionStatus(env.DB, userId);
    return success({ user, subscription: subStatus });
  } catch (err) { console.error('Get profile error:', err); return error('获取用户信息失败', 500); }
}

// companies routes
async function getCompaniesPublic(request, env) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM companies';
    let countQuery = 'SELECT COUNT(*) as total FROM companies';
    const params = [], countParams = [];
    if (search) {
      const where = ' WHERE (company_name LIKE ? OR locations LIKE ?)';
      query += where; countQuery += where;
      const term = `%${search}%`;
      params.push(term, term); countParams.push(term, term);
    }
    query += ' ORDER BY row_num ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows, countResult] = await Promise.all([env.DB.prepare(query).bind(...params).all(), env.DB.prepare(countQuery).bind(...countParams).first()]);
    const maskedRows = rows.results.map(row => ({ id: row.id, row_num: row.row_num, company_name: row.company_name, locations: row.locations, tags_json: row.tags_json, target_audience: '', job_positions: '', description: '', apply_url: '', apply_text: '', website_url: row.website_url, website_text: row.website_text }));
    return success({ companies: maskedRows, pagination: { page, limit, total: countResult ? countResult.total : 0, totalPages: Math.ceil((countResult ? countResult.total : 0) / limit) } });
  } catch (err) { console.error('Get companies error:', err); return error('获取招聘信息失败', 500); }
}

async function getCompaniesFull(request, env, userId) {
  try {
    const sub = await getActiveSubscription(env.DB, userId);
    if (!sub) return error('请先订阅以查看完整内容', 403, 'SUBSCRIPTION_REQUIRED');
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM companies', countQuery = 'SELECT COUNT(*) as total FROM companies';
    const params = [], countParams = [];
    if (search) {
      const where = ' WHERE (company_name LIKE ? OR locations LIKE ? OR target_audience LIKE ? OR job_positions LIKE ? OR description LIKE ? OR tags_json LIKE ?)';
      query += where; countQuery += where;
      const term = `%${search}%`;
      for (let i = 0; i < 6; i++) { params.push(term); countParams.push(term); }
    }
    query += ' ORDER BY row_num ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows, countResult] = await Promise.all([env.DB.prepare(query).bind(...params).all(), env.DB.prepare(countQuery).bind(...countParams).first()]);
    return success({ companies: rows.results, pagination: { page, limit, total: countResult ? countResult.total : 0, totalPages: Math.ceil((countResult ? countResult.total : 0) / limit) } });
  } catch (err) { console.error('Get companies full error:', err); return error('获取完整信息失败', 500); }
}

async function getAllCompaniesPublic(request, env) {
  try {
    const rows = await env.DB.prepare('SELECT id, row_num, company_name, locations, tags_json, website_url, website_text FROM companies ORDER BY row_num ASC').all();
    return success({ companies: rows.results, total: rows.results.length });
  } catch (err) { console.error('Get all companies error:', err); return error('获取数据失败', 500); }
}

async function getAllCompaniesFull(request, env, userId) {
  try {
    const sub = await getActiveSubscription(env.DB, userId);
    if (!sub) return error('请先订阅以查看完整内容', 403, 'SUBSCRIPTION_REQUIRED');
    const rows = await env.DB.prepare('SELECT * FROM companies ORDER BY row_num ASC').all();
    return success({ companies: rows.results, total: rows.results.length });
  } catch (err) { console.error('Get all companies full error:', err); return error('获取数据失败', 500); }
}

async function getCompanyStats(request, env) {
  try {
    const [total, locations] = await Promise.all([env.DB.prepare('SELECT COUNT(*) as count FROM companies').first(), env.DB.prepare('SELECT locations FROM companies').all()]);
    const citySet = new Set();
    for (const row of locations.results) {
      if (row.locations) row.locations.split('/').forEach(city => { const c = city.trim(); if (c) citySet.add(c); });
    }
    return success({ totalCompanies: total ? total.count : 0, uniqueCities: citySet.size, cities: Array.from(citySet).sort() });
  } catch (err) { console.error('Get stats error:', err); return error('获取统计失败', 500); }
}

// subscription routes
async function getSubStatus(request, env, userId) {
  try { return success(await getSubscriptionStatus(env.DB, userId)); } catch (err) { return error('获取订阅状态失败', 500); }
}

async function getSubHistory(request, env, userId) {
  try {
    const subs = await env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(userId).all();
    return success({ subscriptions: subs.results, total: subs.results.length });
  } catch (err) { return error('获取历史记录失败', 500); }
}

// payment routes
async function createOrder(request, env, userId) {
  try {
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    if (!user) return error('用户不存在', 404);
    const pending = await env.DB.prepare('SELECT * FROM payments WHERE user_id = ? AND status = \'pending\' ORDER BY created_at DESC LIMIT 1').bind(userId).first();
    if (pending) {
      const diffMinutes = Math.floor((new Date() - new Date(pending.created_at)) / 60000);
      if (diffMinutes < 30) return success({ orderId: pending.order_id, amount: pending.amount, status: 'pending', message: '你有一个待支付的订单，请在30分钟内完成支付', qrAlipay: '/登陆注册/images/alipay_qr.png', qrWechat: '/登陆注册/images/wechat_qr.png' });
      await env.DB.prepare('UPDATE payments SET status = \'expired\' WHERE id = ?').bind(pending.id).run();
    }
    const price = parseFloat(env.PRICE_CNY) || 9.90;
    const orderId = generateOrderId();
    await env.DB.prepare('INSERT INTO payments (user_id, order_id, amount, status) VALUES (?, ?, ?, \'pending\')').bind(userId, orderId, price).run();
    return success({ orderId, amount: price, status: 'pending', message: `请支付 ¥${price.toFixed(2)} 并上传付款截图`, qrAlipay: '/登陆注册/images/alipay_qr.png', qrWechat: '/登陆注册/images/wechat_qr.png', instructions: [`1. 使用支付宝或微信扫描收款码`, `2. 支付金额：¥${price.toFixed(2)}`, `3. 在转账备注中填写订单号：${orderId}`, '4. 截图保存支付成功页面', '5. 点击"上传付款截图"按钮上传'] });
  } catch (err) { console.error('Create order error:', err); return error('创建订单失败', 500); }
}

async function uploadProof(request, env, userId) {
  try {
    const formData = await request.formData();
    const file = formData.get('proof');
    const orderId = formData.get('orderId');
    if (!file || !orderId) return error('请提供付款截图和订单号');
    const order = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').bind(orderId, userId).first();
    if (!order) return error('订单不存在', 404);
    if (order.status !== 'pending') return error('订单状态不正确，当前状态：' + order.status);
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) return error('请上传 JPG/PNG/WebP/GIF 格式的图片');
    if (file.size > 5242880) return error('图片大小不能超过5MB');
    const fileName = `proof-${orderId}-${Date.now()}.${file.type.split('/')[1]}`;
    try {
      await env.PAYMENT_BUCKET.put(fileName, file.stream(), { httpMetadata: { contentType: file.type } });
    } catch (r2Err) {
      return error('文件上传服务未配置，请联系管理员', 500, 'R2_NOT_CONFIGURED');
    }
    await env.DB.prepare('UPDATE payments SET payment_proof = ? WHERE order_id = ?').bind(fileName, orderId).run();
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    await notifyAdminNewPayment(user.email, orderId, env);
    return success({ orderId, status: 'pending_verify', message: '付款截图已上传，管理员审核中，通常1小时内完成' }, '上传成功，等待审核');
  } catch (err) { console.error('Upload proof error:', err); return error('上传失败，请稍后重试', 500); }
}

async function getOrders(request, env, userId) {
  try {
    const orders = await env.DB.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(userId).all();
    return success({ orders: orders.results, total: orders.results.length });
  } catch (err) { return error('获取订单失败', 500); }
}

// admin routes
async function getPendingPayments(request, env) {
  try {
    const payments = await env.DB.prepare('SELECT p.*, u.email as user_email FROM payments p JOIN users u ON p.user_id = u.id WHERE p.status = \'pending\' AND p.payment_proof != \'\' ORDER BY p.created_at ASC').all();
    return success({ payments: payments.results, total: payments.results.length });
  } catch (err) { return error('获取待审核列表失败', 500); }
}

async function verifyPayment(request, env) {
  try {
    const body = await request.json();
    const { orderId, action } = body;
    if (!orderId || !action) return error('请提供订单号和操作');
    if (!['approve', 'reject'].includes(action)) return error('操作只能是 approve 或 reject');
    const payment = await env.DB.prepare('SELECT p.*, u.email as user_email FROM payments p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?').bind(orderId).first();
    if (!payment) return error('订单不存在', 404);
    if (payment.status !== 'pending') return error(`订单状态为 ${payment.status}，无法操作`);
    const now = new Date().toISOString();
    if (action === 'approve') {
      await env.DB.prepare('UPDATE payments SET status = \'completed\', completed_at = ?, verified_at = ? WHERE order_id = ?').bind(now, now, orderId).run();
      const subscriptionDays = parseInt(env.SUBSCRIPTION_DAYS) || 90;
      const sub = await activatePaidSubscription(env.DB, payment.user_id, subscriptionDays);
      await sendPaymentConfirmation(payment.user_email, orderId, env);
      return success({ orderId, status: 'completed', subscription: sub }, '付款已确认，订阅已开通');
    } else {
      await env.DB.prepare('UPDATE payments SET status = \'cancelled\', completed_at = ? WHERE order_id = ?').bind(now, orderId).run();
      return success({ orderId, status: 'cancelled' }, '已拒绝该付款');
    }
  } catch (err) { return error('操作失败', 500); }
}

async function getAdminStats(request, env) {
  try {
    const [totalUsers, totalPayments, totalRevenue, activeSubs] = await Promise.all([env.DB.prepare('SELECT COUNT(*) as count FROM users').first(), env.DB.prepare('SELECT COUNT(*) as count FROM payments WHERE status = \'completed\'').first(), env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = \'completed\'').first(), env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1 AND expires_at > datetime(\'now\')').first()]);
    return success({ totalUsers: totalUsers ? totalUsers.count : 0, totalCompletedPayments: totalPayments ? totalPayments.count : 0, totalRevenue: totalRevenue ? totalRevenue.total : 0, activeSubscriptions: activeSubs ? activeSubs.count : 0 });
  } catch (err) { return error('获取统计数据失败', 500); }
}

// ====== MAIN ROUTER ======
async function router(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  // Only handle /api/* paths
  if (!path.startsWith('/api/')) return null; // let Pages handle static files

  // Public routes
  if (method === 'GET' && path === '/api/v1/health') {
    return json({ status: 'ok', timestamp: new Date().toISOString() });
  }
  if (method === 'POST' && path === '/api/v1/auth/register') return register(request, env);
  if (method === 'POST' && path === '/api/v1/auth/login') return login(request, env);
  if (method === 'POST' && path === '/api/v1/auth/verify-email') return verifyEmail(request, env);
  if (method === 'GET' && path === '/api/v1/companies') return getCompaniesPublic(request, env);
  if (method === 'GET' && path === '/api/v1/companies/all') return getAllCompaniesPublic(request, env);
  if (method === 'GET' && path === '/api/v1/companies/stats') return getCompanyStats(request, env);

  // Admin routes
  if (method === 'GET' && path === '/api/v1/admin/pending-payments') {
    const ac = requireAdmin(request, env);
    if (ac.error) return ac.error;
    return getPendingPayments(request, env);
  }
  if (method === 'POST' && path === '/api/v1/admin/verify-payment') {
    const ac = requireAdmin(request, env);
    if (ac.error) return ac.error;
    return verifyPayment(request, env);
  }
  if (method === 'GET' && path === '/api/v1/admin/stats') {
    const ac = requireAdmin(request, env);
    if (ac.error) return ac.error;
    return getAdminStats(request, env);
  }

  // Auth required routes
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;
  const userId = auth.user.userId;

  if (method === 'GET' && path === '/api/v1/user/profile') return getProfile(request, env, userId);
  if (method === 'GET' && path === '/api/v1/companies/full') return getCompaniesFull(request, env, userId);
  if (method === 'GET' && path === '/api/v1/companies/all-full') return getAllCompaniesFull(request, env, userId);
  if (method === 'GET' && path === '/api/v1/subscription/status') return getSubStatus(request, env, userId);
  if (method === 'GET' && path === '/api/v1/subscription/history') return getSubHistory(request, env, userId);
  if (method === 'POST' && path === '/api/v1/payment/create-order') return createOrder(request, env, userId);
  if (method === 'POST' && path === '/api/v1/payment/upload-proof') return uploadProof(request, env, userId);
  if (method === 'GET' && path === '/api/v1/payment/orders') return getOrders(request, env, userId);

  return error('接口不存在', 404, 'NOT_FOUND');
}

// ====== EXPORT ======
export default {
  async fetch(request, env, ctx) {
    try {
      const response = await router(request, env, ctx);
      if (response) return response;
      // Not an API route, let Pages handle it
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Unhandled error:', err.message, err.stack);
      return error('服务器内部错误: ' + err.message, 500, 'INTERNAL_ERROR');
    }
  },
};
