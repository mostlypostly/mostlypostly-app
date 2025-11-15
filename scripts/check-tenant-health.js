#!/usr/bin/env node
/**
 * MostlyPostly — Tenant Health Check
 * ----------------------------------
 * Runs through all major tables and verifies that every row
 * includes a non-empty salon_id. Logs results to console + log file.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "postly.db");
const LOG_DIR = path.join(process.cwd(), "data", "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "tenant-health.log");

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + "\n");
}

log("🔎 Running tenant health check...");

const db = new Database(DB_PATH);
const tables = [
  "posts",
  "approvals",
  "analytics_events",
  "scheduler_queue",
  "moderation_flags",
  "media_cache",
  "manager_tokens",
];

let totalMissing = 0;
for (const t of tables) {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS missing FROM ${t} WHERE salon_id IS NULL OR TRIM(salon_id)=''`
      )
      .get();
    if (row.missing > 0) {
      log(`⚠️  ${t.padEnd(20)} → missing salon_id: ${row.missing}`);
      totalMissing += row.missing;
    } else {
      log(`✅ ${t.padEnd(20)} → all rows tenant-assigned`);
    }
  } catch (err) {
    log(`❌ Error checking ${t}: ${err.message}`);
  }
}

db.close();

if (totalMissing === 0) {
  log("🎉 Tenant health check complete — all tables clean.\n");
} else {
  log(`⚠️ Tenant check finished with ${totalMissing} missing salon_id entries.\n`);
}
