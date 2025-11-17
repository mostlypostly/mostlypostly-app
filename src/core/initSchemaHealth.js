// src/core/initSchemaHealth.js (FINAL, STAGING-SAFE)
import { db } from "../../db.js";

export function initSchemaHealth() {
  try {
    // ============================================================
    // 1) POSTS: ensure updated_at ALWAYS exists (priority migration)
    // ============================================================
    try {
      db.prepare(`ALTER TABLE posts ADD COLUMN updated_at TEXT`).run();
      console.log("🧩 (posts) added column: updated_at");
    } catch {
      // ignore duplicate column
    }

    // ============================================================
    // 2) POSTS: ensure ALL required columns exist
    // ============================================================
    const requiredPostCols = [
      "salon_id","stylist_id","stylist_name","stylist_phone","service_type",
      "caption","base_caption","final_caption","hashtags","cta","original_notes",
      "image_url","image_mime","rehosted_image_url","instagram_handle",
      "manager_id","manager_phone","manager_chat_id","booking_url","status",
      "denied_reason","platform_targets","fb_post_id","fb_response_id",
      "ig_container_id","ig_media_id","published_at","scheduled_for",
      "retry_count","retry_log","approved_by","approved_at",
      "salon_post_number","_meta","created_at","updated_at"   // stays here too
    ];

    let postCols = [];
    try {
      postCols = db.prepare("PRAGMA table_info(posts)").all();
    } catch (err) {
      console.error("❌ posts table missing:", err.message);
      return;
    }

    const havePostCols = new Set(postCols.map(c => c.name));

    for (const col of requiredPostCols) {
      if (!havePostCols.has(col)) {
        try {
          db.prepare(`ALTER TABLE posts ADD COLUMN ${col} TEXT`).run();
          console.log(`🧩 (posts) added column: ${col}`);
        } catch {
          // ignore duplicate column errors
        }
      }
    }

    // ============================================================
    // 3) MANAGER TOKENS: ensure core fields exist
    // ============================================================
    const requiredMgrCols = ["salon_id","manager_id","manager_phone","token","expires_at","created_at"];
    let mgrCols = [];

    try {
      mgrCols = db.prepare("PRAGMA table_info(manager_tokens)").all();
    } catch {
      console.error("❌ manager_tokens table missing");
      mgrCols = [];
    }

    const haveMgrCols = new Set(mgrCols.map(c => c.name));

    for (const col of requiredMgrCols) {
      if (!haveMgrCols.has(col)) {
        try {
          db.prepare(`ALTER TABLE manager_tokens ADD COLUMN ${col} TEXT`).run();
          console.log(`🧩 (manager_tokens) added column: ${col}`);
        } catch {
          // ignore
        }
      }
    }

    console.log("✅ schema health check complete.");

  } catch (err) {
    console.error("❌ initSchemaHealth failed:", err.message);
  }
}
