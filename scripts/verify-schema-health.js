// scripts/verify-schema-health.js
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "postly.db");
const db = new Database(DB_PATH);

const requiredCols = [
  "id","salon_id","stylist_id","stylist_name","stylist_phone","service_type",
  "caption","base_caption","final_caption","hashtags","cta","original_notes",
  "image_url","image_mime","rehosted_image_url","instagram_handle",
  "manager_id","manager_phone","manager_chat_id","booking_url","status",
  "denied_reason","platform_targets","fb_post_id","fb_response_id",
  "ig_container_id","ig_media_id","published_at","_meta",
  "created_at","updated_at"
];

const existing = new Set(
  db.prepare("PRAGMA table_info(posts)").all().map(c => c.name)
);

let added = 0;
for (const col of requiredCols) {
  if (!existing.has(col)) {
    db.prepare(`ALTER TABLE posts ADD COLUMN ${col} TEXT`).run();
    console.log(`➕ Added missing column: ${col}`);
    added++;
  }
}

if (!added) console.log("✅ posts table is up-to-date.");
else console.log(`✅ Added ${added} missing columns.`);

db.close();
