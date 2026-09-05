export const SCHEMA_VERSION = 1

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  player_count INTEGER NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'bundled',
  published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS map_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitter_nickname TEXT NOT NULL,
  submitter_ip TEXT,
  map_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  script_json TEXT NOT NULL,
  map_id TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  map_id TEXT,
  scenario_id TEXT,
  started_at TEXT,
  ended_at TEXT NOT NULL DEFAULT (datetime('now')),
  players_json TEXT NOT NULL,
  event_log_json TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'closed'
);

CREATE TABLE IF NOT EXISTS submit_rate_limits (
  ip TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

CREATE INDEX IF NOT EXISTS idx_map_submissions_status ON map_submissions(status);
CREATE INDEX IF NOT EXISTS idx_game_logs_ended_at ON game_logs(ended_at);
`
