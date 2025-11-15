// src/routes/manager.js — MostlyPostly Manager Portal (styled + actions)
// ESM module

import express from "express";
import cookieParser from "cookie-parser";
import { db } from "../../db.js";
import { enqueuePost } from "../scheduler.js";
import { DateTime } from "luxon";
import { getSalonPolicy } from "../scheduler.js";
import { rehostTwilioMedia } from "../utils/rehostTwilioMedia.js";

const router = express.Router();
function salonNameFromId(salonId) {
  const policy = getSalonPolicy(salonId);
  return policy?.salon_info?.name || policy?.name || salonId;
}

function getSalonName(salon_id) {
  const policy = getSalonPolicy(salon_id);
  return (
    policy?.salon_info?.name ||
    policy?.name ||
    policy?.display_name ||
    salon_id
  );
}


// Ensure cookies + body parsing on this sub-app (in case not added globally)
router.use(cookieParser());
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
function nowISO() {
  return new Date().toISOString();
}

function appHost() {
  return process.env.HOST || "http://localhost:3000";
}

function navBar(current = "manager", salon_id = "", manager_phone = "") {
  const link = (href, label, key) =>
    `<a href="${href}" class="${
      current === key
        ? "text-white bg-blue-600"
        : "text-blue-300 hover:text-white hover:bg-blue-500"
    } px-3 py-1 rounded transition">${label}</a>`;

  const qsSalon = salon_id ? `?salon=${encodeURIComponent(salon_id)}` : "";

  return `
  <header class="bg-black/95 text-blue-300 shadow-md sticky top-0 z-10">
    <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_2px_rgba(59,130,246,0.9)]"></span>
        <a href="${appHost()}/manager" class="font-semibold tracking-wide">MostlyPostly — Manager</a>
      </div>
      <nav class="flex gap-2">
        ${link("/manager", "Manager", "manager")}
        ${link(`/dashboard${qsSalon}`, "Database", "database")}
        ${link(`/analytics${qsSalon}`, "Scheduler Analytics", "scheduler")}
        ${link(`/index.html`, "Policies", "policies")}
        ${link("/manager/logout", "Logout", "logout")}
      </nav>
    </div>
  </header>
  <div class="bg-gradient-to-b from-black via-zinc-950 to-black h-[1px]"></div>
  `;
}

function pageShell({ title, body, salon_id = "", manager_phone = "", current = "manager" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-zinc-100">
  ${navBar(current, salon_id, manager_phone)}
  <main class="max-w-6xl mx-auto px-4 py-6">
    ${body}
  </main>
    <script>
      document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll(".edit-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
          const details = btn.closest("details");
          const form = details.querySelector("[id^='edit-fields-']");
          const cancelPostBtn = details.querySelector("form[action='/manager/cancel']");

          if (form) form.classList.remove("hidden");
          if (cancelPostBtn) cancelPostBtn.classList.add("hidden");
          btn.classList.add("hidden");
        });
      });

      document.querySelectorAll(".cancel-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          const details = btn.closest("details");
          const target = document.getElementById(btn.dataset.target);
          const editBtn = details.querySelector(".edit-toggle");
          const cancelPostBtn = details.querySelector("form[action='/manager/cancel']");

          if (target) target.classList.add("hidden");
          if (editBtn) editBtn.classList.remove("hidden");
          if (cancelPostBtn) cancelPostBtn.classList.remove("hidden");
        });
      });
    });
    </script>
