// ====== Cloudflare Pages _worker.js - API ======
var encoder = new TextEncoder();

// ====== Response helpers ======
function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
    },
  });
}
function handleCors(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password', 'Access-Control-Max-Age': '86400' } });
  }
  return null;
}
function success(data, message) { return json({ success: true, message: message || 'ok', data: data }); }
function error(message, status, code) { return json({ success: false, message: message, code: code || 'ERROR' }, status || 400); }
function unauthorized(message) { return error(message || '请先登录', 401, 'UNAUTHORIZED'); }

// ====== Password hashing (PBKDF2) ======
async function hashPassword(password) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  var hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  var saltHex = Array.from(new Uint8Array(salt)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  var hashHex = Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  return saltHex + ':' + hashHex;
}
async function verifyPassword(password, storedHash) {
  var parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  var salt = new Uint8Array(parts[0].match(/.{2}/g).map(function(b) { return parseInt(b, 16); }));
  var storedBytes = new Uint8Array(parts[1].match(/.{2}/g).map(function(b) { return parseInt(b, 16); }));
  var key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  var hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  var hashBytes = new Uint8Array(hash);
  if (hashBytes.length !== storedBytes.length) return false;
  return hashBytes.every(function(b, i) { return b === storedBytes[i]; });
}

// ====== JWT (Web Crypto HMAC-SHA256) ======
function base64urlEncode(buf) {
  var str = '';
  var bytes = new Uint8Array(buf);
  for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  var binary = atob(str);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function generateToken(payload, secret, expiresIn) {
  expiresIn = expiresIn || '7d';
  var header = { alg: 'HS256', typ: 'JWT' };
  var now = Math.floor(Date.now() / 1000);
  var exp;
  if (expiresIn.endsWith('d')) exp = now + parseInt(expiresIn) * 86400;
  else if (expiresIn.endsWith('h')) exp = now + parseInt(expiresIn) * 3600;
  else exp = now + parseInt(expiresIn);
  var claims = Object.assign({}, payload, { iat: now, exp: exp });
  var headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  var claimsB64 = base64urlEncode(encoder.encode(JSON.stringify(claims)));
  var toSign = headerB64 + '.' + claimsB64;
  var key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var sig = await crypto.subtle.sign('HMAC', key, encoder.encode(toSign));
  return toSign + '.' + base64urlEncode(sig);
}
async function verifyToken(token, secret) {
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var claims = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    var now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;
    var key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    var sigBytes = base64urlDecode(parts[2]);
    var valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(parts[0] + '.' + parts[1]));
    return valid ? claims : null;
  } catch (e) { return null; }
}
function generateRandomToken(length) {
  length = length || 32;
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  var result = '';
  for (var i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
  return result;
}
function generateOrderId() {
  var now = new Date();
  var dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  var random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return 'PAY-' + dateStr + '-' + random;
}

// ====== Auth middleware ======
async function requireAuth(request, env) {
  var authHeader = request.headers.get('Authorization') || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token) return { error: unauthorized() };
  var payload = await verifyToken(token, env.JWT_SECRET || 'dev-secret-change-me');
  if (!payload) return { error: unauthorized('登录已过期，请重新登录') };
  return { user: payload };
}
function requireAdmin(request, env) {
  var adminPass = request.headers.get('X-Admin-Password') || '';
  var expectedPass = env.ADMIN_PASSWORD || 'admin888';
  if (adminPass !== expectedPass) return { error: unauthorized('管理员密码错误') };
  return { user: { userId: 0, email: 'admin', isAdmin: true } };
}

