// src/core/dbMigrations.js
import { db } from "../../db.js";

export function runMigrations() {
  const migrations = [
    `ALTER TABLE posts ADD COLUMN updated_at TEXT`,
    `ALTER TABLE managers ADD COLUMN email TEXT UNIQUE`,
    `ALTER TABLE managers ADD COLUMN password_hash TEXT`,
    `ALTER TABLE moderation_flags ADD COLUMN status TEXT`,
  ];

  for (const sql of migrations) {
    try {
      db.prepare(sql).run();
      console.log(`🛠 Applied migration: ${sql}`);
    } catch {
      // ignore "duplicate column" errors
    }
  }
}
