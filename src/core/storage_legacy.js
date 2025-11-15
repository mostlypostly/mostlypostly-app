// ======================================================
// 📦 storage.js — MostlyPostly v1 (DB-first with JSON mirror)
// - Writes to SQLite (primary) and mirrors to data/posts.json (backup)
// - Keeps legacy salon/consent helpers intact
// ======================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../../db.js"; // NOTE: storage.js is in src/core, db.js is project root

// -----------------------------
// Paths (JSON mirror)
// -----------------------------
const DATA_DIR = path.resolve("./data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const SALONS_DIR = process.env.SALONS_DIR || path.resolve("./salons");

// Ensure data + salons exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, "[]", "utf8");
if (!fs.existsSync(SALONS_DIR)) fs.mkdirSync(SALONS_DIR, { recursive: true });

// ======================================================
// 🔄 JSON mirror helpers
// ======================================================
function loadAllPosts() {
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
  } catch (err) {
    console.error("⚠️ Failed to load posts.json:", err);
    return [];
  }
}

function saveAllPosts(posts) {
  try {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), "utf8");
  } catch (err) {
    console.error("⚠️ Failed to write posts.json:", err);
  }
}

// ======================================================
// 🧱 DB helpers (safe, idempotent)
// ======================================================
const insertPostStmt = db.prepare(`
  INSERT INTO posts (
    id,
    salon_id,
    stylist_id,
    stylist_name,
    stylist_phone,
    service_type,
    caption,
    base_caption,
    final_caption,
    hashtags,
    cta,
    original_notes,
    image_url,
    image_mime,
    rehosted_image_url,
    instagram_handle,
    manager_id,
    manager_phone,
    manager_chat_id,
    booking_url,
    status,
    denied_reason,
    platform_targets,
    fb_post_id,
    fb_response_id,
    ig_container_id,
    ig_media_id,
    published_at,
    _meta,
    created_at,
    updated_at
  )
  VALUES (
    @id,
    @salon_id,
    @stylist_id,
    @stylist_name,
    @stylist_phone,
    @service_type,
    @caption,
    @base_caption,
    @final_caption,
    @hashtags,
    @cta,
    @original_notes,
    @image_url,
    @image_mime,
    @rehosted_image_url,
    @instagram_handle,
    @manager_id,
    @manager_phone,
    @manager_chat_id,
    @booking_url,
    @status,
    @denied_reason,
    @platform_targets,
    @fb_post_id,
    @fb_response_id,
    @ig_container_id,
    @ig_media_id,
    @published_at,
    @_meta,
    @created_at,
    @updated_at
  )
`);

function buildDynamicUpdate(table, id, patch = {}) {
  // Build a dynamic UPDATE ... SET ... WHERE id=?
  const allowed = [
    "stylist_name", "stylist_phone", "service_type",
    "caption", "base_caption", "final_caption", "hashtags",
    "cta", "original_notes", "image_url", "image_mime",
    "rehosted_image_url", "instagram_handle",
    "manager_id", "manager_phone", "manager_chat_id",
    "booking_url", "status", "denied_reason",
    "platform_targets", "fb_post_id", "fb_response_id",
    "ig_container_id", "ig_media_id", "published_at", "_meta"
  ];

  const sets = [];
  const params = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = patch[key];
    }
  }
  sets.push(`updated_at = datetime('now')`);

  const sql = `UPDATE ${table} SET ${sets.join(", ")} WHERE id = @id`;
  const stmt = db.prepare(sql);
  return (extra = {}) => stmt.run({ id, ...params, ...extra });
}

