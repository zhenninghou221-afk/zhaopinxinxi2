const encoder = new TextEncoder();

/**
 * Hash a password using PBKDF2 (Web Crypto API)
 * Returns: salt:hash (hex encoded)
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256
  );

  const saltHex = Array.from(new Uint8Array(salt))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const hashHex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const storedHashBytes = new Uint8Array(hashHex.match(/.{2}/g).map(b => parseInt(b, 16)));

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256
  );

  const hashBytes = new Uint8Array(hash);
  if (hashBytes.length !== storedHashBytes.length) return false;

  return hashBytes.every((b, i) => b === storedHashBytes[i]);
}
