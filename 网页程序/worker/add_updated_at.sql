ALTER TABLE companies ADD COLUMN updated_at TEXT;
UPDATE companies SET updated_at = created_at;