// ======================================================
// 💾 Save a new post (DB + JSON mirror)
// ======================================================
export function savePost(
  chatId,
  stylist,
  caption,
  hashtags = [],
  status = "draft",
  io = null,
  salon = null
) {
  const posts = loadAllPosts();

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const bookingUrl =
    stylist.booking_url ||
    stylist?.salon_info?.booking_url ||
    salon?.salon_info?.booking_url ||
    null;

  // Normalize hashtags to JSON string for DB, array for JSON mirror
  const tagsArr = Array.isArray(hashtags) ? hashtags : [];
  const tagsJson = JSON.stringify(tagsArr);

  // Unified fields
  const payload = {
    id,
    salon_id: salon?.salon_id || salon?.id || salon?.salon_info?.id || "unknown",
    stylist_id: null,
    stylist_name: stylist.stylist_name || stylist.name || "Unknown Stylist",
    stylist_phone: String(chatId),

    service_type: stylist.service_type || null,
    caption: stylist.caption || caption || "",
    base_caption: stylist.base_caption || caption || "",
    final_caption: stylist.final_caption || caption || "",
    hashtags: tagsJson,
    cta: stylist.cta || "Book your next visit today!",
    original_notes: stylist.original_notes || "",

    image_url: stylist.image_url || null,
    image_mime: null,
    rehosted_image_url: null,
    instagram_handle: stylist.instagram_handle || stylist.instagramHandle || null,

    manager_id: null,
    manager_phone: stylist.manager_phone ? String(stylist.manager_phone) : null,
    manager_chat_id: stylist.manager_chat_id ? String(stylist.manager_chat_id) : null,
    booking_url: bookingUrl,

    status,
    denied_reason: null,
    platform_targets: JSON.stringify(stylist.platform_targets || null),
    fb_post_id: null,
    fb_response_id: null,
    ig_container_id: null,
    ig_media_id: null,
    published_at: null,
    _meta: JSON.stringify(stylist._meta || null),

    created_at: now,
    updated_at: now,
  };

  // 1) Write to DB
  try {
    insertPostStmt.run(payload);
  } catch (err) {
    console.error("❌ DB insert failed (posts):", err.message);
  }

  // 2) Mirror to JSON (for backup/legacy)
  const newPostMirror = {
    id,
    salon: stylist.salon_name || salon?.salon_info?.salon_name || "Unknown Salon",
    stylist_name: payload.stylist_name,
    stylist_phone: payload.stylist_phone,
    service_type: payload.service_type,
    caption: payload.caption,
    base_caption: payload.base_caption,
    final_caption: payload.final_caption,
    hashtags: tagsArr,
    cta: payload.cta,
    image_url: payload.image_url,
    instagram_handle: payload.instagram_handle,
    manager_phone: payload.manager_phone,
    manager_chat_id: payload.manager_chat_id,
    booking_url: payload.booking_url,
    status: payload.status,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
    denied_reason: null
  };

  posts.push(newPostMirror);
  saveAllPosts(posts);

  if (io) io.emit("post:new", newPostMirror);
  console.log(`✅ Post saved to DB & JSON for ${payload.stylist_name} (${payload.status})`);
  return newPostMirror;
}

// ======================================================
// 🧩 Update post status + merge extra (DB first, then JSON)
// ======================================================
export function updatePostStatus(id, status, reasonOrExtra = null) {
  // Prepare patch
  const patch = { status };
  if (typeof reasonOrExtra === "string") {
    patch.denied_reason = reasonOrExtra;
  } else if (reasonOrExtra && typeof reasonOrExtra === "object") {
    // Normalize arrays/objects for DB
    if (Array.isArray(reasonOrExtra.hashtags)) {
      patch.hashtags = JSON.stringify(reasonOrExtra.hashtags);
    }
    for (const k of [
      "final_caption", "caption", "image_url", "instagram_handle",
      "booking_url", "manager_phone", "manager_chat_id", "fb_post_id",
      "ig_container_id", "ig_media_id", "published_at", "platform_targets", "_meta"
    ]) {
      if (reasonOrExtra[k] !== undefined) {
        patch[k] = typeof reasonOrExtra[k] === "object" && reasonOrExtra[k] !== null
          ? JSON.stringify(reasonOrExtra[k])
          : reasonOrExtra[k];
      }
    }
  }

  // 1) DB update
  try {
    const run = buildDynamicUpdate("posts", id, patch);
    run();
  } catch (err) {
    console.error("❌ DB update failed (posts):", err.message);
  }

  // 2) JSON mirror update
  const posts = loadAllPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx !== -1) {
    posts[idx].status = status;
    posts[idx].updated_at = new Date().toISOString();
    if (typeof reasonOrExtra === "string") {
      posts[idx].denied_reason = reasonOrExtra;
    } else if (reasonOrExtra && typeof reasonOrExtra === "object") {
      posts[idx] = {
        ...posts[idx],
        ...reasonOrExtra,
        // keep hashtags array in JSON
        ...(Array.isArray(reasonOrExtra.hashtags)
          ? { hashtags: reasonOrExtra.hashtags }
          : {}),
      };
    }
    saveAllPosts(posts);
  } else {
    console.warn(`⚠️ updatePostStatus: Post ${id} not found in JSON mirror (DB was updated).`);
  }

  // Return a merged view from DB (best-effort)
  try {
    const row = db.prepare(`
      SELECT id, stylist_name, stylist_phone, status, final_caption, denied_reason, created_at, updated_at
      FROM posts WHERE id = ?
    `).get(id);
    return row || null;
  } catch {
    return null;
  }
}