// ====== Subscription service ======
async function createTrialSubscription(db, userId, trialHours) {
  trialHours = trialHours || 24;
  var now = new Date();
  var expires = new Date(now.getTime() + trialHours * 3600000);
  await db.prepare("INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (?, 'trial', ?, ?, 1)").bind(userId, now.toISOString(), expires.toISOString()).run();
  return { startsAt: now.toISOString(), expiresAt: expires.toISOString(), type: 'trial' };
}
async function getActiveSubscription(db, userId) {
  return await db.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").bind(userId).first() || null;
}
async function getLatestExpiry(db, userId) {
  var result = await db.prepare('SELECT expires_at FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1').bind(userId).first();
  return result ? result.expires_at : null;
}
async function activatePaidSubscription(db, userId, subscriptionDays) {
  subscriptionDays = subscriptionDays || 90;
  await db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').bind(userId).run();
  var latestExpiry = await getLatestExpiry(db, userId);
  var now = new Date();
  var startsAt = (latestExpiry && new Date(latestExpiry) > now) ? new Date(latestExpiry) : now;
  var expiresAt = new Date(startsAt.getTime() + subscriptionDays * 86400000);
  await db.prepare("INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (?, 'paid', ?, ?, 1)").bind(userId, startsAt.toISOString(), expiresAt.toISOString()).run();
  return { startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString(), type: 'paid' };
}
function formatRemaining(expiresAt) {
  var diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return '已过期';
  var days = Math.floor(diffMs / 86400000);
  var hours = Math.floor((diffMs % 86400000) / 3600000);
  return days > 0 ? '剩余 ' + days + ' 天 ' + hours + ' 小时' : '剩余 ' + hours + ' 小时';
}
async function getSubscriptionStatus(db, userId) {
  var active = await getActiveSubscription(db, userId);
  if (!active) {
    var anySub = await db.prepare('SELECT type FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1').bind(userId).first();
    if (!anySub) return { hasAccess: false, status: 'none', message: '暂无订阅' };
    var trialUsed = await db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND type = 'trial'").bind(userId).first();
    if (trialUsed) return { hasAccess: false, status: 'trial_expired', message: '免费试用已过期，请订阅以继续使用' };
    return { hasAccess: false, status: 'expired', message: '订阅已过期，请续费' };
  }
  return {
    hasAccess: true, status: active.type === 'trial' ? 'trial' : 'active', type: active.type,
    expiresAt: active.expires_at, remaining: formatRemaining(active.expires_at),
    remainingDays: Math.max(0, Math.floor((new Date(active.expires_at) - new Date()) / 86400000)),
    message: active.type === 'trial' ? '试用中 · ' + formatRemaining(active.expires_at) : '订阅有效 · ' + formatRemaining(active.expires_at)
  };
}

// ====== Email service ======
async function sendVerificationEmail(to, token, env) {
  var baseUrl = env.BASE_URL || 'https://zhenningyu.top/登陆注册';
  var verifyUrl = baseUrl + '/verify-email?token=' + token;
  var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#2563eb;">📧 验证你的邮箱</h2><p>感谢注册招聘信息网！请点击下方按钮验证你的邮箱地址：</p><a href="' + verifyUrl + '" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0;">验证邮箱</a><p style="color:#64748b;">或复制以下链接到浏览器：</p><p style="color:#64748b;word-break:break-all;">' + verifyUrl + '</p><p style="color:#94a3b8;font-size:12px;">此链接24小时内有效。注册后你将获得<strong>1天免费试用</strong>。</p></div>';
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
      var resp = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '招聘信息网 <noreply@' + domain + '>', to: [to], subject: '验证你的邮箱 - 招聘信息网', html: html }) });
      if (resp.ok) return { success: true, method: 'resend' };
    } catch (e) { console.error('Resend error:', e); }
  }
  console.log('[EMAIL] Verify URL for ' + to + ': ' + verifyUrl);
  return { success: true, method: 'console', verifyUrl: verifyUrl };
}
async function sendPaymentConfirmation(to, orderId, env) {
  var baseUrl = env.BASE_URL || '';
  var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#16a34a;">✅ 支付确认</h2><p>你的付款已确认！订单号：<strong>' + orderId + '</strong></p><p>订阅有效期已延长90天，现在可以查看全部招聘信息了。</p><a href="' + baseUrl + '/dashboard" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">查看完整信息</a></div>';
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '招聘信息网 <noreply@' + domain + '>', to: [to], subject: '付款确认 - 招聘信息网', html: html }) });
    } catch (e) {}
  }
  return { success: true };
}
async function notifyAdminNewPayment(userEmail, orderId, env) {
  var adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return { success: false, reason: 'no admin email' };
  var baseUrl = env.BASE_URL || '';
  var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2>📢 新支付待审核</h2><p>用户 <strong>' + userEmail + '</strong> 上传了付款截图</p><p>订单号：<strong>' + orderId + '</strong></p><a href="' + baseUrl + '/admin" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;">去审核</a></div>';
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
    try {
      var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '招聘信息网 <noreply@' + domain + '>', to: [adminEmail], subject: '新支付待审核 - ' + userEmail, html: html }) });
    } catch (e) {}
  }
  return { success: true };
}

