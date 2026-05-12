-- GhostSweeper Bot — D1 Schema
-- Run via: npx wrangler d1 execute bot --file=schema.sql

-- Group configuration
CREATE TABLE IF NOT EXISTS group_config (
  chat_id        INTEGER PRIMARY KEY,
  chat_title     TEXT    NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,   -- 0=disabled, 1=enabled
  auto_scan      INTEGER NOT NULL DEFAULT 1,   -- passive check on messages
  notify_channel INTEGER NOT NULL DEFAULT 1,   -- send removal notifications
  added_by       INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Log of every removed user
CREATE TABLE IF NOT EXISTS removal_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  reason      TEXT    NOT NULL DEFAULT 'deleted_account',  -- deleted_account | passive_check
  removed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_removal_log_chat ON removal_log(chat_id, removed_at DESC);

-- Aggregate stats per group
CREATE TABLE IF NOT EXISTS group_stats (
  chat_id       INTEGER PRIMARY KEY,
  chat_title    TEXT    NOT NULL DEFAULT '',
  total_removed INTEGER NOT NULL DEFAULT 0,
  total_scans   INTEGER NOT NULL DEFAULT 0,
  last_scan_at  TEXT
);

-- Member ID tracking (for full sweeps)
-- We store a JSON array of user_ids per chat in the most recent scan row.
-- Upserted on every new interaction.
CREATE TABLE IF NOT EXISTS pending_scans (
  scan_id    TEXT    PRIMARY KEY,
  chat_id    INTEGER NOT NULL,
  member_ids TEXT    NOT NULL DEFAULT '[]',   -- JSON array of user IDs
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_scans_chat ON pending_scans(chat_id, created_at DESC);

-- Bot admin status cache (TTL managed at app level)
CREATE TABLE IF NOT EXISTS bot_admin_cache (
  chat_id    INTEGER PRIMARY KEY,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
