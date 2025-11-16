// src/scheduler.js — Final Web-Only Scheduler (no worker needed)

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

// ENV flags
const FORCE_POST_NOW = process.env.FORCE_POST_NOW === "1";
const IGNORE_WINDOW = process.env.SCHEDULER_IGNORE_WINDOW === "1";

// ===================== Helpers =====================

function toSqliteTimestamp(dt) {
  return dt.toFormat("yyyy-LL-dd HH:mm:ss");
}

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
    const file = path.join(ROOT, "data", "schedulerPolicy.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log("🪵 [GlobalPolicy] Loaded:", json);
    return json;
  } catch {
    const fallback = {
      posting_window: { start: "09:00", end: "19:00" },
      random_delay_minutes: { min: 20, max: 45 },
      timezone: "America/Indiana/Indianapolis",
    };
    console.log("🪵 [GlobalPolicy] Fallback:", fallback);
    return fallback;
  }
}

function getSalonPolicy(salonId) {
  try {
    if (!salonId) return {};
    const salonsDir = path.join(ROOT, "salons");
    const normalized = String(salonId).toLowerCase();
    const files = fs.readdirSync(salonsDir);
    const file = files.find((f) => f.toLowerCase().includes(normalized));
    if (!file) return {};

    return JSON.parse(fs.readFileSync(path.join(salonsDir, file), "utf8"));
  } catch {
    return {};
  }
}

// ===================== Recovery =====================

async function recoverMissedPosts() {
  try {
    const missed = db
      .prepare(`
        SELECT id, salon_id, scheduled_for, status, retry_count
        FROM posts
        WHERE (status='queued' OR status='failed')
          AND scheduled_for IS NOT NULL
          AND datetime(scheduled_for) < datetime('now')
          AND (retry_count IS NULL OR retry_count < 3)
      `)
      .all();

    if (!missed.length) return;

    console.log(`🔁 [Recovery] ${missed.length} overdue post(s)`);

    const now = DateTime.utc();
    for (const post of missed) {
      const policy = loadGlobalPolicy();
      const range = policy.random_delay_minutes || { min: 20, max: 45 };
      const delay = randomDelay(range.min, range.max);
      const newTime = toSqliteTimestamp(now.plus({ minutes: delay }));

      db.prepare(
        `UPDATE posts
         SET scheduled_for=?, status='queued',
             retry_count = COALESCE(retry_count,0)+1
         WHERE id=?`
      ).run(newTime, post.id);

      logEvent({
        event: "scheduler_recovered_post",
        salon_id: post.salon_id,
        post_id: post.id,
        data: { newTime },
      });
    }
  } catch (err) {
    console.error("❌ [Recovery] Failed:", err);
  }
}

// ===================== Core Run =====================

export async function runSchedulerOnce() {
  try {
    const tenants = db
      .prepare(`
        SELECT DISTINCT salon_id
        FROM posts
        WHERE status='queued'
          AND scheduled_for IS NOT NULL
          AND datetime(scheduled_for) <= datetime('now')
      `)
      .all()
      .map((r) => r.salon_id);

    if (!tenants.length) {
      console.log("✅ [Scheduler] No queued posts due right now.");
      return;
    }

    const nowUtc = DateTime.utc();
    for (const salonId of tenants) {
      const due = db
        .prepare(`
          SELECT * FROM posts
          WHERE status='queued'
            AND scheduled_for IS NOT NULL
            AND datetime(scheduled_for) <= datetime('now')
            AND salon_id = ?
          ORDER BY datetime(scheduled_for) ASC
        `)
        .all(salonId);

      if (!due.length) continue;

      console.log(`⚡ [Scheduler] ${due.length} due for ${salonId}`);

      for (const post of due) {
        const salonPolicy = getSalonPolicy(post.salon_id);
        const globalPolicy = loadGlobalPolicy();

        const window =
          salonPolicy?.posting_window ||
          salonPolicy?.salon_info?.posting_window ||
          globalPolicy.posting_window;

        const tz =
          salonPolicy?.timezone ||
          salonPolicy?.salon_info?.timezone ||
          globalPolicy.timezone;

        const localNow = nowUtc.setZone(tz);

        if (!IGNORE_WINDOW && !FORCE_POST_NOW) {
          if (!withinPostingWindow(localNow, window)) {
            const retry = toSqliteTimestamp(nowUtc.plus({ hours: 1 }));
            console.log(`⏸️ [${post.id}] Outside window → ${retry}`);

            db.prepare(
              `UPDATE posts SET scheduled_for=?, status='queued' WHERE id=?`
            ).run(retry, post.id);
            continue;
          }
        }

        if (IGNORE_WINDOW) {
          console.log("🟢 [Scheduler] Posting window bypassed");
        }

        try {
          const image =
            post.image_url?.includes("api.twilio.com")
              ? await rehostTwilioMedia(post.image_url, post.salon_id)
              : post.image_url;

          const salonCfg = getSalonPolicy(post.salon_id);
          const fbPageId =
            salonCfg?.salon_info?.facebook_page_id ||
            process.env.FACEBOOK_PAGE_ID;
          const fbToken = salonCfg?.salon_info?.facebook_page_token;

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

          db.prepare(
            `UPDATE posts
             SET status='published',
                 fb_post_id=?, ig_media_id=?,
                 published_at=datetime('now','utc')
             WHERE id=?`
          ).run(fbResp?.post_id, igResp?.id, post.id);

          console.log(`✅ [${post.id}] Published`);
        } catch (err) {
          console.error(`❌ [${post.id}] Failed:`, err.message);
          const retry = toSqliteTimestamp(nowUtc.plus({ minutes: 30 }));
          db.prepare(
            `UPDATE posts SET status='queued', scheduled_for=? WHERE id=?`
          ).run(retry, post.id);
        }
      }
    }
  } catch (err) {
    console.error("❌ Scheduler error:", err);
  }
}

// ===================== Enqueue =====================

export function enqueuePost(post) {
  const policy = loadGlobalPolicy();
  const range = policy.random_delay_minutes || { min: 20, max: 45 };
  const delay = randomDelay(range.min, range.max);
  const scheduled = toSqliteTimestamp(DateTime.utc().plus({ minutes: delay }));

  db.prepare(
    `UPDATE posts SET status='queued', scheduled_for=? WHERE id=?`
  ).run(scheduled, post.id);

  console.log(`🪵 [Enqueue] ${post.id} → ${scheduled}`);
  return { ...post, status: "queued", scheduled_for: scheduled };
}

// ===================== Boot =====================

export function startScheduler() {
  const policy = loadGlobalPolicy();

  log("SCHEDULER_START", {
    window: policy.posting_window,
    timezone: policy.timezone,
  });

  recoverMissedPosts();

  const DEFAULT_INTERVAL = 900;
  const intervalSeconds =
    Number(process.env.SCHEDULER_INTERVAL_SECONDS) || DEFAULT_INTERVAL;

  console.log(`🕓 [Scheduler] Interval active: every ${intervalSeconds}s`);

  setInterval(async () => {
    await runSchedulerOnce();
  }, intervalSeconds * 1000);
}

// Required by instagram publisher
export { getSalonPolicy };
