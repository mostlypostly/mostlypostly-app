// db.js — unified synchronous database (Better-SQLite3, ESM-safe)
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

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

// Single connection, synchronous writes
export const db = new Database(DB_PATH, {
  timeout: 10000,
  verbose: null,
});

// Auto-create/verify schema on first run (idempotent)
try {
  const schemaPath = path.join(process.cwd(), "schema.sql");
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema);
    console.log("✅ MostlyPostly schema initialized or verified.");
  } else {
    console.log("ℹ️ schema.sql not found — skipping auto-init.");
  }
} catch (e) {
  console.error("⚠️ Failed to apply schema.sql:", e.message);
}

// Recommended PRAGMAs
try {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
} catch (e) {
  console.warn("⚠️ Failed to set PRAGMAs:", e.message);
}

// Minimal legacy bootstrap (safe if schema already created)
db.prepare(`
  CREATE TABLE IF NOT EXISTS manager_tokens (
    token TEXT PRIMARY KEY,
    salon_id TEXT,
    manager_phone TEXT,
    expires_at TEXT
  )
`).run();

// Helper used by messageRouter.js to confirm token insert visibility
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
