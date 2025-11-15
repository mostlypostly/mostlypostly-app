// scripts/upgrade-to-v1.1-multitenant.js
import db from "../db.js";

const tablesNeedingSalonId = [
  "posts",
  "approvals",
  "analytics_events",
  "scheduler_queue",
  "moderation_flags",
  "media_cache",
  "drafts",
  "stylists",
  "tokens",
  "scheduler_policy",
  "sessions",
  "webhooks_log"
];

for (const table of tablesNeedingSalonId) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN salon_id TEXT`).run();
    console.log(`✅ Added salon_id to ${table}`);
  } catch (err) {
    if (err.message.includes("duplicate column")) {
      console.log(`ℹ️ salon_id already exists in ${table}`);
    } else {
      console.error(`❌ Failed updating ${table}:`, err.message);
    }
  }
}

// Ensure media_cache exists with proper schema
db.prepare(`
  CREATE TABLE IF NOT EXISTS media_cache (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    source_url TEXT,
    public_url TEXT,
    sha256 TEXT,
    mime TEXT,
    bytes INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

console.log("✅ Verified/created media_cache table");

// Optional: verify all updates
const verify = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" +
      tablesNeedingSalonId.map(() => "?").join(",") +
      ")"
  )
  .all(...tablesNeedingSalonId)
  .map((r) => r.name);

console.log("🧩 Schema check complete for tables:", verify);
console.log("🎉 Multi-tenant schema upgrade complete.");
