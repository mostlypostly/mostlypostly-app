#!/usr/bin/env node
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "postly.db");
const db = new Database(DB_PATH);

const result = db.prepare(`
  DELETE FROM manager_tokens WHERE expires_at < datetime('now')
`).run();

console.log(`🧹 Deleted ${result.changes} expired manager tokens.`);
db.close();
