import sqlite3 from "sqlite3";
const db = new sqlite3.Database("./postly.db");

db.serialize(() => {
  db.run("ALTER TABLE posts ADD COLUMN stylist_phone TEXT", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("❌ Failed to add column:", err.message);
    } else {
      console.log("✅ Column 'stylist_phone' added (or already exists).");
    }
  });
});
