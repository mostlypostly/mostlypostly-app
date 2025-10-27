// db.js — lightweight SQLite wrapper for Postly (ESM version)
import sqlite3pkg from "sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const sqlite3 = sqlite3pkg.verbose();

// --- Ensure correct file path ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "postly.db");

// --- Connect or create database ---
export const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ DB connection error:", err);
  else console.log("✅ Connected to postly.db");
});

// --- Initialize tables ---
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      stylist_name TEXT,
      salon_name TEXT,
      city TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      stylist_name TEXT,
      salon_name TEXT,
      city TEXT,
      ig_post TEXT,
      fb_post TEXT,
      x_post TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ---- helpers ----
export function saveDraft(phone, stylist, aiJson) {
  const data = JSON.stringify(aiJson);
  db.run(
    `INSERT INTO drafts (phone, stylist_name, salon_name, city, data)
     VALUES (?, ?, ?, ?, ?)`,
    [phone, stylist?.stylist_name, stylist?.salon_name, stylist?.city, data],
    (err) => {
      if (err) console.error("⚠️ DB insert error (draft):", err);
      else console.log(`💾 Draft saved for ${stylist?.stylist_name || phone}`);
    }
  );
}

export function getLatestDraft(phone, callback) {
  db.get(
    `SELECT * FROM drafts WHERE phone = ? ORDER BY created_at DESC LIMIT 1`,
    [phone],
    (err, row) => callback(err, row ? JSON.parse(row.data) : null)
  );
}

export function savePost(phone, stylist, igPost, fbPost, xPost, io = null) {
  db.run(
    `INSERT INTO posts (phone, stylist_name, salon_name, city, ig_post, fb_post, x_post)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      stylist?.stylist_name,
      stylist?.salon_name,
      stylist?.city,
      igPost,
      fbPost,
      xPost,
    ],
    (err) => {
      if (err) {
        console.error("⚠️ DB insert error (post):", err);
      } else {
        console.log(`✅ Post saved for ${stylist?.stylist_name || phone}`);

        // ✅ Emit real-time dashboard update if Socket.IO is available
        if (io) {
          const newPost = {
            phone,
            stylist_name: stylist?.stylist_name,
            salon_name: stylist?.salon_name,
            city: stylist?.city,
            ig_post: igPost,
            fb_post: fbPost,
            x_post: xPost,
          };
          io.emit("new_post", newPost);
          console.log("📢 Emitted new_post event to dashboard");
        }
      }
    }
  );
}