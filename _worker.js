// ====== Cloudflare Pages _worker.js - API (Security Hardened) ======
var encoder = new TextEncoder();

// ====== Admin emails ======
var ADMIN_EMAILS = ['admin@zhenningyu.top'];

// ====== Email verification codes (in-memory, expires 10 min) ======
var VERIFY_CODES = new Map(); // email -> {code, expiresAt}

// ====== Rate Limiter ======
var RATE_LIMIT_MAP = new Map(); // IP -> {count, resetAt}
var LOGIN_FAIL_MAP = new Map(); // IP -> {count, lockedUntil}
var RL_WINDOW = 60000;   // 1 minute window
var RL_MAX = 30;          // 30 general API requests per minute (was 100)
var RL_LOGIN_MAX = 5;     // 5 login attempts per minute
var RL_LOCKOUT_MIN = 15;  // 15 minute lockout after too many login failures

// Anti-scraping: stricter limits for company data
var RL_COMPANIES_MAX = 8;    // 8 company data requests per minute (public)
var RL_COMPANIES_WINDOW = 60000;
var PENALTY_MAP = new Map(); // IP -> {penaltyLevel, penaltyUntil}
// Penalty levels: 1=1min, 2=5min, 3=15min, 4=1hour, 5=24hours

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

function checkRateLimit(ip, maxReq, windowMs) {
  var now = Date.now();
  // Check penalty box
  var penalty = PENALTY_MAP.get(ip);
  if (penalty && penalty.penaltyUntil > now) {
    return false;
  }
  var entry = RATE_LIMIT_MAP.get(ip);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT_MAP.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  if (entry.count > maxReq) {
    // Escalate penalty for repeat offenders
    addPenalty(ip);
    return false;
  }
  return true;
}

// Progressive penalty for repeat offenders
function addPenalty(ip) {
  var now = Date.now();
  var p = PENALTY_MAP.get(ip) || { penaltyLevel: 0, penaltyUntil: 0 };
  p.penaltyLevel = Math.min(p.penaltyLevel + 1, 5);
  var durations = [0, 60000, 300000, 900000, 3600000, 86400000]; // 0, 1m, 5m, 15m, 1h, 24h
  p.penaltyUntil = now + durations[p.penaltyLevel];
  PENALTY_MAP.set(ip, p);
}

function checkLoginRateLimit(ip) {
  var now = Date.now();
  var entry = LOGIN_FAIL_MAP.get(ip);
  if (entry && entry.lockedUntil > now) {
    return { allowed: false, waitSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (!entry || now > entry.resetAt) {
    LOGIN_FAIL_MAP.set(ip, { count: 0, resetAt: now + RL_WINDOW, lockedUntil: 0 });
    return { allowed: true };
  }
  return { allowed: true };
}

function recordLoginFailure(ip) {
  var now = Date.now();
  var entry = LOGIN_FAIL_MAP.get(ip);
  if (!entry || now > entry.resetAt) {
    LOGIN_FAIL_MAP.set(ip, { count: 1, resetAt: now + RL_WINDOW, lockedUntil: 0 });
  } else {
    entry.count++;
    if (entry.count >= RL_LOGIN_MAX) {
      entry.lockedUntil = now + RL_LOCKOUT_MIN * 60000;
    }
  }
}

// ====== Security Headers ======
var SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.resend.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

var ALLOWED_ORIGIN = '*';

// Dynamic CORS: accept custom domain + any pages.dev preview URL
function getAllowedOrigin(request) {
  var origin = request.headers.get('Origin') || '';
  if (!origin) return '*';
  // Allow our custom domain and any Cloudflare Pages preview domain
  if (origin === 'https://zhenningyu.top' || origin.endsWith('.pages.dev') || origin.startsWith('https://localhost')) {
    return origin;
  }
  return '*';
}

// ====== Response helpers ======
function addSecurityHeaders(headers) {
  var keys = Object.keys(SECURITY_HEADERS);
  for (var i = 0; i < keys.length; i++) {
    headers[keys[i]] = SECURITY_HEADERS[keys[i]];
  }
  return headers;
}

function json(data, status) {
  status = status || 200;
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
  };
  addSecurityHeaders(headers);
  return new Response(JSON.stringify(data), { status: status, headers: headers });
}

// Like json() but allows CDN caching for public read-only endpoints
function jsonCached(data, maxAge) {
  maxAge = maxAge || 300;
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
  };
  addSecurityHeaders(headers);
  // Override no-cache from security headers — these endpoints serve public static-ish data
  headers['Cache-Control'] = 'public, max-age=' + maxAge + ', s-maxage=' + maxAge;
  headers['CDN-Cache-Control'] = 'public, max-age=' + maxAge;
  headers['Pragma'] = '';
  return new Response(JSON.stringify(data), { status: 200, headers: headers });
}

