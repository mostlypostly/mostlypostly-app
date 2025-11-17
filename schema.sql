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
  booking_url       TEXT,
  facebook_page_id  TEXT,
  instagram_biz_id  TEXT,
  default_hashtags  TEXT,
  policy            TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stylist_portal_tokens (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  stylist_phone TEXT,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
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
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
);

CREATE TABLE IF NOT EXISTS stylists (
  id               TEXT PRIMARY KEY,
  salon_id         TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  name             TEXT,
  phone            TEXT UNIQUE,
  instagram_handle TEXT,
  role             TEXT DEFAULT 'stylist',
  active           INTEGER NOT NULL DEFAULT 1,
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
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_salon_created   ON posts(salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_sched    ON posts(status, published_at);

CREATE TRIGGER IF NOT EXISTS trg_posts_updated_at
AFTER UPDATE ON posts
FOR EACH ROW BEGIN
  UPDATE posts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ===== Approvals =====
CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  approver_id  TEXT REFERENCES managers(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  reason       TEXT,
  snapshot     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  level       TEXT,
  reasons     TEXT,
  status      TEXT DEFAULT 'open',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- ===== Tokens & Credentials =====
CREATE TABLE IF NOT EXISTS tokens (
  id            TEXT PRIMARY KEY,
  salon_id      TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,
  extra         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (salon_id, provider)
);

-- ===== Sessions =====
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  salon_id    TEXT REFERENCES salons(slug) ON DELETE SET NULL,
  phone       TEXT NOT NULL,
  role        TEXT,
  step        TEXT,
  state       TEXT,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
