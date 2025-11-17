// db.js — unified synchronous database (Better-SQLite3, ESM-safe)
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Determine file paths safely in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Decide environment
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || "local";

// Default DB path if DB_PATH is not explicitly set
let defaultDbPath;
if (APP_ENV === "production") {
  // On Render (prod), use the persistent disk
  defaultDbPath = "/data/postly.db";
} else {
  // Local dev / other envs: keep DB in project root
  defaultDbPath = path.join(process.cwd(), "postly.db");
}

// Final DB path: env wins, then env-based default
const DB_PATH = process.env.DB_PATH || defaultDbPath;
console.log("🗂 Using database at:", DB_PATH);

// Open SQLite connection
export const db = new Database(DB_PATH, {
  timeout: 10000,
  verbose: null,
});

// Ensure posts.updated_at exists BEFORE any imports that touch posts
try {
  db.prepare("ALTER TABLE posts ADD COLUMN updated_at TEXT").run();
  console.log("🧱 (db.js) ensured posts.updated_at exists");
} catch (e) {
  // ignore if it already exists
}

// =====================================================
// LOAD schema.sql RELIABLY in all environments
// =====================================================

// schema.sql sits in the SAME directory as db.js in Render
// (because Render unpacks your repo directly into /opt/render/project/src/)
const schemaPath = path.join(__dirname, "schema.sql");
console.log("🔍 Looking for schema.sql at:", schemaPath);

try {
  if (fs.existsSync(schemaPath)) {
    const raw = fs.readFileSync(schemaPath, "utf8");
    db.exec(raw); // apply schema
    console.log("✅ schema.sql applied successfully");
  } else {
    console.error("❌ schema.sql NOT FOUND at:", schemaPath);
  }
} catch (e) {
  console.error("❌ Failed applying schema.sql:", e.message);
}

// =====================================================
// Recommended PRAGMAs
// =====================================================
try {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
} catch (e) {
  console.warn("⚠️ Failed to set PRAGMAs:", e.message);
}

// =====================================================
// Minimal legacy bootstrap
// =====================================================
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS manager_tokens (
      token TEXT PRIMARY KEY,
      salon_id TEXT,
      manager_phone TEXT,
      expires_at TEXT
    );
  `).run();
} catch (e) {
  console.error("⚠️ Failed creating manager_tokens:", e.message);
}

// =====================================================
// Helper: verify token 
// =====================================================
export function verifyTokenRow(token) {
  try {
    const row = db.prepare(
      "SELECT token, salon_id, manager_phone, expires_at FROM manager_tokens WHERE token = ?"
    ).get(token);
    console.log("🔍 Verified token readback:", row || "❌ Not found");
    return row;
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    return null;
  }
}

export default db;