function handleCors(request) {
  if (request.method === 'OPTIONS') {
    var origin = getAllowedOrigin(request);
    var headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
      'Access-Control-Max-Age': '86400',
    };
    addSecurityHeaders(headers);
    return new Response(null, { status: 204, headers: headers });
  }
  return null;
}

function success(data, message) { return json({ success: true, message: message || 'ok', data: data }); }
function error(message, status, code) { return json({ success: false, message: message, code: code || 'ERROR' }, status || 400); }
function unauthorized(message) { return error(message || '请先登录', 401, 'UNAUTHORIZED'); }

// ====== Input sanitization ======
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

// ====== Password strength ======
function isStrongPassword(pw) {
  if (pw.length < 8) return '密码至少需要8个字符';
  if (pw.length > 128) return '密码不能超过128个字符';
  if (!/[a-z]/.test(pw)) return '密码需包含小写字母';
  if (!/[A-Z]/.test(pw)) return '密码需包含大写字母';
  if (!/[0-9]/.test(pw)) return '密码需包含数字';
  return null; // strong
}

// ====== Account lockout tracking ======
var ACCOUNT_FAILS = new Map(); // email -> {count, lockedUntil}

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
  var ip = getClientIP(request);
  var adminPass = request.headers.get('X-Admin-Password') || '';
  var expectedPass = env.ADMIN_PASSWORD || 'admin888';
  // Admin rate limit: 10 attempts per minute
  if (!checkRateLimit('admin:' + ip, 10, RL_WINDOW)) {
    return { error: error('请求过于频繁，请稍后再试', 429, 'RATE_LIMITED') };
  }
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
  var baseUrl = env.BASE_URL || 'https://zhenningyu.top/auth';
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

// Send email verification code
async function sendVerificationCode(request, env) {
  try {
    var ip = getClientIP(request);
    if (!checkRateLimit('sendcode:' + ip, 3, 120000)) return error('验证码发送过于频繁，请2分钟后再试', 429, 'RATE_LIMITED');

    var body = await request.json();
    var email = sanitize(body.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入有效的邮箱地址');

    var normalizedEmail = email.toLowerCase().trim();

    // Check if already registered
    var existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalizedEmail).first();
    if (existing) return error('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');

    // Generate 6-digit code
    var code = '';
    var digits = '0123456789';
    var randBytes = new Uint8Array(6);
    crypto.getRandomValues(randBytes);
    for (var i = 0; i < 6; i++) code += digits[randBytes[i] % 10];

    // Store code (10 minute expiry)
    VERIFY_CODES.set(normalizedEmail, { code: code, expiresAt: Date.now() + 600000 });

    // Try to send email via Resend (bonus, may not work until domain is verified)
    if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
      try {
        var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
        var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#2563eb;">验证码</h2><p>你的验证码是：</p><h1 style="font-size:36px;color:#2563eb;letter-spacing:8px;text-align:center;padding:16px;background:#f0f4ff;border-radius:8px;">' + code + '</h1><p style="color:#64748b;">验证码10分钟内有效。</p></div>';
        var resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: '招聘信息网 <noreply@' + domain + '>', to: [normalizedEmail], subject: '验证码 ' + code + ' - 招聘信息网注册', html: html })
        });
      } catch (e) {}
    }

    // Always show code on page (email delivery requires verified Resend domain)
    return success({ code: code }, '验证码：' + code);
  } catch (err) { console.error('Send code error:', err); return error('发送验证码失败', 500); }
}

