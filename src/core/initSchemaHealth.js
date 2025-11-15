// src/core/initSchemaHealth.js
import Database from "better-sqlite3";
import path from "path";

export function initSchemaHealth() {
  const DB_PATH = path.join(process.cwd(), "postly.db");
  const db = new Database(DB_PATH);

  // ── posts (existing safeguard)
  const requiredPostCols = [
    "salon_id","stylist_id","stylist_name","stylist_phone","service_type",
    "caption","base_caption","final_caption","hashtags","cta","original_notes",
    "image_url","image_mime","rehosted_image_url","instagram_handle",
    "manager_id","manager_phone","manager_chat_id","booking_url","status",
    "denied_reason","platform_targets","fb_post_id","fb_response_id",
    "ig_container_id","ig_media_id","published_at","_meta",
    "created_at","updated_at"
  ];
  const postCols = db.prepare("PRAGMA table_info(posts)").all();
  const havePost = new Set(postCols.map(c => c.name));
  for (const c of requiredPostCols) {
    if (!havePost.has(c)) {
      db.prepare(`ALTER TABLE posts ADD COLUMN ${c} TEXT`).run();
      console.log(`🧩 (posts) added column: ${c}`);
    }
  }

  // ── manager_tokens (ensure tenant-aware)
  const requiredMgrCols = ["salon_id","manager_id","manager_phone","token","expires_at","created_at"];
  const mgrCols = db.prepare("PRAGMA table_info(manager_tokens)").all();
  const haveMgr = new Set(mgrCols.map(c => c.name));
  for (const c of requiredMgrCols) {
    if (!haveMgr.has(c)) {
      db.prepare(`ALTER TABLE manager_tokens ADD COLUMN ${c} TEXT`).run();
      console.log(`🧩 (manager_tokens) added column: ${c}`);
    }
  }

  console.log("✅ schema health check complete.");
  db.close();
}
