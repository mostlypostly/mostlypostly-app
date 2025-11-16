// src/scheduler.js — MostlyPostly v1.1 (per-salon batching, DB + Analytics Integration)
import fs from "fs";
import path from "path";
import { DateTime } from "luxon";
import { db } from "../db.js";
import { createLogger } from "./utils/logHelper.js";
import { rehostTwilioMedia } from "./utils/rehostTwilioMedia.js";
import { publishToFacebook } from "./publishers/facebook.js";
import { publishToInstagram } from "./publishers/instagram.js";
import { logEvent } from "./core/analyticsDb.js";

const log = createLogger("scheduler");
const ROOT = process.cwd();
const POLICY_FILE = path.join(ROOT, "data", "schedulerPolicy.json");
const FORCE_POST_NOW = process.env.FORCE_POST_NOW === "1";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function withinPostingWindow(now, window) {
  const [sH, sM] = window.start.split(":").map(Number);
  const [eH, eM] = window.end.split(":").map(Number);
  const start = now.set({ hour: sH, minute: sM });
  const end = now.set({ hour: eH, minute: eM });
  return now >= start && now <= end;
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function loadGlobalPolicy() {
  try {
    const json = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
    console.log("🪵 [GlobalPolicy] Loaded from data/schedulerPolicy.json:", json);
    return json;
  } catch {
    const fallback = {
      posting_window: { start: "09:00", end: "19:00" },
      random_delay_minutes: { min: 20, max: 45 },
      timezone: "America/Indiana/Indiana polis",
    };
    console.log("🪵 [GlobalPolicy] Using fallback:", fallback);
    return fallback;
  }
}

// Loads full salon JSON (policy + tokens live here in your structure)
function getSalonPolicy(salonId) {
  try {
    if (!salonId) return {};
    const salonsDir = path.join(ROOT, "salons");
    const normalized = String(salonId).replace(/[^a-z0-9]/gi, "").toLowerCase();
    const files = fs.readdirSync(salonsDir);
    const match = files.find((f) => f.toLowerCase().includes(normalized));
    if (!match) {
      console.warn(`⚠️ [PolicyLoad] No salon config matched '${salonId}'`);
      return {};
    }
    const fullPath = path.join(salonsDir, match);
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    return data;
  } catch (err) {
    console.warn("⚠️ [PolicyLoad] Failed:", salonId, err.message);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 🔁 Recover missed posts
// ─────────────────────────────────────────────────────────────
async function recoverMissedPosts() {
  try {
    const missed = db
      .prepare(`
        SELECT id, stylist_name, salon_id, scheduled_for, status, retry_count
        FROM posts
        WHERE (status='queued' OR status='failed')
          AND scheduled_for IS NOT NULL
          AND strftime('%s', scheduled_for) < strftime('%s','now')
          AND (retry_count IS NULL OR retry_count < 3)
      `)
      .all();

    if (!missed.length) return;
    console.log(`🔁 [Recovery] ${missed.length} post(s) detected.`);

    const now = DateTime.utc();
    for (const post of missed) {
      const salonPolicy = getSalonPolicy(post.salon_id);
      const globalPolicy = loadGlobalPolicy();
      const range =
        salonPolicy.random_delay_minutes ||
        salonPolicy.salon_info?.random_delay_minutes ||
        globalPolicy.random_delay_minutes ||
        { min: 20, max: 45 };

      const delay = randomDelay(range.min, range.max);
      const newTime = now.plus({ minutes: delay }).toISO();

      console.log(
        `🪵 [Recovery] ${post.id} old=${post.scheduled_for} → new=${newTime}`
      );

      db.prepare(
        `
        UPDATE posts
        SET scheduled_for=?, status='queued',
            retry_count=COALESCE(retry_count,0)+1
        WHERE id=?
      `
      ).run(newTime, post.id);

      logEvent({
        event: "scheduler_recovered_post",
        post_id: post.id,
        salon_id: post.salon_id,
        data: { old_time: post.scheduled_for, new_time: newTime },
      });
    }
  } catch (err) {
    console.error("❌ [Recovery] Failed:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// 🚀 Publish due posts (per-salon batching)
// ─────────────────────────────────────────────────────────────
export async function runSchedulerOnce() {
  try {
    // Get salons that currently have due posts
    const tenants = db
      .prepare(`
        SELECT DISTINCT COALESCE(salon_id, '__no_salon__') AS sid
        FROM posts
        WHERE status='queued'
          AND scheduled_for IS NOT NULL
          AND strftime('%s', scheduled_for) <= strftime('%s','now')
      `)
      .all()
      .map((r) => r.sid);

    if (!tenants.length) {
      console.log("✅ [Scheduler] No queued posts due right now.");
      return { ok: true, message: "No queued posts due right now." };
    }

    console.log(`⚡ [Scheduler] Tenants with due posts: ${tenants.join(", ")}`);
    logEvent({ event: "scheduler_run", data: { tenants: tenants.length } });

    const nowUtc = DateTime.utc();

    for (const salonId of tenants) {
      // Pull this salon's due posts in order
      const due = db
        .prepare(`
          SELECT * FROM posts
          WHERE status='queued'
            AND scheduled_for IS NOT NULL
            AND strftime('%s', scheduled_for) <= strftime('%s','now')
            AND COALESCE(salon_id,'__no_salon__') = ?
          ORDER BY datetime(scheduled_for) ASC
        `)
        .all(salonId);

      if (!due.length) continue;

      console.log(
        `🪵 [Scheduler] Processing ${due.length} post(s) for salon_id=${salonId}`
      );

      for (const post of due) {
        console.log("🪵 [Scheduler] ----------------------------");
        console.log("🪵 [Scheduler] Inspecting post:", post);

        // Merge policy (prefer salon, then global)
        const salonPolicy = getSalonPolicy(post.salon_id) || {};
        const globalPolicy = loadGlobalPolicy();

        const window =
          salonPolicy.posting_window ||
          salonPolicy.salon_info?.posting_window ||
          globalPolicy.posting_window ||
          { start: "09:00", end: "19:00" };

        const tz =
          salonPolicy.timezone ||
          salonPolicy.salon_info?.timezone ||
          (post.city?.includes("Indiana")
            ? "America/Indiana/Indianapolis"
            : null) ||
          globalPolicy.timezone ||
          "UTC";

        console.log(
          "🪵 [Scheduler] Merged policy:",
          JSON.stringify({ window, tz }, null, 2)
        );

        const localNow = nowUtc.setZone(tz);
        console.log(
          `🧮 [${post.id}] Local time=${localNow.toFormat("ff")} tz=${tz}`
        );
        console.log(
          `🪟 [${post.id}] Posting window=${window.start}–${window.end}`
        );
        console.log(`🪵 [${post.id}] FORCE_POST_NOW=${FORCE_POST_NOW}`);

        if (!FORCE_POST_NOW && !withinPostingWindow(localNow, window)) {
          console.log(`⏸️ [${post.id}] Outside posting window, delaying 1h.`);
          const retryTime = nowUtc.plus({ hours: 1 }).toISO();
          db.prepare(
            `UPDATE posts SET scheduled_for=?, status='queued' WHERE id=?`
          ).run(retryTime, post.id);

          logEvent({
            event: "scheduler_delay_outside_window",
            salon_id: post.salon_id,
            post_id: post.id,
            data: { retry_for: retryTime, tz },
          });
          continue;
        }

        // publish attempt
        try {
          const image =
            post.image_url && post.image_url.includes("api.twilio.com")
              ? await rehostTwilioMedia(post.image_url, post.salon_id)
              : post.image_url;

          console.log(`🪵 [${post.id}] Image resolved: ${image}`);

          const salonConfig = getSalonPolicy(post.salon_id) || {};
          const fbPageId =
            salonConfig?.salon_info?.facebook_page_id ||
            process.env.FACEBOOK_PAGE_ID ||
            "118354306723";
          const fbToken =
            salonConfig?.salon_info?.facebook_page_token || null;

          logEvent({
            event: "scheduler_attempt_publish",
            salon_id: post.salon_id,
            post_id: post.id,
            data: { fbPageId, image },
          });

          // 🔑 Pass both pageId + salon-specific token into FB publisher
          const fbResp = await publishToFacebook(
            fbPageId,
            post.final_caption,
            image,
            fbToken
          );
          const igResp = await publishToInstagram({
            salon_id: post.salon_id,
            imageUrl: image,
            caption: post.final_caption,
          });

          console.log(
            `🪵 [${post.id}] FB resp=${JSON.stringify(
              fbResp
            )}, IG resp=${JSON.stringify(igResp)}`
          );

          db.prepare(
            `UPDATE posts
               SET status='published',
                   fb_post_id=?, ig_media_id=?,
                   published_at=datetime('now','utc')
             WHERE id=?`
          ).run(fbResp?.post_id || null, igResp?.id || null, post.id);

          console.log(`✅ [${post.id}] Published successfully.`);

          logEvent({
            event: "post_published",
            salon_id: post.salon_id,
            post_id: post.id,
            data: {
              facebook: fbResp || null,
              instagram: igResp || null,
              image_used: image,
              scheduled_for: post.scheduled_for,
            },
          });
        } catch (err) {
          console.error(`❌ [${post.id}] Publish failed:`, err.message);
          const retryTime = nowUtc.plus({ minutes: 30 }).toISO();
          db.prepare(
            `UPDATE posts SET status='queued', scheduled_for=? WHERE id=?`
          ).run(retryTime, post.id);

          logEvent({
            event: "post_publish_failed",
            salon_id: post.salon_id,
            post_id: post.id,
            data: { error: err.message, retry_for: retryTime },
          });

          console.log(`🪵 [${post.id}] Retry scheduled_for=${retryTime}`);
        }
      }
    }

    return { ok: true, message: "Scheduler processed due posts per tenant." };
  } catch (err) {
    console.error("❌ [Scheduler] runSchedulerOnce failed:", err);
    logEvent({ event: "scheduler_error", data: { error: err.message } });
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// ⏱️ Enqueue + loop starter
// ─────────────────────────────────────────────────────────────
export function enqueuePost(post) {
  const policy = loadGlobalPolicy();
  const delay = randomDelay(
    policy.random_delay_minutes.min,
    policy.random_delay_minutes.max
  );
  const scheduled = DateTime.utc()
    .plus({ minutes: delay })
    .toISO({ suppressMilliseconds: true });

  console.log(`🪵 [Enqueue] Post ${post.id} queued for ${scheduled} (UTC)`);

  db.prepare(
    `
    UPDATE posts
    SET status='queued',
        scheduled_for = ?
    WHERE id = ?
  `
  ).run(scheduled, post.id);

  logEvent({
    event: "post_enqueued",
    salon_id: post.salon_id || null,
    post_id: post.id,
    data: { scheduled_for: scheduled },
  });

  console.log(`🕓 [Scheduler] Normalized UTC time stored: ${scheduled}`);

  log("POST_ENQUEUED", {
    id: post.id,
    scheduled_utc: scheduled,
    scheduled_local: DateTime.fromISO(scheduled)
      .setZone("America/Indiana/Indianapolis")
      .toFormat("ff"),
  });

  return { ...post, scheduled_for: scheduled, status: "queued" };
}

export function startScheduler() {
  const policy = loadGlobalPolicy();
  console.log(
    "🪵 [SchedulerInit] Global policy:",
    policy.posting_window,
    policy.timezone
  );

  const salonsDir = path.join(process.cwd(), "salons");
  if (fs.existsSync(salonsDir)) {
    const files = fs.readdirSync(salonsDir).filter((f) => f.endsWith(".json"));
    console.log(
      `🪵 [SchedulerInit] Found ${files.length} salon file(s).`
    );
    for (const f of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(salonsDir, f), "utf8")
        );
        console.log(
          `🪵 [SchedulerInit] ${f}:`,
          data.settings?.posting_window || "(no custom window)"
        );
      } catch (err) {
        console.warn("⚠️ [SchedulerInit] Failed to parse", f, err.message);
      }
    }
  }

  log("SCHEDULER_START", {
    window: policy.posting_window,
    timezone: policy.timezone,
  });
  logEvent({
    event: "scheduler_start",
    data: { window: policy.posting_window, timezone: policy.timezone },
  });

  recoverMissedPosts();
  setInterval(recoverMissedPosts, 15 * 60 * 1000);

  const interval =
    process.env.TEST_INTERVAL === "1" ? 30 * 1000 : 15 * 60 * 1000;
  console.log(`🕓 [Scheduler] Interval active: every ${interval / 1000}s`);
  setInterval(runSchedulerOnce, interval);
}

export { getSalonPolicy };
