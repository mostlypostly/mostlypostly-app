// src/core/initSchemaHealth.js (SAFE VERSION)
import { db } from "../../db.js";

export function initSchemaHealth() {
  try {
    // ───────────────────────────────────────────────
    // POSTS: ensure required columns exist
    // ───────────────────────────────────────────────
    const requiredPostCols = [
      "salon_id","stylist_id","stylist_name","stylist_phone","service_type",
      "caption","base_caption","final_caption","hashtags","cta","original_notes",
      "image_url","image_mime","rehosted_image_url","instagram_handle",
      "manager_id","manager_phone","manager_chat_id","booking_url","status",
      "denied_reason","platform_targets","fb_post_id","fb_response_id",
      "ig_container_id","ig_media_id","published_at","scheduled_for",
      "retry_count","retry_log",
      "approved_by","approved_at","salon_post_number",
      "_meta","created_at","updated_at"
    ];

    let postCols = [];
    try {
      postCols = db.prepare("PRAGMA table_info(posts)").all();
    } catch (err) {
      console.error("❌ posts table missing:", err.message);
      return; // do NOT crash app
    }

    const havePost = new Set(postCols.map(c => c.name));
    for (const c of requiredPostCols) {
      if (!havePost.has(c)) {
        db.prepare(`ALTER TABLE posts ADD COLUMN ${c} TEXT`).run();
        console.log(`🧩 (posts) added column: ${c}`);
      }
    }

    // ───────────────────────────────────────────────
    // MANAGER TOKENS: ensure required columns
    // ───────────────────────────────────────────────
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

  } catch (err) {
    console.error("❌ initSchemaHealth failed:", err.message);
  }
}
