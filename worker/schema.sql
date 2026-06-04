-- Database schema for recruitment platform
-- Run: wrangler d1 execute recruitment-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    email_verified INTEGER DEFAULT 0,
    email_verify_token TEXT DEFAULT '',
    email_verify_expires TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_num INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    locations TEXT NOT NULL DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    target_audience TEXT DEFAULT '',
    job_positions TEXT DEFAULT '',
    description TEXT DEFAULT '',
    apply_url TEXT DEFAULT '',
    apply_text TEXT DEFAULT '',
    website_url TEXT DEFAULT '',
    website_text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'trial',
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id TEXT UNIQUE NOT NULL,
    amount REAL NOT NULL DEFAULT 9.90,
    payment_method TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    payment_proof TEXT DEFAULT '',
    verified_at TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_companies_row_num ON companies(row_num);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
