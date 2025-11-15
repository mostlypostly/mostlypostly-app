#!/usr/bin/env node
// scripts/issue-manager-token.js
import path from "path";
import Database from "better-sqlite3";
import { randomBytes } from "crypto";

const DB_PATH = path.join(process.cwd(), "postly.db");
const db = new Database(DB_PATH);

// USAGE:
// node scripts/issue-manager-token.js <salon_id> <manager_phone> [days_valid=7] [host=http://localhost:3000]
const [,, salonId, managerPhone, daysStr = "7", hostArg] = process.argv;

if (!salonId || !managerPhone) {
  console.log("Usage: node scripts/issue-manager-token.js <salon_id> <manager_phone> [days_valid] [host]");
  process.exit(1);
}

const days = parseInt(daysStr, 10) || 7;
const token = randomBytes(24).toString("hex");
const now = new Date();
const expires = new Date(now.getTime() + days*24*60*60*1000);

function iso(d) {
  // SQLite-friendly "YYYY-MM-DD HH:MM:SS"
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,19).replace("T"," ");
}

// Ensure manager_tokens table exists / columns present
db.exec(`
CREATE TABLE IF NOT EXISTS manager_tokens (
  token TEXT PRIMARY KEY,
  salon_id TEXT,
  manager_id TEXT,
  manager_phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mgr_tokens_salon ON manager_tokens(salon_id);
CREATE INDEX IF NOT EXISTS idx_mgr_tokens_phone ON manager_tokens(manager_phone);
`);

// Optional: you can map to a managers table here if you have IDs.
// For now we just store phone for lookup.
db.prepare(`
  INSERT OR REPLACE INTO manager_tokens (token, salon_id, manager_phone, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`).run(token, salonId, managerPhone, iso(now), iso(expires));

const HOST = hostArg || process.env.HOST || `http://localhost:${process.env.PORT || 3000}`;

const url = `${HOST}/manager/login?token=${encodeURIComponent(token)}`;
console.log("✅ Manager token created:");
console.log("- salon_id:", salonId);
console.log("- manager_phone:", managerPhone);
console.log("- expires_at:", iso(expires));
console.log("- login URL:", url);