// ====== ROUTES ======

// Auth routes
async function register(request, env) {
  try {
    var body = await request.json();
    var email = body.email;
    var password = body.password;
    if (!email || !password) return error('邮箱和密码不能为空');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('邮箱格式不正确');
    if (password.length < 8) return error('密码至少需要8个字符');
    var normalizedEmail = email.toLowerCase().trim();

    var existing = await env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ?').bind(normalizedEmail).first();
    if (existing) return error('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');

    var passwordHash = await hashPassword(password);
    await env.DB.prepare('INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, 1)').bind(normalizedEmail, passwordHash).run();
    var newUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalizedEmail).first();
    var th = parseInt(env.TRIAL_HOURS) || 24;
    await createTrialSubscription(env.DB, newUser.id, th);
    var loginToken = await generateToken({ userId: newUser.id, email: normalizedEmail }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    var sub = await getSubscriptionStatus(env.DB, newUser.id);
    return success({ token: loginToken, user: { id: newUser.id, email: normalizedEmail }, subscription: sub }, '注册成功！已开通试用');
  } catch (err) { console.error('Register error:', err); return error('注册失败，请稍后重试', 500); }
}

async function login(request, env) {
  try {
    var body = await request.json();
    var email = body.email;
    var password = body.password;
    if (!email || !password) return error('邮箱和密码不能为空');
    var normalizedEmail = email.toLowerCase().trim();
    var user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').bind(normalizedEmail).first();
    if (!user) return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    var valid = await verifyPassword(password, user.password_hash);
    if (!valid) return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');

    await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
    var token = await generateToken({ userId: user.id, email: user.email }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    var subStatus = await getSubscriptionStatus(env.DB, user.id);
    return success({ token: token, user: { id: user.id, email: user.email, displayName: user.display_name }, subscription: subStatus }, '登录成功');
  } catch (err) { console.error('Login error:', err); return error('登录失败，请稍后重试', 500); }
}

async function verifyEmail(request, env) {
  try {
    var body = await request.json();
    var token = body.token;
    if (!token) return error('验证令牌不能为空');
    var now = new Date().toISOString();
    var user = await env.DB.prepare('SELECT * FROM users WHERE email_verify_token = ? AND email_verify_expires > ?').bind(token, now).first();
    if (!user) return error('验证链接已过期或无效，请重新注册', 400, 'INVALID_TOKEN');
    if (user.email_verified) return success({ email: user.email }, '邮箱已验证，请登录');

    await env.DB.prepare("UPDATE users SET email_verified = 1, email_verify_token = '', email_verify_expires = '' WHERE id = ?").bind(user.id).run();

    var existingSub = await env.DB.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND type = 'trial'").bind(user.id).first();
    if (!existingSub) {
      var trialHours = parseInt(env.TRIAL_HOURS) || 24;
      await createTrialSubscription(env.DB, user.id, trialHours);
    }

    var jwtToken = await generateToken({ userId: user.id, email: user.email }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    var subStatus = await getSubscriptionStatus(env.DB, user.id);
    return success({ token: jwtToken, subscription: subStatus }, '邮箱验证成功！已自动开通1天免费试用');
  } catch (err) { console.error('Verify email error:', err); return error('验证失败，请稍后重试', 500); }
}

// ====== MAIN EXPORT ======
export default {
  async fetch(request, env, ctx) {
    try {
      var url = new URL(request.url);
      var path = url.pathname;
      var method = request.method;

      var corsResponse = handleCors(request);
      if (corsResponse) return corsResponse;

      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

      // Public routes
      if (method === 'GET' && path === '/api/v1/health') return json({ status: 'ok', timestamp: new Date().toISOString() });
      if (method === 'POST' && path === '/api/v1/auth/register') return register(request, env);
      if (method === 'POST' && path === '/api/v1/auth/login') return login(request, env);
      if (method === 'POST' && path === '/api/v1/auth/verify-email') return verifyEmail(request, env);
      if (method === 'GET' && path === '/api/v1/companies') return getCompaniesPublic(request, env);
      if (method === 'GET' && path === '/api/v1/companies/all') return getAllCompaniesPublic(request, env);
      if (method === 'GET' && path === '/api/v1/companies/stats') return getCompanyStats(request, env);
      if (method === 'GET' && path === '/api/v1/companies/full') { var a1=await requireAuth(request,env); if(a1.error)return a1.error; return getCompaniesFull(request,env,a1.user.userId); }
      if (method === 'GET' && path === '/api/v1/companies/all-full') { var a2=await requireAuth(request,env); if(a2.error)return a2.error; return getAllCompaniesFull(request,env,a2.user.userId); }
      if (method === 'GET' && path === '/api/v1/user/profile') { var a3=await requireAuth(request,env); if(a3.error)return a3.error; return getProfile(request,env,a3.user.userId); }
      if (method === 'GET' && path === '/api/v1/subscription/status') { var a4=await requireAuth(request,env); if(a4.error)return a4.error; return getSubStatus(request,env,a4.user.userId); }
      if (method === 'GET' && path === '/api/v1/subscription/history') { var a5=await requireAuth(request,env); if(a5.error)return a5.error; return getSubHistory(request,env,a5.user.userId); }
      if (method === 'POST' && path === '/api/v1/payment/create-order') { var a6=await requireAuth(request,env); if(a6.error)return a6.error; return createOrder(request,env,a6.user.userId); }
      if (method === 'POST' && path === '/api/v1/payment/upload-proof') { var a7=await requireAuth(request,env); if(a7.error)return a7.error; return uploadProof(request,env,a7.user.userId); }
      if (method === 'GET' && path === '/api/v1/payment/orders') { var a8=await requireAuth(request,env); if(a8.error)return a8.error; return getOrders(request,env,a8.user.userId); }
      if (method === 'GET' && path === '/api/v1/admin/pending-payments') { var ac1=requireAdmin(request,env); if(ac1.error)return ac1.error; return getPendingPayments(request,env); }
      if (method === 'POST' && path === '/api/v1/admin/verify-payment') { var ac2=requireAdmin(request,env); if(ac2.error)return ac2.error; return verifyPayment(request,env); }
      if (method === 'GET' && path === '/api/v1/admin/stats') { var ac3=requireAdmin(request,env); if(ac3.error)return ac3.error; return getAdminStats(request,env); }

      return error('接口不存在', 404, 'NOT_FOUND');
    } catch (err) {
      console.error('Unhandled error:', err.message, err.stack);
      return error('服务器内部错误: ' + err.message, 500, 'INTERNAL_ERROR');
    }
  },
};

async function getCompaniesPublic(request, env) {
  try {
    var url = new URL(request.url);
    var search = url.searchParams.get("search") || "";
    var page = parseInt(url.searchParams.get("page")) || 1;
    var limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 200);
    var offset = (page - 1) * limit;
    var query = "SELECT * FROM companies";
    var countQuery = "SELECT COUNT(*) as total FROM companies";
    var params = [], countParams = [];
    if (search) { var w = " WHERE (company_name LIKE ? OR locations LIKE ?)"; query += w; countQuery += w; var t = "%" + search + "%"; params.push(t, t); countParams.push(t, t); }
    query += " ORDER BY row_num ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    var r1 = await env.DB.prepare(query).bind.apply(env.DB.prepare(query), params).all();
    var r2 = await env.DB.prepare(countQuery).bind.apply(env.DB.prepare(countQuery), countParams).first();
    var masked = r1.results.map(function(row) { return { id: row.id, row_num: row.row_num, company_name: row.company_name, locations: row.locations, tags_json: row.tags_json, target_audience: "", job_positions: "", description: "", apply_url: "", apply_text: "", website_url: row.website_url, website_text: row.website_text }; });
    return success({ companies: masked, pagination: { page: page, limit: limit, total: r2 ? r2.total : 0, totalPages: Math.ceil((r2 ? r2.total : 0) / limit) } });
  } catch (err) { return error("获取招聘信息失败", 500); }
}

async function getCompaniesFull(request, env, userId) {
  try {
    var sub = await getActiveSubscription(env.DB, userId);
    if (!sub) return error("请先订阅以查看完整内容", 403, "SUBSCRIPTION_REQUIRED");
    var url = new URL(request.url);
    var search = url.searchParams.get("search") || "";
    var page = parseInt(url.searchParams.get("page")) || 1;
    var limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 200);
    var offset = (page - 1) * limit;
    var query = "SELECT * FROM companies", countQuery = "SELECT COUNT(*) as total FROM companies";
    var params = [], countParams = [];
    if (search) { var w = " WHERE (company_name LIKE ? OR locations LIKE ? OR target_audience LIKE ? OR job_positions LIKE ? OR description LIKE ? OR tags_json LIKE ?)"; query += w; countQuery += w; var t = "%" + search + "%"; for (var i = 0; i < 6; i++) { params.push(t); countParams.push(t); } }
    query += " ORDER BY row_num ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    var r1 = await env.DB.prepare(query).bind.apply(env.DB.prepare(query), params).all();
    var r2 = await env.DB.prepare(countQuery).bind.apply(env.DB.prepare(countQuery), countParams).first();
    return success({ companies: r1.results, pagination: { page: page, limit: limit, total: r2 ? r2.total : 0, totalPages: Math.ceil((r2 ? r2.total : 0) / limit) } });
  } catch (err) { return error("获取完整信息失败", 500); }
}

