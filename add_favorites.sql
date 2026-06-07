-- Favorites table for bookmarking companies
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  UNIQUE(user_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
