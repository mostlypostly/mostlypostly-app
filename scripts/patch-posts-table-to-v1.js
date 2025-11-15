// scripts/patch-posts-table-to-v1.js
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "postly.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");

// Define the new columns your v1 schema expects.
// Each entry = [columnName, sqlTypeAndDefault]
const needed = [
  ["salon_id", "TEXT"],
  ["stylist_id", "TEXT"],
  ["stylist_phone", "TEXT"],
  ["service_type", "TEXT"],
  ["caption", "TEXT"],
  ["base_caption", "TEXT"],
  ["final_caption", "TEXT"],
  ["hashtags", "TEXT"],               // store JSON string
  ["cta", "TEXT"],
  ["original_notes", "TEXT"],
  ["image_url", "TEXT"],
  ["image_mime", "TEXT"],
  ["rehosted_image_url", "TEXT"],
  ["instagram_handle", "TEXT"],
  ["manager_id", "TEXT"],
  ["manager_phone", "TEXT"],
  ["manager_chat_id", "TEXT"],
  ["status", "TEXT"],                 // manager_pending/approved/queued/published/failed/denied/draft
  ["denied_reason", "TEXT"],
  ["booking_url", "TEXT"],
  ["platform_targets", "TEXT"],       // JSON string like ["facebook","instagram"]
  ["fb_post_id", "TEXT"],
  ["fb_response_id", "TEXT"],
  ["ig_container_id", "TEXT"],
  ["ig_media_id", "TEXT"],
  ["published_at", "TEXT"],
  ["_meta", "TEXT"],                  // JSON (moderation, extra flags)
  ["updated_at", "TEXT"]              // keep updated manually for now
];

// Check existing columns
const cols = db.prepare("PRAGMA table_info(posts)").all();
const have = new Set(cols.map(c => c.name));

// Add any missing columns
db.transaction(() => {
  for (const [name, decl] of needed) {
    if (!have.has(name)) {
      const sql = `ALTER TABLE posts ADD COLUMN ${name} ${decl}`;
      console.log("➕", sql);
      db.prepare(sql).run();
    }
  }
})();

console.log("✅ posts table patched to v1 shape.");
db.close();