async function getAllCompaniesPublic(request, env) {
  try { var rows = await env.DB.prepare("SELECT id, row_num, company_name, locations, tags_json, website_url, website_text FROM companies ORDER BY row_num ASC").all(); return success({ companies: rows.results, total: rows.results.length }); }
  catch (err) { return error("获取数据失败", 500); }
}

async function getAllCompaniesFull(request, env, userId) {
  try { var sub = await getActiveSubscription(env.DB, userId); if (!sub) return error("请先订阅以查看完整内容", 403, "SUBSCRIPTION_REQUIRED"); var rows = await env.DB.prepare("SELECT * FROM companies ORDER BY row_num ASC").all(); return success({ companies: rows.results, total: rows.results.length }); }
  catch (err) { return error("获取数据失败", 500); }
}

async function getCompanyStats(request, env) {
  try { var t = await env.DB.prepare("SELECT COUNT(*) as count FROM companies").first(); var lr = await env.DB.prepare("SELECT locations FROM companies").all(); var cs = {}; lr.results.forEach(function(r) { if (r.locations) r.locations.split("/").forEach(function(c) { c = c.trim(); if (c) cs[c] = true; }); }); return success({ totalCompanies: t ? t.count : 0, uniqueCities: Object.keys(cs).length, cities: Object.keys(cs).sort() }); }
  catch (err) { return error("获取统计失败", 500); }
}

