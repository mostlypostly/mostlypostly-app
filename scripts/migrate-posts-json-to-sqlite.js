// scripts/migrate-posts-json-to-sqlite.js
// Safe universal migration from data/posts.json → SQLite posts table

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { webcrypto as _wc } from "crypto";
const crypto = _wc;

const DATA_FILE = path.join(process.cwd(), "data", "posts.json");
const DB_PATH = path.join(process.cwd(), "postly.db");

if (!fs.existsSync(DATA_FILE)) {
  console.error("❌ data/posts.json not found. Nothing to migrate.");
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error("❌ postly.db not found. Run schema.sql and patcher first.");
  process.exit(1);
}

const posts = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
console.log(`📦 Loaded ${posts.length} posts from posts.json`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");

// Detect whether `id` column is INTEGER or TEXT
const info = db.prepare("PRAGMA table_info(posts)").all();
const idCol = info.find((c) => c.name === "id");
const idIsInteger = idCol && idCol.type.toUpperCase().includes("INT");
console.log(`🧠 posts.id column type: ${idCol?.type} → treating as ${idIsInteger ? "auto-increment" : "text"}`);

// Build insert SQL dynamically
const insertSQL = `
  INSERT INTO posts (
    ${idIsInteger ? "" : "id,"}
    salon_id,
    stylist_id,
    stylist_name,
    stylist_phone,
    service_type,
    caption,
    base_caption,
    final_caption,
    hashtags,
    cta,
    original_notes,
    image_url,
    instagram_handle,
    manager_phone,
    manager_chat_id,
    booking_url,
    status,
    denied_reason,
    created_at,
    updated_at
  ) VALUES (
    ${idIsInteger ? "" : "@id,"}
    COALESCE(@salon_id, 'unknown'),
    NULL,
    @stylist_name,
    @stylist_phone,
    @service_type,
    @caption,
    @base_caption,
    @final_caption,
    @hashtags,
    @cta,
    @original_notes,
    @image_url,
    @instagram_handle,
    @manager_phone,
    @manager_chat_id,
    @booking_url,
    @status,
    @denied_reason,
    COALESCE(@created_at, datetime('now')),
    COALESCE(@updated_at, datetime('now'))
  )
`;
const insert = db.prepare(insertSQL);

// Transaction migration
const txn = db.transaction((rows) => {
  let count = 0;
  for (const r of rows) {
    const hashtags = Array.isArray(r.hashtags)
      ? JSON.stringify(r.hashtags)
      : JSON.stringify([]);

    // Only include id if it's TEXT type
    const data = {
      ...(idIsInteger ? {} : { id: r.id || cryptoRandomId() }),
      salon_id: r.salon_id || r.salon?.id || "unknown",
      stylist_id: null,
      stylist_name: r.stylist_name || "Unknown Stylist",
      stylist_phone: r.stylist_phone || r.phone || "",
      service_type: r.service_type || null,
      caption: String(r.caption || ""),
      base_caption: String(r.base_caption || r.caption || ""),
      final_caption: String(r.final_caption || r.caption || ""),
      hashtags,
      cta: String(r.cta || "Book your next visit today!"),
      original_notes: String(r.original_notes || ""),
      image_url: String(r.image_url || ""),
      instagram_handle: String(r.instagram_handle || ""),
      manager_phone: r.manager_phone || null,
      manager_chat_id: r.manager_chat_id || null,
      booking_url: r.booking_url || null,
      status: String(r.status || "draft"),
      denied_reason: r.denied_reason ? String(r.denied_reason) : null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
    };

    try {
      insert.run(data);
      count++;
    } catch (err) {
      console.warn(`⚠️ Skipped row due to error: ${err.message}`);
    }
  }
  console.log(`✅ Migrated ${count} posts into SQLite.`);
});

function cryptoRandomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

txn(posts);

const rowCount = db.prepare("SELECT COUNT(*) as c FROM posts").get().c;
console.log(`📊 Total posts now in DB: ${rowCount}`);

db.close();
console.log("🏁 Migration complete.");
