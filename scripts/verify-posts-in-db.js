// scripts/verify-posts-in-db.js
// Simple sanity check after migrating posts.json → SQLite

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "postly.db");
const db = new Database(DB_PATH);

// Fetch total count
const total = db.prepare("SELECT COUNT(*) as count FROM posts").get().count;

// Fetch a few sample rows
const rows = db.prepare(`
  SELECT 
    id,
    stylist_name,
    status,
    substr(final_caption, 1, 80) AS preview,
    created_at
  FROM posts
  ORDER BY created_at DESC
  LIMIT 10
`).all();

console.log(`\n📊 Total posts in database: ${total}\n`);
console.log("🧾 Showing up to 10 most recent posts:\n");

for (const row of rows) {
  console.log(`🪄 ID: ${row.id}`);
  console.log(`💇 Stylist: ${row.stylist_name || "Unknown"}`);
  console.log(`📌 Status: ${row.status || "?"}`);
  console.log(`🕒 Created: ${row.created_at || "n/a"}`);
  console.log(`📝 Caption: ${row.preview?.trim() || "(empty)"}\n`);
}

db.close();
console.log("✅ Verification complete.\n");
