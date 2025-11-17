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
  // On Render (prod/staging), use the persistent disk
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

// =====================================================
// 1) Apply schema.sql so base tables exist
// =====================================================
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
// 2) Hotfix migrations – run AFTER schema.sql
//    (safe + idempotent, ignore duplicate-column errors)
// =====================================================

// posts.updated_at
try {
  db.prepare('ALTER TABLE posts ADD COLUMN updated_at TEXT').run();
  console.log("🧱 (db.js) ensured posts.updated_at exists");
} catch (e) {
  // ignore if table/column already exists
}

// managers.email
try {
  db.prepare('ALTER TABLE managers ADD COLUMN email TEXT UNIQUE').run();
  console.log("🧱 (db.js) ensured managers.email exists");
} catch (e) {
  // ignore if table/column already exists
}

// managers.password_hash
try {
  db.prepare('ALTER TABLE managers ADD COLUMN password_hash TEXT').run();
  console.log("🧱 (db.js) ensured managers.password_hash exists");
} catch (e) {
  // ignore if table/column already exists
}

// =====================================================
// 3) Recommended PRAGMAs
// =====================================================
try {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
} catch (e) {
  console.warn("⚠️ Failed to set PRAGMAs:", e.message);
}

// =====================================================
// 4) Minimal legacy bootstrap – manager_tokens
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