</body>
</html>`;
}

// Try to show a usable image. If you want to actually rehost for display,
// wire in your existing rehoster; here we fall back gracefully.
async function getDisplayImage(url, salon_id = "unknown") {
  if (!url) return "/uploads/sample.jpg";

  try {
    // Already public (uploads/ngrok)
    if (/^https?:\/\/.+(uploads|public)/i.test(url)) return url;

    // Twilio-hosted → rehost it now
    if (/^https:\/\/api\.twilio\.com\//i.test(url)) {
      console.log(`🌐 [Manager] Rehosting Twilio media for dashboard: ${url} [${salon_id}]`);
      const publicUrl = await rehostTwilioMedia(url, salon_id);
      return publicUrl;
    }

    return url;
  } catch (err) {
    console.error("⚠️ getDisplayImage failed:", err.message);
    return "/uploads/sample.jpg";
  }
}



function managerFromRow(row) {
  if (!row) return null;
  return {
    salon_id: row.salon_id || "unknown",
    manager_phone: row.manager_phone || "",
    token: row.token,
  };
}

// ───────────────────────────────────────────────────────────
// Auth middleware
// ───────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────
// Auth middleware (enhanced with manager name + role)
// ───────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.cookies?.mgr_token || req.query?.token;
  if (!token) {
    return res
      .status(401)
      .send(
        pageShell({
          title: "Manager — Not Authenticated",
          body: `<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                   <h1 class="text-xl font-semibold text-blue-400 mb-2">Invalid Session</h1>
                   <p class="text-zinc-300">Missing token. Use the SMS link or ask your system admin to issue a new manager link.</p>
                 </div>`,
        })
      );
  }

  try {
    const row = db
      .prepare(
        `SELECT token, salon_id, manager_phone, expires_at
         FROM manager_tokens
         WHERE token = ?`
      )
      .get(token);

    if (!row) {
      return res
        .status(401)
        .send(
          pageShell({
            title: "Manager — Invalid Token",
            body: `<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                     <h1 class="text-xl font-semibold text-red-400 mb-2">Invalid or expired token</h1>
                     <p class="text-zinc-300">That link is no longer valid. Request a fresh link from MostlyPostly.</p>
                   </div>`,
          })
        );
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res
        .status(401)
        .send(
          pageShell({
            title: "Manager — Token Expired",
            body: `<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                     <h1 class="text-xl font-semibold text-yellow-400 mb-2">Token expired</h1>
                     <p class="text-zinc-300">Please request a new approval link.</p>
                   </div>`,
          })
        );
    }

    // 🔍 Pull manager info from salon file
    const salonPolicy = getSalonPolicy(row.salon_id);
    const foundManager =
      salonPolicy?.managers?.find((m) => m.phone === row.manager_phone) || {};

    // Attach to req
    req.manager = {
      salon_id: row.salon_id,
      manager_phone: row.manager_phone,
      manager_name: foundManager.name || foundManager.manager_name || "Manager",
      manager_role: foundManager.role || "Manager",
      token: row.token,
    };

    // keep cookies fresh
    res.cookie("mgr_token", row.token, {
      httpOnly: false,
      sameSite: "Lax",
      path: "/",
    });
    res.cookie(
      "mgr_info",
      JSON.stringify({
        salon_id: row.salon_id,
        manager_phone: row.manager_phone,
        manager_name: req.manager.manager_name,
      }),
      { httpOnly: false, sameSite: "Lax", path: "/" }
    );

    console.log(
      `✅ [Auth] Logged in manager: ${req.manager.manager_name} (${req.manager.manager_phone})`
    );

    next();
  } catch (err) {
    console.error("❌ manager auth error:", err);
    res.status(500).send("Internal Server Error");
  }
}

// ==========================================================
// 🧹 Manager Logout — clears cookies & redirects
// ==========================================================
router.get("/logout", (req, res) => {
  try {
    // Remove all authentication and tenant cookies
    res.clearCookie("mgr_token", { path: "/" });
    res.clearCookie("mt", { path: "/" });
    res.clearCookie("mgr_info", { path: "/" });

    console.log("👋 Manager logged out successfully.");

    // Redirect to manager landing or login page
    res.redirect("/manager");
  } catch (err) {
    console.error("❌ Logout error:", err);
    res.status(500).send("Logout failed. Please close your browser window.");
  }
});

// ───────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────

// Accept ?mt=... or ?token=... → set cookies, then redirect to /manager
router.get("/login", (req, res) => {
  const raw = (req.query?.mt || req.query?.token || "").trim();
  if (!raw) return res.redirect("/manager?err=missing_token");

  try {
    const row = db
      .prepare(`SELECT token, salon_id, manager_phone, expires_at FROM manager_tokens WHERE token = ?`)
      .get(raw);

    if (!row) return res.redirect("/manager?err=invalid_token");
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.redirect("/manager?err=expired");
    }

    const isProd = process.env.NODE_ENV === "production";

    // ✅ Set both cookies so:
    // - manager route uses mgr_token
    // - dashboard/analytics (and optional tenantFromLink) can use mt
    res.cookie("mgr_token", row.token, {
      httpOnly: false,           // your manager UI reads it client-side
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.cookie("mt", row.token, {
      httpOnly: true,            // not needed in JS, only server-side
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.cookie(
      "mgr_info",
      JSON.stringify({ salon_id: row.salon_id, manager_phone: row.manager_phone }),
      { httpOnly: false, sameSite: "lax", secure: isProd, path: "/", maxAge: 7 * 24 * 60 * 60 * 1000 }
    );

    // Redirect to the manager home (tenant will be inferred automatically)
    return res.redirect("/manager");
  } catch (err) {
    console.error("❌ /manager/login error:", err);
    return res.redirect("/manager?err=server");
  }
});


// Manager dashboard (condensed + editable + local times)
router.get("/", requireAuth, async (req, res) => {
  const salon_id = req.manager?.salon_id || "unknown";
  const manager_phone = req.manager?.manager_phone || "";

  const { DateTime } = await import("luxon");
  const salonPolicy = getSalonPolicy(salon_id);
  const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";

  function fmtLocal(iso) {
    if (!iso) return "";
    try {
      return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("MMM d, yyyy • h:mm a");
    } catch {
      return iso;
    }
  }

  try {
      const pending = db
      .prepare(
        `SELECT id, stylist_name, salon_id, image_url, final_caption, status, created_at, scheduled_for, salon_post_number
        FROM posts
        WHERE salon_id = ? AND status = 'manager_pending'
        ORDER BY datetime(created_at) DESC
        LIMIT 50`
      )
      .all(salon_id);


    const recent = db.prepare(`
      SELECT *
      FROM posts
      WHERE salon_id = ?
        AND status NOT IN ('published')
        AND datetime(created_at) >= datetime('now', '-7 days')
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `).all(salon_id);


    // Renderer
    async function card(post, pendingMode = false) {
      const img = await getDisplayImage(
        post.image_url,
        req.manager?.salon_id || req.salon_id || post.salon_id || "unknown"
      );

      const safeCap = (post.final_caption || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>");

      if (pendingMode) {
        // FULL CARD for pending
        return `
        <article class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-md">
          <div class="grid grid-cols-1 md:grid-cols-3">
            <div class="aspect-square bg-black/60">
              <img src="${img}" class="w-full h-full object-cover" alt="post"/>
            </div>
            <div class="md:col-span-2 p-4">
              <h3 class="text-lg font-semibold text-blue-400">Post #${post.salon_post_number || post.salonPostNumber || post["salon_post_number"] || "—"}</h3>
              <p class="text-sm text-zinc-400 mb-2">Created ${fmtLocal(post.created_at)}</p>
              <div class="prose prose-invert mb-3">${safeCap}</div>
              <div class="flex flex-col md:flex-row gap-3">
                <form method="POST" action="/manager/approve">
                  <input type="hidden" name="post_id" value="${post.id}"/>
                  <input type="hidden" name="action" value="schedule"/>
                  <button class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white">Approve (schedule)</button>
                </form>
                <form method="POST" action="/manager/approve">
                  <input type="hidden" name="post_id" value="${post.id}"/>
                  <input type="hidden" name="action" value="post_now"/>
                  <button class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white">Post now</button>
                </form>
                <form action="/manager/deny" method="POST" class="deny-form max-w-md">
                  <input type="hidden" name="post_id" value="${post.id}"/>
                  <textarea name="reason" placeholder="Reason for denial..." class="block w-full mt-2 text-sm p-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"></textarea>
                  <button type="submit" class="mt-2 px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white">Deny</button>
                </form>
              </div>
            </div>
          </div>
        </article>`;
      }

      // CONDENSED CARD for recent (with Edit toggle)
      const isEditable = !["published", "denied"].includes(post.status);
      return `
      <details class="bg-zinc-900/60 border border-zinc-800 rounded-xl">
        <summary class="cursor-pointer px-4 py-3 flex justify-between items-center">
          <div>
            <span class="text-blue-400 font-semibold">#${post.salon_post_number || "—"} — ${post.stylist_name || "Unknown Stylist"}</span>
            <span class="text-zinc-400 text-sm ml-2">${post.status.toUpperCase()}</span>
          </div>
          <span class="text-xs text-zinc-500">${fmtLocal(post.scheduled_for) || "—"}</span>
        </summary>
        <div class="p-4 border-t border-zinc-800">
          <img src="${img}" class="w-full max-h-64 object-cover rounded mb-3"/>
          <div class="prose prose-invert text-sm mb-3">${safeCap}</div>
          ${
            isEditable
              ? `<div class="flex gap-2">
                  <button type="button" class="edit-toggle px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Edit</button>
                  <form method="POST" action="/manager/cancel">
                    <input type="hidden" name="post_id" value="${post.id}"/>
                    <button class="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-sm">Cancel</button>
                  </form>
                </div>
                <div id="edit-fields-${post.id}" class="hidden mt-3 space-y-2">
                  <form method="POST" action="/manager/edit" class="space-y-2">
                    <input type="hidden" name="post_id" value="${post.id}"/>
                    <label class="text-xs text-zinc-400 block">Caption:</label>
                    <textarea name="final_caption" class="w-full p-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200" rows="3">${post.final_caption || ""}</textarea>
                    <label class="text-xs text-zinc-400 block">Update scheduled time:</label>
                    <input type="datetime-local" name="scheduled_for" class="bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-1 w-64" />
                    <div class="flex gap-2">
                      <button class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm">Save</button>
                      <button type="button" class="cancel-edit px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-sm" data-target="edit-fields-${post.id}">Cancel</button>
                    </div>
                  </form>
                </div>`
              : `<p class="text-xs text-zinc-500 italic">Locked (already published or denied)</p>`
          }
        </div>
      </details>`;

    }

    const pendingCards = await Promise.all(pending.map((row) => card(row, true)));
    const recentCards = await Promise.all(recent.map((row) => card(row, false)));

    const body = `
      <section class="mb-6">
        <h1 class="text-2xl font-bold mb-4">
          Manager Dashboard — <span class="text-blue-400">${getSalonName(salon_id)}</span>
        </h1>

        <p class="text-sm text-gray-500 mb-3">
          Logged in as ${req.manager.manager_name || req.manager.name || "Manager"} (${req.manager.manager_phone || "unknown"})
        </p>

        <!-- 🔵 Connect Facebook / Refresh Token button -->
        <a
          href="/auth/facebook/login?salon=${encodeURIComponent(salon_id)}"
          class="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          Connect / Refresh Facebook
        </a>
      </section>

      <section class="space-y-4">
        <h2 class="text-xl font-semibold text-white/90">Pending Approval</h2>
        ${
          pendingCards.length
            ? `<div class="grid gap-4">${pendingCards.join("")}</div>`
            : `<div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 text-zinc-300">No pending posts.</div>`
        }
      </section>

      <section class="space-y-4 mt-10">
        <h2 class="text-xl font-semibold text-white/90">Recent (Approved / Queued / Published / Failed / Denied)</h2>
        ${
          recentCards.length
            ? `<div class="grid gap-3">${recentCards.join("")}</div>`
            : `<div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 text-zinc-300">No recent posts yet.</div>`
        }
      </section>
    `;

    res.send(pageShell({ title: "Manager Dashboard", body, salon_id, manager_phone, current: "manager" }));
  } catch (err) {
    console.error("❌ /manager error:", err);
    res.status(500).send("Internal Server Error");
  }
});


// Approve (schedule) or Post Now
router.post("/approve", requireAuth, async (req, res) => {
  const { post_id, action } = req.body || {};
  if (!post_id) return res.redirect("/manager?err=missing_post");

  try {
    const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(post_id);
    if (!post) return res.redirect("/manager?err=not_found");
    if (post.salon_id !== req.manager.salon_id) return res.redirect("/manager?err=forbidden");

        if (action === "post_now") {
      // Publish immediately
      db.prepare(`UPDATE posts SET status='queued', scheduled_for=?, approved_at=datetime('now','utc') WHERE id=?`)
        .run(DateTime.utc().toISO(), post_id);

      try {
        await enqueuePost({
          id: post.id,
          image_url: post.image_url,
          final_caption: post.final_caption,
          salon_id: post.salon_id,
          stylist_name: post.stylist_name,
        });
        console.log(`🚀 [Manager] Post ${post_id} queued immediately.`);
      } catch (err) {
        console.error("⚠️ enqueuePost error:", err.message);
      }

    } else if (action === "schedule") {
      // Approve + queue with randomized UTC delay (salon-aware)
      const salonPolicy = getSalonPolicy(post.salon_id);
      const delay = salonPolicy?.random_delay_minutes || { min: 20, max: 45 };
      const randDelay = Math.floor(Math.random() * (delay.max - delay.min + 1)) + delay.min;
      const scheduledUtc = DateTime.utc().plus({ minutes: randDelay }).toISO({ suppressMilliseconds: true });

      db.prepare(`
        UPDATE posts
        SET status='queued',
            approved_by=?,
            approved_at=datetime('now','utc'),
            scheduled_for=?
        WHERE id=?
      `).run(req.manager.manager_phone, scheduledUtc, post_id);

      console.log(`🕓 [Manager] Post ${post_id} approved & queued for ${scheduledUtc} UTC (${randDelay}min delay)`);

    } else {
      // fallback for other future actions
      db.prepare(`UPDATE posts SET status='approved', approved_at=datetime('now','utc') WHERE id=?`).run(post_id);
    }

    return res.redirect("/manager?ok=approved");
  } catch (err) {
    console.error("❌ /manager/approve error:", err);
    return res.redirect("/manager?err=server");
  }
});

// Deny (with reason + notify stylist)
router.post("/deny", requireAuth, async (req, res) => {
  const { post_id, reason } = req.body || {};
  if (!post_id) return res.redirect("/manager?err=missing_post");

  try {
    const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(post_id);
    if (!post) return res.redirect("/manager?err=not_found");
    if (post.salon_id !== req.manager.salon_id) return res.redirect("/manager?err=forbidden");

    db.prepare(
      `UPDATE posts
         SET status='denied',
             approved_by=?,
             approved_at=datetime('now')
       WHERE id=?`
    ).run(req.manager.manager_phone, post_id);

    console.log(`❌ Post ${post_id} denied by ${req.manager.manager_phone}. Reason: ${reason || "none"}`);

    // Notify stylist by SMS (using your Twilio helper if available)
    try {
      const sendMessageMod = await import("../utils/sendMessage.js").catch(() => null);
      const sender = sendMessageMod?.default || sendMessageMod; // handle default export vs named
      const body = `❌ Your post was denied by management.${
        reason ? `\nReason: ${reason}` : ""
      }\n\nPlease edit and resubmit when ready.`;
      if (sender?.sendText && post.phone) await sender.sendText(post.phone, body);
    } catch (err) {
      console.warn("⚠️ Could not send denial SMS:", err.message);
    }

    return res.redirect("/manager?ok=denied");
  } catch (err) {
    console.error("❌ /manager/deny error:", err);
    return res.redirect("/manager?err=server");
  }
});

// Edit (update caption or scheduled time)
router.post("/edit", requireAuth, async (req, res) => {
  try {
    console.log("🧾 [Manager/Edit] Raw body:", req.body);

    const { post_id, final_caption, scheduled_for } = req.body || {};
    if (!post_id) return res.redirect("/manager?err=missing_post");

    const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(post_id);
    if (!post) return res.redirect("/manager?err=not_found");
    if (post.salon_id !== req.manager.salon_id)
      return res.redirect("/manager?err=forbidden");

    const updatedCaption =
      typeof final_caption === "string" && final_caption.trim().length
        ? final_caption.trim()
        : post.final_caption;

    // Normalize scheduled time → UTC
    let updatedTime = post.scheduled_for;
    if (scheduled_for && scheduled_for.trim()) {
      const { DateTime } = await import("luxon");
      const salonPolicy = getSalonPolicy(post.salon_id);
      const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";
      updatedTime = DateTime.fromISO(scheduled_for, { zone: tz })
        .toUTC()
        .toISO({ suppressMilliseconds: true });
    }

    // Determine correct next status
    let newStatus = post.status;
    if (post.status === "approved") newStatus = "queued"; // enqueue old posts
    if (!newStatus) newStatus = "queued";

    console.log("🕓 [Manager/Edit] Final values:", {
      updatedCaption,
      updatedTime,
      newStatus,
    });

    // Perform update
    const result = db
      .prepare(
        `UPDATE posts
         SET final_caption = ?,
             scheduled_for = ?,
             status = ?,
             updated_at = datetime('now','utc')
         WHERE id = ?`
      )
      .run(updatedCaption, updatedTime, newStatus, post_id);

    console.log("💾 [Manager/Edit] DB result:", result);

    const verify = db
      .prepare(
        `SELECT id, final_caption, scheduled_for, status
         FROM posts WHERE id = ?`
      )
      .get(post_id);
    console.log("🔍 [Manager/Edit] Post after update:", verify);

    return res.redirect("/manager?ok=edited");
  } catch (err) {
    console.error("❌ [Manager/Edit] Error:", err);
    return res.redirect("/manager?err=server");
  }
});


// Cancel (remove from queue)
router.post("/cancel", requireAuth, async (req, res) => {
  const { post_id } = req.body || {};
  if (!post_id) return res.redirect("/manager?err=missing_post");

  try {
    const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(post_id);
    if (!post) return res.redirect("/manager?err=not_found");
    if (post.salon_id !== req.manager.salon_id) return res.redirect("/manager?err=forbidden");

    db.prepare(
      `UPDATE posts
       SET status='cancelled', updated_at=datetime('now','utc')
       WHERE id=?`
    ).run(post_id);

    console.log(`🛑 Post ${post_id} cancelled by ${req.manager.manager_phone}.`);
    return res.redirect("/manager?ok=cancelled");
  } catch (err) {
    console.error("❌ /manager/cancel error:", err);
    return res.redirect("/manager?err=server");
  }
});

export default router;