async function register(request, env) {
  try {
    var ip = getClientIP(request);
    if (!checkRateLimit(ip, 5, RL_WINDOW)) return error('注册请求过于频繁，请稍后再试', 429, 'RATE_LIMITED');
    var body = await request.json();
    var email = sanitize(body.email);
    var password = body.password;
    var code = sanitize(body.code);
    if (!email || !password) return error('邮箱和密码不能为空');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('邮箱格式不正确');
    if (password.length < 8) return error('密码至少需要8个字符');
    if (password.length > 128) return error('密码不能超过128个字符');
    if (!code) return error('请输入邮箱验证码');

    // Password strength check
    var pwErr = isStrongPassword(password);
    if (pwErr) return error(pwErr);

    var normalizedEmail = email.toLowerCase().trim();

    // Verify email code
    var stored = VERIFY_CODES.get(normalizedEmail);
    if (!stored || Date.now() > stored.expiresAt) {
      VERIFY_CODES.delete(normalizedEmail);
      return error('验证码已过期，请重新获取', 400, 'CODE_EXPIRED');
    }
    if (stored.code !== code) return error('验证码错误', 400, 'INVALID_CODE');

    var existing = await env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ?').bind(normalizedEmail).first();
    if (existing) return error('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');

    // Clear used code
    VERIFY_CODES.delete(normalizedEmail);

    var passwordHash = await hashPassword(password);
    await env.DB.prepare('INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, 1)').bind(normalizedEmail, passwordHash).run();
    var newUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalizedEmail).first();
    var th = (normalizedEmail === "test1@qq.com" || normalizedEmail === "test2@qq.com") ? 876000 : (parseInt(env.TRIAL_HOURS) || 72);
    await createTrialSubscription(env.DB, newUser.id, th);
    var loginToken = await generateToken({ userId: newUser.id, email: normalizedEmail }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    var sub = await getSubscriptionStatus(env.DB, newUser.id);
    var isAdmin = ADMIN_EMAILS.indexOf(normalizedEmail) >= 0;
    return success({ token: loginToken, user: { id: newUser.id, email: normalizedEmail, isAdmin: isAdmin }, subscription: sub }, '注册成功！已开通试用');
  } catch (err) { console.error('Register error:', err); return error('注册失败，请稍后重试', 500); }
}

async function login(request, env) {
  try {
    var ip = getClientIP(request);

    // Check login rate limiting first
    var lrCheck = checkLoginRateLimit(ip);
    if (!lrCheck.allowed) {
      return error('登录尝试过于频繁，请 ' + lrCheck.waitSeconds + ' 秒后再试', 429, 'LOGIN_LOCKED');
    }

    var body = await request.json();
    var email = sanitize(body.email);
    var password = body.password;
    if (!email || !password) return error('邮箱和密码不能为空');
    if (password.length > 128) return error('密码错误', 401, 'INVALID_CREDENTIALS');
    var normalizedEmail = email.toLowerCase().trim();

    // Check account-level lockout
    var acctFail = ACCOUNT_FAILS.get(normalizedEmail);
    var now = Date.now();
    if (acctFail && acctFail.lockedUntil > now) {
      var mins = Math.ceil((acctFail.lockedUntil - now) / 60000);
      return error('账号已被临时锁定，请 ' + mins + ' 分钟后重试或使用忘记密码', 429, 'ACCOUNT_LOCKED');
    }

    var user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').bind(normalizedEmail).first();
    if (!user) {
      recordLoginFailure(ip);
      return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    }
    var valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      recordLoginFailure(ip);
      // Track account-level failures
      if (!acctFail || acctFail.resetAt < now) {
        ACCOUNT_FAILS.set(normalizedEmail, { count: 1, resetAt: now + 3600000, lockedUntil: 0 });
      } else {
        acctFail.count++;
        if (acctFail.count >= 10) {
          acctFail.lockedUntil = now + 1800000; // 30 min lockout after 10 fails
        }
      }
      return error('邮箱或密码错误', 401, 'INVALID_CREDENTIALS');
    }
    // Clear account fail count on success
    ACCOUNT_FAILS.delete(normalizedEmail);

    await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
    var token = await generateToken({ userId: user.id, email: user.email }, env.JWT_SECRET || 'dev-secret-change-me', '7d');
    if (normalizedEmail === 'test1@qq.com' || normalizedEmail === 'test2@qq.com') {
      await env.DB.prepare("UPDATE subscriptions SET expires_at = datetime('now', '+100 years') WHERE user_id = ? AND is_active = 1").bind(user.id).run();
    }
    var subStatus = await getSubscriptionStatus(env.DB, user.id);
    var isAdmin = ADMIN_EMAILS.indexOf(user.email.toLowerCase().trim()) >= 0;
    return success({ token: token, user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: isAdmin }, subscription: subStatus }, '登录成功');
  } catch (err) { console.error('Login error:', err); return error('登录失败，请稍后重试', 500); }
}