// ======================================================
// 🔍 Find pending post awaiting manager approval (DB first)
// ======================================================
export function findPendingPostByManager(managerIdentifier) {
  const idStr = String(managerIdentifier).trim();

  try {
    const row = db.prepare(`
      SELECT *
      FROM posts
      WHERE status='manager_pending'
        AND (manager_phone = ? OR manager_chat_id = ?)
      ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
      LIMIT 1
    `).get(idStr, idStr);

    if (row) return row;
  } catch (err) {
    console.warn("⚠️ DB lookup (manager_pending) failed:", err.message);
  }

  // Fallback to JSON
  const posts = loadAllPosts();
  const matches = posts.filter(
    (p) =>
      p.status === "manager_pending" &&
      (String(p.manager_phone).trim() === idStr ||
        String(p.manager_chat_id).trim() === idStr)
  );
  if (!matches.length) {
    console.log("⚠️ No pending post found for manager:", idStr);
    return null;
  }
  return matches.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
}

// ======================================================
// 📝 Find post awaiting denial reason (DB first)
// ======================================================
export function findPostAwaitingReason(managerIdentifier) {
  const idStr = String(managerIdentifier).trim();

  try {
    const row = db.prepare(`
      SELECT *
      FROM posts
      WHERE status='awaiting_reason'
        AND (manager_phone = ? OR manager_chat_id = ?)
      ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
      LIMIT 1
    `).get(idStr, idStr);

    if (row) return row;
  } catch (err) {
    console.warn("⚠️ DB lookup (awaiting_reason) failed:", err.message);
  }

  // Fallback to JSON
  const posts = loadAllPosts();
  const match = posts.find(
    (p) =>
      p.status === "awaiting_reason" &&
      (String(p.manager_phone).trim() === idStr ||
        String(p.manager_chat_id).trim() === idStr)
  );
  if (match) console.log("📝 Found post awaiting denial reason for:", idStr);
  return match || null;
}

// ======================================================
// 🧾 Find latest draft by stylist (DB first)
// ======================================================
export function findLatestDraft(stylistIdentifier) {
  const idStr = String(stylistIdentifier).trim();

  try {
    const row = db.prepare(`
      SELECT *
      FROM posts
      WHERE status='draft' AND stylist_phone = ?
      ORDER BY datetime(COALESCE(created_at, updated_at)) DESC
      LIMIT 1
    `).get(idStr);

    if (row) return row;
  } catch (err) {
    console.warn("⚠️ DB lookup (latest draft) failed:", err.message);
  }

  // Fallback to JSON mirror
  const posts = loadAllPosts()
    .filter(
      (p) => String(p.stylist_phone).trim() === idStr && p.status === "draft"
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return posts[0] || null;
}

// ======================================================
// 🏢 Salon + Stylist lookup utilities (file-based; unchanged)
// ======================================================
function readSalonJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function listSalonFiles() {
  return fs.readdirSync(SALONS_DIR).filter((f) => f.endsWith(".json"));
}

/**
 * Find stylist in salon JSON (supports map or array forms)
 * Returns { stylist, stylistKeyOrIndex, form } or null.
 */
function findStylistInJson(json, chatKey) {
  const s = json.stylists;
  if (!s) return null;

  // Map form
  if (!Array.isArray(s)) {
    if (Object.prototype.hasOwnProperty.call(s, chatKey)) {
      return { stylist: s[chatKey], stylistKeyOrIndex: chatKey, form: "map" };
    }
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (
        String(v?.chat_id || "").trim() === chatKey ||
        String(v?.phone || "").trim() === chatKey
      ) {
        return { stylist: v, stylistKeyOrIndex: k, form: "map" };
      }
    }
    return null;
  }

  // Array form
  const idx = s.findIndex(
    (v) =>
      String(v?.chat_id || "").trim() === chatKey ||
      String(v?.phone || "").trim() === chatKey
  );
  if (idx !== -1) {
    return { stylist: s[idx], stylistKeyOrIndex: idx, form: "array" };
  }
  return null;
}

