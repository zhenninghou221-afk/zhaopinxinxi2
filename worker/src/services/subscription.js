/**
 * Subscription service: trial creation, access checks, stacking logic
 */

/**
 * Create a trial subscription for a new verified user
 */
export async function createTrialSubscription(db, userId, trialHours = 24) {
  const now = new Date();
  const expires = new Date(now.getTime() + trialHours * 60 * 60 * 1000);

  const startsAt = now.toISOString();
  const expiresAt = expires.toISOString();

  await db.prepare(
    `INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active)
     VALUES (?, 'trial', ?, ?, 1)`
  ).bind(userId, startsAt, expiresAt).run();

  return { startsAt, expiresAt, type: 'trial' };
}

/**
 * Check if a user has an active subscription (trial or paid)
 * Returns the active subscription or null
 */
export async function getActiveSubscription(db, userId) {
  const result = await db.prepare(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now')
     ORDER BY expires_at DESC LIMIT 1`
  ).bind(userId).first();

  return result || null;
}

/**
 * Get the latest subscription expiry for a user (for stacking calculation)
 */
export async function getLatestExpiry(db, userId) {
  const result = await db.prepare(
    `SELECT expires_at FROM subscriptions
     WHERE user_id = ?
     ORDER BY expires_at DESC LIMIT 1`
  ).bind(userId).first();

  return result ? result.expires_at : null;
}

/**
 * Activate a paid subscription for a user (with stacking logic)
 */
export async function activatePaidSubscription(db, userId, subscriptionDays = 90) {
  // Deactivate all current active subscriptions
  await db.prepare(
    `UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1`
  ).bind(userId).run();

  // Calculate start time with stacking
  const latestExpiry = await getLatestExpiry(db, userId);
  const now = new Date();

  let startsAt;
  if (latestExpiry && new Date(latestExpiry) > now) {
    // Stack: start from the end of the last subscription
    startsAt = new Date(latestExpiry);
  } else {
    // No active subscription, start now
    startsAt = now;
  }

  const expiresAt = new Date(startsAt.getTime() + subscriptionDays * 24 * 60 * 60 * 1000);

  await db.prepare(
    `INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active)
     VALUES (?, 'paid', ?, ?, 1)`
  ).bind(userId, startsAt.toISOString(), expiresAt.toISOString()).run();

  return {
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    type: 'paid',
  };
}

/**
 * Format remaining time in a human-readable way (Chinese)
 */
export function formatRemaining(expiresAt) {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires - now;

  if (diffMs <= 0) return '已过期';

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) {
    return `剩余 ${days} 天 ${hours} 小时`;
  }
  return `剩余 ${hours} 小时`;
}

/**
 * Get subscription status summary for a user
 */
export async function getSubscriptionStatus(db, userId) {
  const active = await getActiveSubscription(db, userId);

  if (!active) {
    // Check if user ever had a subscription
    const anySub = await db.prepare(
      `SELECT type FROM subscriptions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1`
    ).bind(userId).first();

    if (!anySub) {
      return { hasAccess: false, status: 'none', message: '暂无订阅' };
    }

    const trialUsed = await db.prepare(
      `SELECT id FROM subscriptions WHERE user_id = ? AND type = 'trial'`
    ).bind(userId).first();

    if (trialUsed && !active) {
      return {
        hasAccess: false,
        status: 'trial_expired',
        message: '免费试用已过期，请订阅以继续使用',
      };
    }

    return {
      hasAccess: false,
      status: 'expired',
      message: '订阅已过期，请续费',
    };
  }

  const now = new Date();
  const expiresAt = new Date(active.expires_at);
  const totalDays = Math.floor((expiresAt - now) / (24 * 60 * 60 * 1000));

  return {
    hasAccess: true,
    status: active.type === 'trial' ? 'trial' : 'active',
    type: active.type,
    expiresAt: active.expires_at,
    remaining: formatRemaining(active.expires_at),
    remainingDays: Math.max(0, totalDays),
    message: active.type === 'trial'
      ? `试用中 · ${formatRemaining(active.expires_at)}`
      : `订阅有效 · ${formatRemaining(active.expires_at)}`,
  };
}