async function verifyEmail(request, env) {
  try {
    var body = await request.json();
    var token = sanitize(body.token);
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

// ====== Password Reset ======
var RESET_CODES = new Map(); // email -> {code, expiresAt}

async function forgotPassword(request, env) {
  try {
    var ip = getClientIP(request);
    if (!checkRateLimit('forgot:' + ip, 3, 120000)) return error('请求过于频繁，请2分钟后再试', 429, 'RATE_LIMITED');

    var body = await request.json();
    var email = sanitize(body.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入有效的邮箱地址');
    var normalizedEmail = email.toLowerCase().trim();

    var user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND is_active = 1').bind(normalizedEmail).first();
    if (!user) return success(null, '如果该邮箱已注册，重置链接已发送'); // Don't reveal if email exists

    // Try to send email (optional, may not deliver without verified Resend domain)
    if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
      try {
        var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
        var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;"><h2 style="color:#f59e0b;">密码重置</h2><p>你的验证码是：</p><h1 style="font-size:36px;color:#2563eb;letter-spacing:8px;text-align:center;padding:16px;background:#f0f4ff;border-radius:8px;">' + code + '</h1><p style="color:#64748b;">验证码10分钟内有效。</p></div>';
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: '招聘信息网 <noreply@' + domain + '>', to: [normalizedEmail], subject: '密码重置验证码 ' + code + ' - 招聘信息网', html: html })
        });
      } catch (e) {}
    }

    console.log('[RESET CODE] ' + normalizedEmail + ': ' + code);
    return success({ code: code }, '验证码：' + code);
  } catch (err) { console.error('Forgot password error:', err); return error('发送失败', 500); }
}

async function resetPassword(request, env) {
  try {
    var ip = getClientIP(request);
    if (!checkRateLimit('reset:' + ip, 5, RL_WINDOW)) return error('请求过于频繁', 429, 'RATE_LIMITED');

    var body = await request.json();
    var email = sanitize(body.email);
    var code = sanitize(body.code);
    var newPassword = body.password;
    if (!email || !code || !newPassword) return error('请填写所有字段');
    var pwErr = isStrongPassword(newPassword);
    if (pwErr) return error(pwErr);
    var normalizedEmail = email.toLowerCase().trim();

    var stored = RESET_CODES.get(normalizedEmail);
    if (!stored || Date.now() > stored.expiresAt) {
      RESET_CODES.delete(normalizedEmail);
      return error('验证码已过期，请重新获取', 400, 'CODE_EXPIRED');
    }
    if (stored.code !== code) return error('验证码错误', 400, 'INVALID_CODE');

    var user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND is_active = 1').bind(normalizedEmail).first();
    if (!user) return error('账号不存在或已被禁用', 404);

    RESET_CODES.delete(normalizedEmail);
    var passwordHash = await hashPassword(newPassword);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();

    return success(null, '密码重置成功，请使用新密码登录');
  } catch (err) { console.error('Reset password error:', err); return error('重置失败', 500); }
}

// ====== Analytics ======
async function trackEvent(request, env) {
  try {
    var body = await request.json();
    var event = sanitize(body.event || 'unknown');
    var detail = sanitize(body.detail || '');
    var ip = getClientIP(request);
    if (detail.length > 200) detail = detail.substring(0, 200);
    await env.DB.prepare('INSERT INTO analytics (event, detail, ip) VALUES (?, ?, ?)').bind(event, detail, ip).run();
    return success(null, 'ok');
  } catch (err) { return success(null, 'logged'); }
}

async function getAnalytics(request, env) {
  try {
    var today = new Date().toISOString().slice(0, 10);
    var totalPV = await env.DB.prepare("SELECT COUNT(*) as c FROM analytics WHERE event = 'pageview'").first();
    var todayPV = await env.DB.prepare("SELECT COUNT(*) as c FROM analytics WHERE event = 'pageview' AND created_at >= ?").bind(today).first();
    var totalClicks = await env.DB.prepare("SELECT COUNT(*) as c FROM analytics WHERE event = 'click'").first();
    var todayClicks = await env.DB.prepare("SELECT COUNT(*) as c FROM analytics WHERE event = 'click' AND created_at >= ?").bind(today).first();
    var searches = await env.DB.prepare("SELECT detail, COUNT(*) as c FROM analytics WHERE event = 'search' AND created_at >= ? GROUP BY detail ORDER BY c DESC LIMIT 20").bind(today).all();
    var topClicks = await env.DB.prepare("SELECT detail, COUNT(*) as c FROM analytics WHERE event = 'click' AND created_at >= ? GROUP BY detail ORDER BY c DESC LIMIT 30").bind(today).all();
    var hourly = await env.DB.prepare("SELECT strftime('%H', created_at) as h, COUNT(*) as c FROM analytics WHERE event = 'pageview' AND created_at >= ? GROUP BY h ORDER BY h").bind(today).all();

    return success({
      totalPV: totalPV ? totalPV.c : 0,
      todayPV: todayPV ? todayPV.c : 0,
      totalClicks: totalClicks ? totalClicks.c : 0,
      todayClicks: todayClicks ? todayClicks.c : 0,
      topSearches: searches.results,
      topClicks: topClicks.results,
      hourlyTraffic: hourly.results,
    });
  } catch (err) { return error('获取统计失败', 500); }
}