export function getSalonByStylist(chatId) {
  try {
    const chatKey = String(chatId).trim();
    const files = listSalonFiles();

    for (const file of files) {
      const json = readSalonJson(path.join(SALONS_DIR, file));
      const found = findStylistInJson(json, chatKey);
      if (found) {
        console.log(
          `🏢 Salon match found for ${chatKey}:`,
          json.salon_info?.salon_name || json.salon_info?.name
        );
        return json;
      }
    }
    console.warn("⚠️ No salon match found for chatId:", chatId);
    return null;
  } catch (err) {
    console.error("⚠️ Error loading salon by stylist:", err);
    return null;
  }
}

export function lookupStylist(chatId) {
  try {
    const chatKey = String(chatId).trim();
    const files = listSalonFiles();

    for (const file of files) {
      const json = readSalonJson(path.join(SALONS_DIR, file));
      const found = findStylistInJson(json, chatKey);
      if (found) {
        const stylist = found.stylist || {};
        return {
          ...stylist,
          salon_name:
            stylist.salon_name || json.salon_info?.salon_name || json.salon_info?.name || "Unknown Salon",
          city: json.salon_info?.city || "Unknown City",
          salon_info: json.salon_info,
        };
      }
    }
    return null;
  } catch (err) {
    console.error("⚠️ lookupStylist() error:", err);
    return null;
  }
}

// ======================================================
// ✅ Persist stylist consent into salons/<file>.json (unchanged)
// ======================================================
export function saveStylistConsent(chatIdOrPhone, payload = {}) {
  const key = String(chatIdOrPhone).trim();
  const files = listSalonFiles();

  for (const file of files) {
    const filePath = path.join(SALONS_DIR, file);
    let json;
    try {
      json = readSalonJson(filePath);
    } catch (e) {
      console.warn(`⚠️ Could not parse ${filePath}: ${e.message}`);
      continue;
    }

    // 1) Try stylist match
    const found = findStylistInJson(json, key);
    if (found) {
      const { stylist, stylistKeyOrIndex, form } = found;
      const merged = {
        ...stylist,
        compliance_opt_in:
          typeof payload.compliance_opt_in === "boolean"
            ? payload.compliance_opt_in
            : stylist.compliance_opt_in || false,
        compliance_timestamp:
          payload.compliance_timestamp || stylist.compliance_timestamp || "",
        consent: {
          ...(stylist.consent || {}),
          ...(payload.consent || {}),
        },
      };

      if (form === "map") {
        json.stylists[stylistKeyOrIndex] = merged;
      } else {
        json.stylists[stylistKeyOrIndex] = merged;
      }

      try {
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf8");
        console.log(
          `💾 Consent saved for stylist "${merged.stylist_name || merged.name || merged.id || "Unknown"}" in ${path.basename(filePath)}`
        );
        return {
          ok: true,
          file: filePath,
          stylist_name: merged.stylist_name || merged.name || "",
          updated: {
            compliance_opt_in: merged.compliance_opt_in,
            compliance_timestamp: merged.compliance_timestamp,
            consent: merged.consent,
          },
        };
      } catch (e) {
        return { ok: false, error: `Failed to write ${filePath}: ${e.message}` };
      }
    }

    // 2) Try manager match
    const managers = json.managers || [];
    const manager = managers.find(
      (m) =>
        String(m.chat_id || "").trim() === key ||
        String(m.phone || "").trim() === key
    );
    if (manager) {
      manager.compliance_opt_in =
        typeof payload.compliance_opt_in === "boolean"
          ? payload.compliance_opt_in
          : manager.compliance_opt_in || false;
      manager.compliance_timestamp =
        payload.compliance_timestamp || manager.compliance_timestamp || "";
      manager.consent = {
        ...(manager.consent || {}),
        ...(payload.consent || {}),
      };

      try {
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf8");
        console.log(
          `💾 Consent saved for manager "${manager.name || manager.id || "Unknown"}" in ${path.basename(filePath)}`
        );
        return {
          ok: true,
          file: filePath,
          stylist_name: manager.name || "",
          updated: {
            compliance_opt_in: manager.compliance_opt_in,
            compliance_timestamp: manager.compliance_timestamp,
            consent: manager.consent,
          },
        };
      } catch (e) {
        return { ok: false, error: `Failed to write ${filePath}: ${e.message}` };
      }
    }
  }

  // No match
  return { ok: false, error: "Stylist not found in salons/*.json" };
}
