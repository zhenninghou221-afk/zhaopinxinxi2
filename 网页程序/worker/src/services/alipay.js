/**
 * Alipay Face-to-Face Payment (当面付) Service
 *
 * Implements RSA256 signing/verification using Web Crypto API.
 * No external dependencies — works natively in Cloudflare Workers.
 *
 * API Reference: https://opendocs.alipay.com/open/02ekfg
 *
 * Config (from env vars):
 *   ALIPAY_APP_ID        — your app ID from open.alipay.com
 *   ALIPAY_PRIVATE_KEY   — PKCS#8 PEM, your merchant private key
 *   ALIPAY_PUBLIC_KEY    — SPKI PEM, Alipay's public key (not the cert)
 *   ALIPAY_NOTIFY_URL    — https://your-domain.com/api/v1/payment/alipay-notify
 *   ALIPAY_GATEWAY       — optional, defaults to production; use sandbox for testing
 *   ALIPAY_SANDBOX       — set "1" to auto-use sandbox gateway
 */

// ─── Constants ───
const SIGN_TYPE = 'RSA2';
const CHARSET = 'utf-8';
const VERSION = '1.0';
const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

// ─── PEM ↔ ArrayBuffer (for Web Crypto) ───

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

async function importPublicKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'spki', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
}

// ─── Base64 helpers ───

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── Sign-string builder (Alipay spec) ───

function buildSignString(params) {
  const keys = Object.keys(params)
    .filter(k => {
      if (k === 'sign' || k === 'sign_type') return false;
      const v = params[k];
      return v !== '' && v !== undefined && v !== null;
    })
    .sort();
  return keys.map(k => `${k}=${params[k]}`).join('&');
}

// ─── Format timestamp ───

function formatTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Resolve config from env ───

function resolveConfig(env) {
  const appId = env.ALIPAY_APP_ID;
  const privateKey = env.ALIPAY_PRIVATE_KEY;
  const publicKey = env.ALIPAY_PUBLIC_KEY;
  const notifyUrl = env.ALIPAY_NOTIFY_URL;

  if (!appId || !privateKey || !publicKey) {
    return { ready: false, reason: 'Alipay not configured — missing env vars' };
  }

  const isSandbox = env.ALIPAY_SANDBOX === '1' || env.ALIPAY_SANDBOX === 'true';
  const gateway = env.ALIPAY_GATEWAY || (isSandbox ? SANDBOX_GATEWAY : PROD_GATEWAY);

  return { ready: true, appId, privateKey, publicKey, notifyUrl, gateway };
}

// ─── Core: call Alipay gateway ───

async function callGateway(method, bizContent, config) {
  const common = {
    app_id: config.appId,
    method,
    charset: CHARSET,
    sign_type: SIGN_TYPE,
    timestamp: formatTimestamp(),
    version: VERSION,
    biz_content: JSON.stringify(bizContent),
  };

  // Only include notify_url for methods that need it
  if (config.notifyUrl) {
    common.notify_url = config.notifyUrl;
  }

  // Sign
  const signStr = buildSignString(common);
  const key = await importPrivateKey(config.privateKey);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signStr),
  );
  common.sign = arrayBufferToBase64(sig);

  // Build form body
  const body = Object.entries(common)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = await fetch(config.gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });

  const text = await res.text();
  return JSON.parse(text);
}

// ─── Public APIs ───

/**
 * Precreate a face-to-face payment QR code.
 * Returns { qrCode, outTradeNo } — qrCode is a URL to render as QR image.
 */
export async function precreate(env, { outTradeNo, totalAmount, subject, timeoutExpress = '30m' }) {
  const cfg = resolveConfig(env);
  if (!cfg.ready) throw new Error(cfg.reason);

  const result = await callGateway('alipay.trade.precreate', {
    out_trade_no: outTradeNo,
    total_amount: String(totalAmount),
    subject,
    timeout_express: timeoutExpress,
  }, cfg);

  const resp = result.alipay_trade_precreate_response;
  if (!resp || resp.code !== '10000') {
    const msg = resp ? `${resp.msg} (${resp.code})` : 'No response';
    throw new Error(`Alipay precreate failed: ${msg}`);
  }

  return { qrCode: resp.qr_code, outTradeNo: resp.out_trade_no };
}

/**
 * Query payment status from Alipay.
 * Returns { tradeNo, tradeStatus, totalAmount, buyerLogonId } or throws.
 */
export async function query(env, outTradeNo) {
  const cfg = resolveConfig(env);
  if (!cfg.ready) throw new Error(cfg.reason);

  const result = await callGateway('alipay.trade.query', {
    out_trade_no: outTradeNo,
  }, cfg);

  const resp = result.alipay_trade_query_response;
  if (!resp || resp.code !== '10000') {
    const msg = resp ? `${resp.msg} (${resp.code})` : 'No response';
    throw new Error(`Alipay query failed: ${msg}`);
  }

  return {
    tradeNo: resp.trade_no,
    outTradeNo: resp.out_trade_no,
    tradeStatus: resp.trade_status,
    totalAmount: resp.total_amount,
    buyerLogonId: resp.buyer_logon_id,
  };
}

/**
 * Verify Alipay async notification (POST from Alipay to /alipay-notify).
 *
 * Steps:
 *   1. Parse form-urlencoded body to a params object
 *   2. Call verifyNotify(env, params)
 *   3. If { valid: true }, activate subscription & respond 'success'
 *
 * @returns {{ valid: boolean, reason?: string, outTradeNo?: string, tradeNo?: string, totalAmount?: string }}
 */
export async function verifyNotify(env, params) {
  const cfg = resolveConfig(env);
  if (!cfg.ready) return { valid: false, reason: 'Alipay not configured' };

  // 1. Verify signature
  const signReceived = params.sign;
  if (!signReceived) return { valid: false, reason: 'missing sign' };

  const verifyParams = { ...params };
  delete verifyParams.sign;
  delete verifyParams.sign_type;

  const signStr = buildSignString(verifyParams);
  let signatureValid = false;
  try {
    const key = await importPublicKey(cfg.publicKey);
    signatureValid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      key,
      base64ToArrayBuffer(signReceived),
      new TextEncoder().encode(signStr),
    );
  } catch (err) {
    console.error('Alipay notify signature verification error:', err);
    return { valid: false, reason: 'signature verification error' };
  }

  if (!signatureValid) return { valid: false, reason: 'signature mismatch' };

  // 2. Check trade status
  const tradeStatus = params.trade_status;
  if (tradeStatus !== 'TRADE_SUCCESS') {
    return { valid: false, reason: `trade_status=${tradeStatus}, not TRADE_SUCCESS` };
  }

  return {
    valid: true,
    outTradeNo: params.out_trade_no,
    tradeNo: params.trade_no,
    totalAmount: params.total_amount,
    buyerLogonId: params.buyer_logon_id,
    tradeStatus,
  };
}

/**
 * Quick check if Alipay is configured (for feature flag on frontend)
 */
export function isConfigured(env) {
  return resolveConfig(env).ready;
}