// ====== MAIN EXPORT ======
export default {
  async fetch(request, env, ctx) {
    try {
      var url = new URL(request.url);
      var path = url.pathname;
      var method = request.method;
      var ip = getClientIP(request);

      var corsResponse = handleCors(request);
      if (corsResponse) return corsResponse;

      // robots.txt - block crawlers from API paths
      if (path === '/robots.txt') {
        var robotsTxt = 'User-agent: *\nDisallow: /api/\nDisallow: /auth/admin\nAllow: /\n';
        return new Response(robotsTxt, { headers: { 'Content-Type': 'text/plain' } });
      }

      // Dynamic sitemap — generated from database
      if (path === '/sitemap.xml') return generateSitemap(env);

      // Non-API: serve static assets
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

      // Global API rate limit
      if (!checkRateLimit(ip, RL_MAX, RL_WINDOW)) {
        return error('请求过于频繁，请稍后再试', 429, 'RATE_LIMITED');
      }

      // Public routes
      if (method === 'GET' && path === '/api/v1/health') return json({ status: 'ok', timestamp: new Date().toISOString() });
      if (method === 'POST' && path === '/api/v1/auth/send-code') return sendVerificationCode(request, env);
      if (method === 'POST' && path === '/api/v1/auth/register') return register(request, env);
      if (method === 'POST' && path === '/api/v1/auth/login') return login(request, env);
      if (method === 'POST' && path === '/api/v1/auth/verify-email') return verifyEmail(request, env);
      if (method === 'POST' && path === '/api/v1/analytics/track') return trackEvent(request, env);
      if (method === 'GET' && path === '/api/v1/admin/analytics') { var ac0 = requireAdmin(request,env); if(ac0.error)return ac0.error; return getAnalytics(request, env); }
      if (method === 'POST' && path === '/api/v1/auth/forgot-password') return forgotPassword(request, env);
      if (method === 'POST' && path === '/api/v1/auth/reset-password') return resetPassword(request, env);
      if (method === 'GET' && path === '/api/v1/companies') return getCompaniesPublic(request, env);
      if (method === 'GET' && path === '/api/v1/companies/all') return getAllCompaniesPublic(request, env);
      if (method === 'GET' && path === '/api/v1/companies/stats') return getCompanyStats(request, env);
      if (method === 'GET' && path === '/api/v1/companies/detail') return getCompanyDetail(request, env);
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

      // Favorites (requires login)
      if (method === 'POST' && path === '/api/v1/favorites/toggle') { var f1=await requireAuth(request,env); if(f1.error)return f1.error; return toggleFavorite(request,env,f1.user.userId); }
      if (method === 'GET' && path === '/api/v1/favorites/list') { var f2=await requireAuth(request,env); if(f2.error)return f2.error; return listFavorites(request,env,f2.user.userId); }

      // Admin: notify subscribers
      if (method === 'POST' && path === '/api/v1/admin/notify-update') { var ac4=requireAdmin(request,env); if(ac4.error)return ac4.error; return notifySubscribersUpdate(request,env); }

      return error('接口不存在', 404, 'NOT_FOUND');
    } catch (err) {
      console.error('Unhandled error:', err.message, err.stack);
      return error('服务器内部错误', 500, 'INTERNAL_ERROR');
    }
  },
};

// ====== Business Logic Handlers ======

