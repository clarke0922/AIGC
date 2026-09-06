CREATE TABLE IF NOT EXISTS studio_projects (
  drama_id INTEGER PRIMARY KEY REFERENCES dramas(id),
  revision INTEGER NOT NULL DEFAULT 0,
  document TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  budget_micros INTEGER NOT NULL DEFAULT 50000000,
  pilot_task TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  document TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(drama_id, revision)
);
CREATE TABLE IF NOT EXISTS studio_tasks (
  id TEXT PRIMARY KEY,
  drama_id INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  state TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL,
  actual_micros INTEGER,
  config_snapshot TEXT NOT NULL,
  input TEXT NOT NULL,
  provider_task_id TEXT,
  result TEXT,
  usage TEXT,
  error TEXT,
  reconciliation_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(drama_id, request_key)
);
