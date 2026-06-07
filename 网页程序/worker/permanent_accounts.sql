-- 3 Permanent Free Accounts
-- Hash generated with Node.js crypto (same as _worker.js)

-- admin@zhenningyu.top / Admin2026!
INSERT OR REPLACE INTO users (id, email, password_hash, display_name, email_verified, is_active, created_at) VALUES (100, "admin@zhenningyu.top", "3ba15d68cfbe1095e849e7641917d893:75a38aaba61ba1ec88af0c464bec2788c27e081781ae45253c6aee49fcccdb1c", "管理员", 1, 1, datetime("now"));
INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (100, "permanent", datetime("now"), datetime("now", "+100 years"), 1);

-- vip001@zhenningyu.top / Vip2026!001
INSERT OR REPLACE INTO users (id, email, password_hash, display_name, email_verified, is_active, created_at) VALUES (101, "vip001@zhenningyu.top", "eb47205cc3b2958fc0f6879bbb360f29:56874b578484cb5bd703aef39a5d81141b3a6681714296b05b8a1c9490a89d03", "VIP用户1", 1, 1, datetime("now"));
INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (101, "permanent", datetime("now"), datetime("now", "+100 years"), 1);

-- vip002@zhenningyu.top / Vip2026!002
INSERT OR REPLACE INTO users (id, email, password_hash, display_name, email_verified, is_active, created_at) VALUES (102, "vip002@zhenningyu.top", "a51f60224748fa16310e8152377cdfed:2ac7eac2ad92fc094ead1355412d5686a98c414250cbc53bb83c100cac010fb0", "VIP用户2", 1, 1, datetime("now"));
INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active) VALUES (102, "permanent", datetime("now"), datetime("now", "+100 years"), 1);

