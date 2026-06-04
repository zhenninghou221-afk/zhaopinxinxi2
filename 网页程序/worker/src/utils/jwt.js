import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

/**
 * Generate a JWT token for authenticated users
 */
export async function generateToken(payload, secret, expiresIn = '7d') {
  const secretKey = encoder.encode(secret);
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
  return token;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token, secret) {
  try {
    const secretKey = encoder.encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Generate a random token (for email verification, password reset)
 */
export function generateRandomToken(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Generate a unique order ID for payments
 */
export function generateOrderId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PAY-${dateStr}-${random}`;
}
