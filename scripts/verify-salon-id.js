#!/usr/bin/env node
import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "postly.db"));
const tables = [
  "posts","approvals","analytics_events","scheduler_queue",
  "moderation_flags","media_cache","manager_tokens"
];

for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS missing FROM ${t} WHERE salon_id IS NULL OR TRIM(salon_id)=''`).get();
  console.log(`${t.padEnd(20)} → missing salon_id: ${row.missing}`);
}
db.close();
