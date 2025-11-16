// src/scheduler.js — MostlyPostly Scheduler (Worker Only Execution)

import fs from "fs";
import path from "path";
import { DateTime } from "luxon";
import { db } from "../db.js";
import { createLogger } from "./utils/logHelper.js";
import { rehostTwilioMedia } from "./utils/rehostTwilioMedia.js";
import { publishToFacebook } from "./publishers/facebook.js";
import { publishToInstagram } from "./publishers/instagram.js";
import { logEvent } from "./core/analyticsDb.js";

// ============================================================================
// 🔐 APP_ROLE guard
// ============================================================================
const APP_ROLE = process.env.APP_ROLE || "web";
const isWorker = APP_ROLE === "worker";

const log = createLogger("scheduler");
const ROOT = process.cwd();
const POLICY_FILE = path.join(ROOT, "data", "schedulerPolicy.json");
const FORCE_POST_NOW = process.env.FORCE_POST_NOW === "1";

// ============================================================================
// 🔧 BASE EXPORTS (WEB MODE uses these stubs)
// ============================================================================

let enqueuePost = function (post) {
  console.log(`[SchedulerInit] enqueuePost ignored in web mode`);
  return post;
};

let runSchedulerOnce = async function () {
  console.log(`[SchedulerInit] runSchedulerOnce ignored in web mode`);
  return { ok: false, skipped: true };
};

let startScheduler = function () {
  console.log(`[SchedulerInit] startScheduler ignored in web mode`);
};

export { enqueuePost, runSchedulerOnce, startScheduler };

// ============================================================================
// 🟢 WORKER MODE — replace stubs with real implementations
// ============================================================================
if (isWorker) {
  console.log(`[SchedulerInit] Worker mode enabled — scheduler active.`);

  // ------------------------------
  // UTILITIES
  // ------------------------------
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
      console.log("🪵 [GlobalPolicy] Loaded:", json);
      return json;
    } catch {
      const fallback = {
        posting_window: { start: "09:00", end: "19:00" },
        random_delay_minutes: { min: 20, max: 45 },
        timezone: "America/Indiana/Indianapolis",
      };
      console.log("🪵 [GlobalPolicy] Using fallback:", fallback);
      return fallback;
    }
  }

  function getSalonPolicy(salonId) {
    try {
      if (!salonId) return {};
      const salonsDir = path.join(ROOT, "salons");
      const normalized = salonId.toLowerCase();
      const file = fs
        .readdirSync(salonsDir)
        .find((f) => f.toLowerCase().includes(normalized));
      if (!file) return {};
      return JSON.parse(fs.readFileSync(path.join(salonsDir, file), "utf8"));
    } catch {
      return {};
    }
  }

  // ------------------------------
  // RECOVERY
  // ------------------------------
  async function recoverMissedPosts() {
    try {
      const missed = db.prepare(`
        SELECT id, salon_id, scheduled_for, retry_count
        FROM posts
        WHERE (status='queued' OR status='failed')
          AND scheduled_for IS NOT NULL
          AND strftime('%s', scheduled_for) < strftime('%s','now')
          AND (retry_count IS NULL OR retry_count < 3)
      `).all();

      if (!missed.length) return;

      console.log(`🔁 [Recovery] ${missed.length} missed posts`);

      const now = DateTime.utc();

      for (const post of missed) {
        const policy = getSalonPolicy(post.salon_id);
        const global = loadGlobalPolicy();

        const range =
          policy.random_delay_minutes ||
          policy.salon_info?.random_delay_minutes ||
          global.random_delay_minutes ||
          { min: 20, max: 45 };

        const newTime = now.plus({ minutes: randomDelay(range.min, range.max) }).toISO();

        db.prepare(`
          UPDATE posts
          SET scheduled_for=?, status='queued',
              retry_count=COALESCE(retry_count,0)+1
          WHERE id=?
        `).run(newTime, post.id);

        logEvent({
          event: "scheduler_recovered_post",
          salon_id: post.salon_id,
          post_id: post.id,
          data: { old: post.scheduled_for, new: newTime },
        });
      }
    } catch (err) {
      console.error("❌ Recovery error:", err);
    }
  }

  // ------------------------------
  // MAIN SCHEDULER LOOP
  // ------------------------------
  runSchedulerOnce = async function () {
    const tenants = db
      .prepare(`
        SELECT DISTINCT salon_id AS sid
        FROM posts
        WHERE status='queued'
          AND scheduled_for IS NOT NULL
          AND strftime('%s', scheduled_for) <= strftime('%s','now')
      `)
      .all()
      .map((x) => x.sid);

    if (!tenants.length) {
      console.log("⏳ [Scheduler] Nothing due.");
      return { ok: true };
    }

    console.log(`⚡ [Scheduler] Tenants due: ${tenants.join(", ")}`);

    const nowUtc = DateTime.utc();

    for (const salonId of tenants) {
      const due = db
        .prepare(`
          SELECT *
          FROM posts
          WHERE status='queued'
            AND scheduled_for <= datetime('now')
            AND salon_id = ?
          ORDER BY scheduled_for ASC
        `)
        .all(salonId);

      for (const post of due) {
        const policy = getSalonPolicy(post.salon_id);
        const global = loadGlobalPolicy();

        const window =
          policy.posting_window ||
          policy.salon_info?.posting_window ||
          global.posting_window;

        const tz =
          policy.timezone ||
          policy.salon_info?.timezone ||
          global.timezone ||
          "UTC";

        const localNow = nowUtc.setZone(tz);

        if (!FORCE_POST_NOW && !withinPostingWindow(localNow, window)) {
          const retryAt = nowUtc.plus({ hours: 1 }).toISO();
          db.prepare(`
            UPDATE posts SET scheduled_for=?, status='queued' WHERE id=?
          `).run(retryAt, post.id);
          continue;
        }

        try {
          const image = post.image_url?.includes("twilio")
            ? await rehostTwilioMedia(post.image_url, post.salon_id)
            : post.image_url;

          const cfg = getSalonPolicy(post.salon_id);
          const fbResp = await publishToFacebook(
            cfg?.salon_info?.facebook_page_id,
            post.final_caption,
            image,
            cfg?.salon_info?.facebook_page_token
          );

          const igResp = await publishToInstagram({
            salon_id: post.salon_id,
            caption: post.final_caption,
            imageUrl: image,
          });

          db.prepare(`
            UPDATE posts
            SET status='published',
                fb_post_id=?, ig_media_id=?,
                published_at=datetime('now','utc')
            WHERE id=?
          `).run(fbResp?.post_id, igResp?.id, post.id);
        } catch (err) {
          const retryAt = nowUtc.plus({ minutes: 30 }).toISO();
          db.prepare(`
            UPDATE posts SET status='queued', scheduled_for=? WHERE id=?
          `).run(retryAt, post.id);
        }
      }
    }

    return { ok: true };
  };

  // ------------------------------
  // STARTER — WORKER ONLY
  // ------------------------------
  startScheduler = function () {
    const policy = loadGlobalPolicy();

    log("SCHEDULER_START", {
      window: policy.posting_window,
      timezone: policy.timezone,
    });

    recoverMissedPosts();
    setInterval(recoverMissedPosts, 15 * 60 * 1000);

    const interval =
      process.env.TEST_INTERVAL === "1" ? 30000 : 15 * 60 * 1000;

    console.log(`🕓 [Scheduler] Interval = ${interval / 1000}s`);
    setInterval(runSchedulerOnce, interval);
  };
}