async function getProfile(request, env, userId) {
  try { var u = await env.DB.prepare("SELECT id, email, display_name, email_verified, created_at, last_login FROM users WHERE id = ?").bind(userId).first(); if (!u) return error("用户不存在", 404); return success({ user: u, subscription: await getSubscriptionStatus(env.DB, userId) }); }
  catch (err) { return error("获取用户信息失败", 500); }
}

async function getSubStatus(request, env, userId) {
  try { return success(await getSubscriptionStatus(env.DB, userId)); } catch (err) { return error("获取订阅状态失败", 500); }
}

async function getSubHistory(request, env, userId) {
  try { var s = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").bind(userId).all(); return success({ subscriptions: s.results, total: s.results.length }); }
  catch (err) { return error("获取历史记录失败", 500); }
}

async function createOrder(request, env, userId) {
  try {
    var u = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
    if (!u) return error("用户不存在", 404);
    var p = await env.DB.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(userId).first();
    if (p) { if ((new Date() - new Date(p.created_at)) < 1800000) return success({ orderId: p.order_id, amount: p.amount, status: "pending", message: "你有一个待支付的订单", qrAlipay: "/登陆注册/images/alipay_qr.png", qrWechat: "/登陆注册/images/wechat_qr.png" }); await env.DB.prepare("UPDATE payments SET status = 'expired' WHERE id = ?").bind(p.id).run(); }
    var price = parseFloat(env.PRICE_CNY) || 9.90;
    var oid = generateOrderId();
    await env.DB.prepare("INSERT INTO payments (user_id, order_id, amount, status) VALUES (?, ?, ?, 'pending')").bind(userId, oid, price).run();
    return success({ orderId: oid, amount: price, status: "pending", message: "请支付", qrAlipay: "/登陆注册/images/alipay_qr.png", qrWechat: "/登陆注册/images/wechat_qr.png" });
  } catch (err) { return error("创建订单失败", 500); }
}

async function uploadProof(request, env, userId) {
  try {
    var fd = await request.formData();
    var file = fd.get("proof"), oid = fd.get("orderId");
    if (!file || !oid) return error("请提供付款截图和订单号");
    var o = await env.DB.prepare("SELECT * FROM payments WHERE order_id = ? AND user_id = ?").bind(oid, userId).first();
    if (!o) return error("订单不存在", 404);
    if (o.status !== "pending") return error("订单状态不正确");
    if (["image/jpeg","image/png","image/webp","image/gif"].indexOf(file.type) === -1) return error("请上传JPG/PNG图片");
    if (file.size > 5242880) return error("图片大小不能超过5MB");
    var fn = "proof-" + oid + "-" + Date.now() + "." + file.type.split("/")[1];
    try { await env.PAYMENT_BUCKET.put(fn, file.stream(), { httpMetadata: { contentType: file.type } }); } catch (e) { return error("文件上传服务未配置", 500); }
    await env.DB.prepare("UPDATE payments SET payment_proof = ? WHERE order_id = ?").bind(fn, oid).run();
    var u = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
    if (u) await notifyAdminNewPayment(u.email, oid, env);
    return success({ orderId: oid, status: "pending_verify" }, "上传成功，等待审核");
  } catch (err) { return error("上传失败", 500); }
}

async function getOrders(request, env, userId) {
  try { var o = await env.DB.prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").bind(userId).all(); return success({ orders: o.results, total: o.results.length }); }
  catch (err) { return error("获取订单失败", 500); }
}

async function getPendingPayments(request, env) {
  try { var p = await env.DB.prepare("SELECT p.*, u.email as user_email FROM payments p JOIN users u ON p.user_id = u.id WHERE p.status = 'pending' AND p.payment_proof != '' ORDER BY p.created_at ASC").all(); return success({ payments: p.results, total: p.results.length }); }
  catch (err) { return error("获取待审核列表失败", 500); }
}

async function verifyPayment(request, env) {
  try {
    var b = await request.json();
    var oid = b.orderId, act = b.action;
    if (!oid || !act) return error("请提供订单号和操作");
    if (act !== "approve" && act !== "reject") return error("操作只能是approve或reject");
    var p = await env.DB.prepare("SELECT p.*, u.email as user_email FROM payments p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?").bind(oid).first();
    if (!p) return error("订单不存在", 404);
    if (p.status !== "pending") return error("订单状态为" + p.status);
    var now = new Date().toISOString();
    if (act === "approve") {
      await env.DB.prepare("UPDATE payments SET status = 'completed', completed_at = ?, verified_at = ? WHERE order_id = ?").bind(now, now, oid).run();
      var sd = parseInt(env.SUBSCRIPTION_DAYS) || 90;
      var sub = await activatePaidSubscription(env.DB, p.user_id, sd);
      await sendPaymentConfirmation(p.user_email, oid, env);
      return success({ orderId: oid, status: "completed", subscription: sub }, "付款已确认");
    } else {
      await env.DB.prepare("UPDATE payments SET status = 'cancelled', completed_at = ? WHERE order_id = ?").bind(now, oid).run();
      return success({ orderId: oid, status: "cancelled" }, "已拒绝");
    }
  } catch (err) { return error("操作失败", 500); }
}

async function getAdminStats(request, env) {
  try {
    var r = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as count FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'completed'").first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed'").first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1 AND expires_at > datetime('now')").first()
    ]);
    return success({ totalUsers: r[0]?r[0].count:0, totalCompletedPayments: r[1]?r[1].count:0, totalRevenue: r[2]?r[2].total:0, activeSubscriptions: r[3]?r[3].count:0 });
  } catch (err) { return error("获取统计数据失败", 500); }
}