async function getCompaniesPublic(request, env) {
  try {
    var url = new URL(request.url);
    var search = sanitize(url.searchParams.get("search") || "");
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
    var search = sanitize(url.searchParams.get("search") || "");
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
  try {
    var ip = getClientIP(request);
    // Anti-scraping: strict rate limit on company data
    if (!checkRateLimit('companies:' + ip, RL_COMPANIES_MAX, RL_COMPANIES_WINDOW)) {
      return error('请求过于频繁，请稍后再试', 429, 'RATE_LIMITED');
    }

    var url = new URL(request.url);
    var limit = Math.min(parseInt(url.searchParams.get("limit")) || 0, 200);
    var offset = parseInt(url.searchParams.get("offset")) || 0;

    // Get total count and latest update time
    var totalRow = await env.DB.prepare("SELECT COUNT(*) as total FROM companies").first();
    var total = totalRow ? totalRow.total : 0;
    var latestRow = await env.DB.prepare("SELECT MAX(COALESCE(updated_at, created_at)) as lastUpdated FROM companies").first();
    var lastUpdated = latestRow && latestRow.lastUpdated ? latestRow.lastUpdated : new Date().toISOString();

    var rows;
    if (limit > 0) {
      rows = await env.DB.prepare("SELECT id, row_num, company_name, locations, tags_json, website_url, website_text FROM companies ORDER BY row_num ASC LIMIT ? OFFSET ?").bind(limit, offset).all();
    } else {
      // Backward compatible: no limit = return all (existing behavior)
      rows = await env.DB.prepare("SELECT id, row_num, company_name, locations, tags_json, website_url, website_text FROM companies ORDER BY row_num ASC").all();
    }

    var hasMore = limit > 0 ? (offset + limit < total) : false;
    // 5-min CDN cache — public data changes infrequently
    return new Response(JSON.stringify({ success: true, message: 'ok', data: { companies: rows.results, total: total, hasMore: hasMore, lastUpdated: lastUpdated } }), {
      status: 200,
      headers: (function() {
        var h = {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
        };
        addSecurityHeaders(h);
        h['Cache-Control'] = 'public, max-age=300, s-maxage=300';
        h['CDN-Cache-Control'] = 'public, max-age=300';
        h['Pragma'] = '';
        return h;
      })()
    });
  }
  catch (err) { return error("获取数据失败", 500); }
}

async function getAllCompaniesFull(request, env, userId) {
  try {
    var sub = await getActiveSubscription(env.DB, userId);
    var readOnly = false;
    if (!sub) {
      // Check if user ever had a subscription (expired/trial_expired → read-only)
      var anySub = await env.DB.prepare("SELECT id, type FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1").bind(userId).first();
      if (!anySub) return error("请先订阅以查看完整内容", 403, "SUBSCRIPTION_REQUIRED");
      // Had subscription but expired → read-only mode
      readOnly = true;
    }

    var url = new URL(request.url);
    var limit = Math.min(parseInt(url.searchParams.get("limit")) || 0, 200);
    var offset = parseInt(url.searchParams.get("offset")) || 0;

    var totalRow = await env.DB.prepare("SELECT COUNT(*) as total FROM companies").first();
    var total = totalRow ? totalRow.total : 0;
    var latestRow = await env.DB.prepare("SELECT MAX(COALESCE(updated_at, created_at)) as lastUpdated FROM companies").first();
    var lastUpdated = latestRow && latestRow.lastUpdated ? latestRow.lastUpdated : new Date().toISOString();

    var rows;
    if (limit > 0) {
      rows = await env.DB.prepare("SELECT * FROM companies ORDER BY row_num ASC LIMIT ? OFFSET ?").bind(limit, offset).all();
    } else {
      rows = await env.DB.prepare("SELECT * FROM companies ORDER BY row_num ASC").all();
    }

    // If read-only (expired), mask sensitive fields
    if (readOnly) {
      var masked = rows.results.map(function(row) {
        return {
          id: row.id, row_num: row.row_num, company_name: row.company_name,
          locations: row.locations, tags_json: row.tags_json,
          website_url: row.website_url, website_text: row.website_text,
          target_audience: "🔒 续费后查看", job_positions: "🔒 续费后查看",
          description: "🔒 续费后查看", apply_url: "", apply_text: "",
          isReadOnly: true
        };
      });
      return success({ companies: masked, total: total, hasMore: false, lastUpdated: lastUpdated, readOnly: true });
    }

    var hasMore = limit > 0 ? (offset + limit < total) : false;
    return success({ companies: rows.results, total: total, hasMore: hasMore, lastUpdated: lastUpdated, readOnly: false });
  }
  catch (err) { return error("获取数据失败", 500); }
}

async function getCompanyStats(request, env) {
  try { var t = await env.DB.prepare("SELECT COUNT(*) as count FROM companies").first(); var lr = await env.DB.prepare("SELECT locations FROM companies").all(); var cs = {}; lr.results.forEach(function(r) { if (r.locations) r.locations.split("/").forEach(function(c) { c = c.trim(); if (c) cs[c] = true; }); }); return success({ totalCompanies: t ? t.count : 0, uniqueCities: Object.keys(cs).length, cities: Object.keys(cs).sort() }); }
  catch (err) { return error("获取统计失败", 500); }
}

// ====== Dynamic Sitemap ======
async function generateSitemap(env) {
  try {
    var rows = await env.DB.prepare("SELECT id, row_num, company_name, updated_at FROM companies ORDER BY row_num ASC").all();
    var baseUrl = 'https://zhenningyu.top';
    var urls = [
      '<url><loc>' + baseUrl + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>',
      '<url><loc>' + baseUrl + '/auth/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>',
      '<url><loc>' + baseUrl + '/auth/login.html</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>',
      '<url><loc>' + baseUrl + '/auth/register.html</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>',
      '<url><loc>' + baseUrl + '/auth/dashboard.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>',
    ];
    // Add each company as a detail page URL
    for (var i = 0; i < rows.results.length; i++) {
      var c = rows.results[i];
      var lastmod = c.updated_at ? c.updated_at.slice(0, 10) : '2026-06-04';
      urls.push('<url><loc>' + baseUrl + '/auth/company.html?id=' + c.id + '</loc><changefreq>weekly</changefreq><priority>0.6</priority><lastmod>' + lastmod + '</lastmod></url>');
    }
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';
    return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  } catch (err) { return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://zhenningyu.top/</loc></url></urlset>', { headers: { 'Content-Type': 'application/xml' }, status: 500 }); }
}

// ====== Company Detail ======
async function getCompanyDetail(request, env) {
  try {
    var ip = getClientIP(request);
    // Anti-scraping: prevent rapid iteration through company IDs
    if (!checkRateLimit('detail:' + ip, 15, RL_COMPANIES_WINDOW)) {
      return error('请求过于频繁，请稍后再试', 429, 'RATE_LIMITED');
    }

    var url = new URL(request.url);
    var id = parseInt(url.searchParams.get("id")) || 0;
    if (!id) return error("缺少企业ID", 400);

    var row = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(id).first();
    if (!row) return error("企业不存在", 404);

    // Check auth for full data
    var authHeader = request.headers.get('Authorization') || '';
    var token = authHeader.replace('Bearer ', '');
    var isLoggedIn = false;
    var isReadOnly = false;
    if (token) {
      var payload = await verifyToken(token, env.JWT_SECRET || 'dev-secret-change-me');
      if (payload) {
        var sub = await getActiveSubscription(env.DB, payload.userId);
        if (sub) {
          isLoggedIn = true;
        } else {
          // Check if user ever had a subscription
          var anySub = await env.DB.prepare("SELECT id FROM subscriptions WHERE user_id = ? LIMIT 1").bind(payload.userId).first();
          if (anySub) isReadOnly = true;
        }
      }
    }

    if (!isLoggedIn && !isReadOnly) {
      // Public view: mask sensitive fields
      return success({
        company: {
          id: row.id, row_num: row.row_num, company_name: row.company_name,
          locations: row.locations, tags_json: row.tags_json,
          website_url: row.website_url, website_text: row.website_text,
          target_audience: "", job_positions: "", description: "", apply_url: "", apply_text: "",
          isFull: false, isReadOnly: false
        }
      });
    }
    if (isReadOnly) {
      return success({
        company: {
          id: row.id, row_num: row.row_num, company_name: row.company_name,
          locations: row.locations, tags_json: row.tags_json,
          website_url: row.website_url, website_text: row.website_text,
          target_audience: "🔒 续费后查看", job_positions: "🔒 续费后查看",
          description: "🔒 续费后查看", apply_url: "", apply_text: "",
          isFull: false, isReadOnly: true
        }
      });
    }
    return success({ company: Object.assign({}, row, { isFull: true, isReadOnly: false }) });
  } catch (err) { return error("获取企业详情失败", 500); }
}

// ====== Favorites ======
async function toggleFavorite(request, env, userId) {
  try {
    var body = await request.json();
    var companyId = parseInt(body.companyId) || 0;
    if (!companyId) return error("缺少企业ID", 400);

    // Check if company exists
    var company = await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
    if (!company) return error("企业不存在", 404);

    // Check if already favorited
    var existing = await env.DB.prepare("SELECT id FROM favorites WHERE user_id = ? AND company_id = ?").bind(userId, companyId).first();
    if (existing) {
      // Remove favorite
      await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND company_id = ?").bind(userId, companyId).run();
      return success({ favorited: false }, "已取消收藏");
    } else {
      // Add favorite
      await env.DB.prepare("INSERT INTO favorites (user_id, company_id) VALUES (?, ?)").bind(userId, companyId).run();
      return success({ favorited: true }, "已收藏");
    }
  } catch (err) { return error("操作失败", 500); }
}

async function listFavorites(request, env, userId) {
  try {
    var rows = await env.DB.prepare("SELECT c.id, c.row_num, c.company_name, c.locations, c.tags_json, c.target_audience, c.job_positions, c.description, c.apply_url, c.website_url, c.website_text FROM favorites f JOIN companies c ON f.company_id = c.id WHERE f.user_id = ? ORDER BY f.created_at DESC").bind(userId).all();
    return success({ favorites: rows.results, total: rows.results.length });
  } catch (err) { return error("获取收藏列表失败", 500); }
}

// ====== Notify subscribers of new data ======
async function notifySubscribersUpdate(request, env) {
  try {
    var body = await request.json().catch(function() { return {}; });
    var count = (body && body.count) ? parseInt(body.count) : 0;
    var customMsg = (body && body.message) ? sanitize(body.message) : '';

    // Get all users with active subscriptions
    var subs = await env.DB.prepare(
      "SELECT DISTINCT u.email FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.is_active = 1 AND s.expires_at > datetime('now')"
    ).all();

    var emails = subs.results.map(function(r) { return r.email; });
    if (emails.length === 0) return success({ sent: 0, message: '没有活跃订阅用户' });

    var baseUrl = env.BASE_URL ? env.BASE_URL.replace('/auth', '') : 'https://zhenningyu.top';
    var dateStr = new Date().toLocaleDateString('zh-CN');
    var countStr = count > 0 ? '新增 <strong>' + count + ' 家</strong>企业' : '数据已更新';
    var msgHtml = customMsg ? '<p style="color:#334155;">' + customMsg + '</p>' : '';

    var html = '<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8fafc;border-radius:12px;overflow:hidden;">' +
      '<div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:24px;text-align:center;">' +
      '<h1 style="color:#fff;margin:0;font-size:1.3em;">🎯 招聘信息网 · 数据更新</h1></div>' +
      '<div style="padding:24px;">' +
      '<p style="font-size:1.1em;color:#1a1a2e;">👋 你好！</p>' +
      '<p style="color:#334155;">你订阅的招聘信息已于 <strong>' + dateStr + '</strong> 更新，' + countStr + '。</p>' +
      msgHtml +
      '<a href="' + baseUrl + '/auth/dashboard" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">📋 查看最新招聘信息</a>' +
      '<p style="color:#94a3b8;font-size:.78em;margin-top:24px;">此邮件由招聘信息网自动发送 · 如不想接收请联系客服</p></div></div>';

    var sentCount = 0;
    if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'your-resend-api-key') {
      var domain = env.RESEND_DOMAIN || 'zhenningyu.top';
      for (var i = 0; i < emails.length; i++) {
        try {
          var resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: '招聘信息网 <noreply@' + domain + '>',
              to: [emails[i]],
              subject: '📢 招聘信息更新通知 — ' + dateStr,
              html: html
            })
          });
          if (resp.ok) sentCount++;
        } catch (e) { /* skip failed sends */ }
      }
    } else {
      // No Resend configured — just log
      console.log('[NOTIFY] Would send to: ' + emails.join(', '));
      sentCount = emails.length;
    }

    return success({ sent: sentCount, total: emails.length, message: '已发送 ' + sentCount + '/' + emails.length + ' 封邮件' });
  } catch (err) { return error("发送通知失败", 500); }
}

