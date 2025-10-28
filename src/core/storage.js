// ======================================================
// 📦 storage.js — MostlyPostly v0.5 + Consent Persistence
// JSON-based persistence layer for posts + approval states
// ======================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";

// -----------------------------
// Paths
// -----------------------------
const DATA_DIR = path.resolve("./data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const SALONS_DIR = process.env.SALONS_DIR || path.resolve("./salons");

// Ensure data + salons exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, "[]", "utf8");
if (!fs.existsSync(SALONS_DIR)) fs.mkdirSync(SALONS_DIR, { recursive: true });

// ======================================================
// 🔄 Helpers — Load / Save posts.json
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
// 💾 Save a new post (draft / pending / etc.)
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

  const bookingUrl =
    stylist.booking_url ||
    stylist?.salon_info?.booking_url ||
    salon?.salon_info?.booking_url ||
    null;

  const newPost = {
    id: crypto.randomUUID(),
    salon: stylist.salon_name || salon?.salon_info?.salon_name || "Unknown Salon",
    stylist_name: stylist.stylist_name || "Unknown Stylist",
    stylist_phone: String(chatId),
    service_type: stylist.service_type || null,

    // ✅ Persist text data
    caption: stylist.caption || caption || "",
    hashtags: Array.isArray(hashtags) ? hashtags : [],
    cta: stylist.cta || "Book your next visit today!",
    final_caption: stylist.final_caption || caption || "",

    image_url: stylist.image_url || null,
    instagram_handle: stylist.instagram_handle || stylist.instagramHandle || null,
    manager_phone: stylist.manager_phone ? String(stylist.manager_phone) : null,
    manager_chat_id: stylist.manager_chat_id ? String(stylist.manager_chat_id) : null,
    booking_url: bookingUrl,

    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    denied_reason: null
  };

  posts.push(newPost);
  saveAllPosts(posts);

  if (io) io.emit("post:new", newPost);
  console.log(`✅ Post saved for ${newPost.stylist_name} (${newPost.status})`);
  return newPost;
}

// ======================================================
// 🧩 Update post status + merge extra data
// ======================================================
export function updatePostStatus(id, status, reasonOrExtra = null) {
  const posts = loadAllPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) {
    console.warn(`⚠️ updatePostStatus: Post ${id} not found.`);
    return null;
  }

  posts[idx].status = status;
  posts[idx].updated_at = new Date().toISOString();

  if (typeof reasonOrExtra === "string") {
    posts[idx].denied_reason = reasonOrExtra;
  } else if (reasonOrExtra && typeof reasonOrExtra === "object") {
    posts[idx] = { ...posts[idx], ...reasonOrExtra };
  }

  saveAllPosts(posts);
  const updated = loadAllPosts().find((p) => p.id === id);

  if (!updated?.final_caption) {
    console.warn(`⚠️ final_caption missing after update for post ${id}`);
  } else {
    console.log(
      `💾 Post ${id} persisted with final_caption:`,
      updated.final_caption.slice(0, 80)
    );
  }

  return updated;
}

// ======================================================
// 🔍 Find pending post awaiting manager approval
// ======================================================
export function findPendingPostByManager(managerIdentifier) {
  const posts = loadAllPosts();
  const idStr = String(managerIdentifier).trim();

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

  const newest = matches.sort(
    (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
  )[0];

  console.log(
    `🔍 Found ${matches.length} pending post(s) for manager ${idStr}. Using newest ${newest.id}.`
  );
  console.log(
    `   ↳ Caption check: ${newest.final_caption ? "✅ present" : "❌ MISSING"}, created_at=${newest.created_at}`
  );

  return newest;
}

// ======================================================
// 📝 Find post awaiting denial reason
// ======================================================
export function findPostAwaitingReason(managerIdentifier) {
  const posts = loadAllPosts();
  const idStr = String(managerIdentifier).trim();

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
// 🧾 Find latest draft by stylist
// ======================================================
export function findLatestDraft(stylistIdentifier) {
  const idStr = String(stylistIdentifier).trim();

  const posts = loadAllPosts()
    .filter(
      (p) => String(p.stylist_phone).trim() === idStr && p.status === "draft"
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return posts[0] || null;
}

// ======================================================
// 🏢 Salon + Stylist lookup utilities (file-based)
//  - Supports stylists stored as an object map or an array
// ======================================================
function readSalonJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listSalonFiles() {
  return fs.readdirSync(SALONS_DIR).filter((f) => f.endsWith(".json"));
}

/**
 * Find stylist in a salon JSON that uses either:
 *  - map form: stylists[chat_id] = {...}
 *  - array form: stylists = [ {..., chat_id}, ... ]
 * Returns { stylist, stylistKeyOrIndex, form: 'map'|'array' } or null.
 */
function findStylistInJson(json, chatKey) {
  const s = json.stylists;

  if (!s) return null;

  // Map form
  if (!Array.isArray(s)) {
    if (Object.prototype.hasOwnProperty.call(s, chatKey)) {
      return { stylist: s[chatKey], stylistKeyOrIndex: chatKey, form: "map" };
    }
    // Sometimes keyed by phone
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
  if (Array.isArray(s)) {
    const idx = s.findIndex(
      (v) =>
        String(v?.chat_id || "").trim() === chatKey ||
        String(v?.phone || "").trim() === chatKey
    );
    if (idx !== -1) {
      return { stylist: s[idx], stylistKeyOrIndex: idx, form: "array" };
    }
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
          json.salon_info?.salon_name
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
            stylist.salon_name || json.salon_info?.salon_name || "Unknown Salon",
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
// ✅ NEW: Persist stylist consent into salons/<file>.json
//  - Works for both map-form and array-form stylists
//  - payload example:
//    {
//      compliance_opt_in: true,
//      compliance_timestamp: "2025-10-19T12:34:56Z",
//      consent: { sms_opt_in: true, timestamp: "..." }
//    }
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

    // --- 1️⃣ Try stylist match first
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

    // --- 2️⃣ Try manager match (new)
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

  // --- 3️⃣ If no stylist or manager match found
  return { ok: false, error: "Stylist not found in salons/*.json" };
}
