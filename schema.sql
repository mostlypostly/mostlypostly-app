-- v1.1 Multi-Tenant Schema — November 2025
-- Every table now includes salon_id TEXT for tenant separation.
-- Verified by initSchemaHealth.js and check-tenant-health.js

-- schema.sql — MostlyPostly (v0.8) unified DB schema
PRAGMA foreign_keys = ON;

-- ===== Core reference =====
CREATE TABLE IF NOT EXISTS salons (
  id                TEXT PRIMARY KEY,              -- uuid
  slug              TEXT UNIQUE NOT NULL,          -- e.g. "rejuvesalonspa"
  name              TEXT NOT NULL,
  phone             TEXT,
  city              TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/Indiana/Indianapolis',
  booking_url       TEXT,
  facebook_page_id  TEXT,
  instagram_biz_id  TEXT,
  default_hashtags  TEXT,                           -- JSON array
  policy            TEXT,                           -- JSON (schedulerPolicy or overrides)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS managers (
  id           TEXT PRIMARY KEY,
  salon_id     TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  name         TEXT,
  phone        TEXT UNIQUE,                         -- login via SMS; used by /routes/manager
  chat_id      TEXT,                                -- e.g., Telegram/other chat id
  role         TEXT DEFAULT 'manager',
  pin          TEXT,                                -- optional lightweight auth
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stylists (
  id           TEXT PRIMARY KEY,
  salon_id     TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  name         TEXT,
  phone        TEXT UNIQUE,
  instagram_handle TEXT,
  role         TEXT DEFAULT 'stylist',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
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

  -- REQUIRED FOR SCHEDULER
  scheduled_for      TEXT,

  -- REQUIRED FOR RECOVERY
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




CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  approver_id  TEXT REFERENCES managers(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,      -- approved/denied/edited/reset
  reason       TEXT,
  snapshot     TEXT,               -- JSON diff or full post snapshot at time of action
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Scheduler =====
CREATE TABLE IF NOT EXISTS scheduler_queue (
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  salon_id      TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,         -- ISO (salon tz applied by app)
  window_label  TEXT,                  -- e.g., "IG:style_photo", policy bucket
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  status        TEXT NOT NULL DEFAULT 'queued', -- queued/publishing/published/failed/skipped
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-salon effective scheduler policy (optional; else use salons.policy)
CREATE TABLE IF NOT EXISTS scheduler_policy (
  salon_id    TEXT PRIMARY KEY REFERENCES salons(salon_id) ON DELETE CASCADE,
  policy      TEXT NOT NULL,           -- JSON (mirrors schedulerPolicy.json structure)
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Analytics & logs =====
CREATE TABLE IF NOT EXISTS moderation_flags (
  id          TEXT PRIMARY KEY,
  salon_id    TEXT,
  post_id     TEXT NOT NULL,
  level       TEXT,
  reasons     TEXT,
  status      TEXT DEFAULT 'open',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- Optional webhook log (Twilio/Facebook/Instagram callbacks)
CREATE TABLE IF NOT EXISTS webhooks_log (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,           -- twilio/facebook/instagram/telegram
  event_type  TEXT,
  payload     TEXT,                    -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Onboarding / session state =====
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  salon_id    TEXT REFERENCES salons(salon_id) ON DELETE SET NULL,
  phone       TEXT NOT NULL,
  role        TEXT,                    -- 'manager' | 'stylist' | 'unknown'
  step        TEXT,                    -- joinWizard/joinManager state name
  state       TEXT,                    -- JSON blob
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Media cache / rehosting =====
CREATE TABLE IF NOT EXISTS media_cache (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,          -- twilio|telegram|upload
  source_url   TEXT,
  mime         TEXT,
  bytes        INTEGER,
  width        INTEGER,
  height       INTEGER,
  sha256       TEXT,
  local_path   TEXT,
  public_url   TEXT,                   -- final URL used in publishers
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Tokens & credentials (per-salon) =====
CREATE TABLE IF NOT EXISTS tokens (
  id            TEXT PRIMARY KEY,
  salon_id      TEXT NOT NULL REFERENCES salons(slug) ON DELETE CASCADE,
  provider      TEXT NOT NULL,         -- facebook|instagram|telegram|twilio
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,
  extra         TEXT,                  -- JSON (page_id, ig_biz_id, webhook secret, etc.)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (salon_id, provider)
);

-- ===== Moderation =====
CREATE TABLE IF NOT EXISTS moderation_flags (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  level        TEXT,                   -- info/warn/block
  reasons      TEXT,                   -- JSON array of rule hits
  status       TEXT DEFAULT 'open',    -- open/resolved
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

-- ===== Indices =====
CREATE INDEX IF NOT EXISTS idx_posts_salon_created   ON posts(salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_sched    ON posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for   ON scheduler_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_manager_phone         ON managers(phone);
CREATE INDEX IF NOT EXISTS idx_stylist_phone         ON stylists(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_phone        ON sessions(phone);
CREATE INDEX IF NOT EXISTS idx_media_sha             ON media_cache(sha256);

-- ===== Triggers: keep updated_at fresh =====
CREATE TRIGGER IF NOT EXISTS trg_posts_updated_at
AFTER UPDATE ON posts
FOR EACH ROW BEGIN
  UPDATE posts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_salon_updated_at
AFTER UPDATE ON salons
FOR EACH ROW BEGIN
  UPDATE salons SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_managers_updated_at
AFTER UPDATE ON managers
FOR EACH ROW BEGIN
  UPDATE managers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stylists_updated_at
AFTER UPDATE ON stylists
FOR EACH ROW BEGIN
  UPDATE stylists SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_queue_updated_at
AFTER UPDATE ON scheduler_queue
FOR EACH ROW BEGIN
  UPDATE scheduler_queue SET updated_at = datetime('now') WHERE id = NEW.id;
END;