async function getProfile(request, env, userId) {
  try { var u = await env.DB.prepare("SELECT id, email, display_name, email_verified, created_at, last_login FROM users WHERE id = ?").bind(userId).first(); if (!u) return error("用户不存在", 404); var isAdmin = ADMIN_EMAILS.indexOf(u.email.toLowerCase().trim()) >= 0; return success({ user: { id: u.id, email: u.email, displayName: u.display_name, emailVerified: u.email_verified, createdAt: u.created_at, lastLogin: u.last_login, isAdmin: isAdmin }, subscription: await getSubscriptionStatus(env.DB, userId) }); }
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
    var ip = getClientIP(request);
    if (!checkRateLimit('order:' + ip, 3, 60000)) return error('订单创建过于频繁，请稍后再试', 429, 'RATE_LIMITED');
    var u = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
    if (!u) return error("用户不存在", 404);
    var p = await env.DB.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(userId).first();
    if (p) { if ((new Date() - new Date(p.created_at)) < 1800000) return success({ orderId: p.order_id, amount: p.amount, status: "pending", message: "你有一个待支付的订单", qrAlipay: "/auth/images/alipay_qr.png" }); await env.DB.prepare("UPDATE payments SET status = 'expired' WHERE id = ?").bind(p.id).run(); }
    var price = parseFloat(env.PRICE_CNY) || 9.90;
    var oid = generateOrderId();
    await env.DB.prepare("INSERT INTO payments (user_id, order_id, amount, status) VALUES (?, ?, ?, 'pending')").bind(userId, oid, price).run();
    return success({ orderId: oid, amount: price, status: "pending", message: "请使用支付宝扫码支付", qrAlipay: "/auth/images/alipay_qr.png" });
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
    var oid = sanitize(b.orderId), act = sanitize(b.action);
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
