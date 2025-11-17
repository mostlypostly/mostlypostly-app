-- ===========================
-- MostlyPostly Unified Schema
-- ===========================

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- ===== Core reference =====
CREATE TABLE IF NOT EXISTS salons (
  id                TEXT PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  phone             TEXT,
  city              TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/Indiana/Indianapolis',
  default_hashtags  TEXT,
  booking_url       TEXT,
  tone              TEXT,
  auto_publish      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS managers (
  id           TEXT PRIMARY KEY,
  salon_id     TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  name         TEXT,
  phone        TEXT UNIQUE,
  chat_id      TEXT,
  role         TEXT DEFAULT 'manager',
  pin          TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stylists (
  id               TEXT PRIMARY KEY,
  salon_id         TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  name             TEXT,
  phone            TEXT UNIQUE,
  chat_id          TEXT,
  instagram_handle TEXT,
  specialties      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  consent_sms      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================
-- POSTS TABLE
-- ===========================
CREATE TABLE IF NOT EXISTS posts (
  id                 TEXT PRIMARY KEY,
  salon_id           TEXT NOT NULL,
  stylist_id         TEXT REFERENCES stylists(id) ON DELETE SET NULL,
  stylist_name       TEXT,
  stylist_phone      TEXT,

  service_type       TEXT,
  caption            TEXT,
  base_caption       TEXT,
  final_caption      TEXT,
  hashtags           TEXT,
  cta                TEXT,
  original_notes     TEXT,

  image_url              TEXT,
  image_mime             TEXT,
  rehosted_image_url     TEXT,
  instagram_handle       TEXT,

  manager_id         TEXT REFERENCES managers(id) ON DELETE SET NULL,
  manager_phone      TEXT,
  manager_chat_id    TEXT,

  status             TEXT NOT NULL,
  denied_reason      TEXT,
  booking_url        TEXT,
  platform_targets   TEXT,

  fb_post_id         TEXT,
  fb_response_id     TEXT,
  ig_container_id    TEXT,
  ig_media_id        TEXT,

  published_at       TEXT,
  scheduled_for      TEXT,
  retry_count        INTEGER DEFAULT 0,
  retry_log          TEXT,

  approved_by        TEXT,
  approved_at        TEXT,
  salon_post_number  INTEGER,

  _meta              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Scheduler =====
CREATE TABLE IF NOT EXISTS scheduler_queue (
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  salon_id      TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  window_label  TEXT,
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON scheduler_queue(status, scheduled_for);

-- ===== Moderation =====
CREATE TABLE IF NOT EXISTS moderation_flags (
  id          TEXT PRIMARY KEY,
  salon_id    TEXT REFERENCES salons(slug) ON DELETE CASCADE,
  post_id     TEXT REFERENCES posts(id) ON DELETE CASCADE,
  level       TEXT NOT NULL,
  reasons     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Analytics =====
CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY,
  salon_id    TEXT,
  post_id     TEXT,
  event       TEXT NOT NULL,
  source      TEXT,
  data        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Manager Tokens (magic links) =====
CREATE TABLE IF NOT EXISTS manager_tokens (
  id           TEXT PRIMARY KEY,
  manager_id   TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stylist_portal_tokens (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  stylist_phone TEXT,
  token        TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

-- ===== Media Cache =====
CREATE TABLE IF NOT EXISTS media_cache (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  source_url   TEXT,
  mime         TEXT,
  bytes        INTEGER,
  width        INTEGER,
  height       INTEGER,
  sha256       TEXT,
  local_path   TEXT,
  public_url   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

COMMIT;
