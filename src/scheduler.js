// src/scheduler.js — MostlyPostly v0.5+ Scheduler Engine
// Purpose: schedule and simulate queued posts based on schedulerPolicy.json
// Adds: posts.log persistence, analytics hooks, faster test config toggle

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createLogger } from "./utils/logHelper.js";

const log = createLogger("scheduler");

// Paths
const ROOT = process.cwd();
const POLICY_FILE = path.join(ROOT, "data", "schedulerPolicy.json");
const POSTS_LOG = path.join(ROOT, "logs", "posts.log");
const QUEUE_FILE = path.join(ROOT, "logs", "queue.json");

// ======================================================
// 🧠 Load Scheduler Policy
// ======================================================
function loadPolicy() {
  try {
    const data = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
    return data;
  } catch (err) {
    log("POLICY_LOAD_FAIL", { err: err.message });
    return {
      posting_window: { start: "09:00", end: "19:00" },
      story_window: { start: "08:00", end: "21:00" },
      random_delay_minutes: { min: 20, max: 45 },
      timezone: "UTC",
    };
  }
}

// ======================================================
// 📂 Queue Helpers
// ======================================================
function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    log("QUEUE_READ_FAIL", { err: err.message });
    return [];
  }
}

function writeQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (err) {
    log("QUEUE_WRITE_FAIL", { err: err.message });
  }
}

// ======================================================
// ⏰ Window + Delay
// ======================================================
function withinPostingWindow(now, window) {
  const [startH, startM] = window.start.split(":").map(Number);
  const [endH, endM] = window.end.split(":").map(Number);
  const start = new Date(now);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(now);
  end.setHours(endH, endM, 0, 0);
  return now >= start && now <= end;
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ======================================================
// 📅 Find Next Slot
// ======================================================
function findNextSlot(policy, platform) {
  const now = new Date();
  const window =
    platform === "instagram_stories"
      ? policy.story_window
      : policy.posting_window;

  const delayMinutes = randomDelay(
    policy.random_delay_minutes.min,
    policy.random_delay_minutes.max
  );
  let candidate = new Date(now.getTime() + delayMinutes * 60 * 1000);

  // If candidate outside allowed window, push to next day start
  if (!withinPostingWindow(candidate, window)) {
    const next = new Date(now);
    const [h, m] = window.start.split(":").map(Number);
    next.setDate(now.getDate() + 1);
    next.setHours(h, m, 0, 0);
    candidate = next;
  }

  return candidate;
}

// ======================================================
// ➕ Enqueue Post
// ======================================================
export function enqueuePost(post) {
  const policy = loadPolicy();
  const queue = readQueue();
  const platform = post.platform || "instagram_feed";

  const scheduledAt = findNextSlot(policy, platform);
  const entry = {
    ...post,
    id: post.id || crypto.randomUUID(),
    status: "queued",
    scheduled_at: scheduledAt.toISOString(),
  };

  queue.push(entry);
  writeQueue(queue);

  log("POST_ENQUEUED", {
    id: entry.id,
    salon: post.salon_id,
    stylist: post.stylist,
    type: post.type,
    platform,
    scheduled_at: entry.scheduled_at,
  });
}

// ======================================================
// 🚀 Scheduler Loop
// ======================================================
export function startScheduler() {
  const policy = loadPolicy();
  log("SCHEDULER_START", {
    window: policy.posting_window,
    timezone: policy.timezone,
  });

  // ⚙️ Adjustable interval: use TEST_INTERVAL=1 to shorten for dev
  const interval =
    process.env.TEST_INTERVAL === "1" ? 15 * 1000 : 5 * 60 * 1000;

  setInterval(() => {
    try {
      const queue = readQueue();
      const now = Date.now();
      const due = queue.filter(
        (p) => new Date(p.scheduled_at).getTime() <= now && p.status === "queued"
      );

      if (due.length) {
        log("SCHEDULER_WAKE", { due: due.length });
        const remaining = [];

        for (const post of queue) {
          if (post.status !== "queued") continue;
          const ts = new Date(post.scheduled_at).getTime();
          if (ts > now) {
            remaining.push(post);
            continue;
          }

          // simulate publish
          log("POST_PUBLISHED_SIM", {
            id: post.id,
            salon: post.salon_id,
            stylist: post.stylist,
            platform: post.platform,
            caption: post.payload?.caption?.slice(0, 100) || "",
          });

          // persist to posts.log for analytics
          const record = {
            ...post,
            published_at: new Date().toISOString(),
          };
          try {
            fs.appendFileSync(POSTS_LOG, JSON.stringify(record, null, 2) + "\n");
          } catch (err) {
            log("POST_LOG_FAIL", { err: err.message });
          }

          post.status = "posted";
        }

        writeQueue(remaining);
      } else {
        log("SCHEDULER_IDLE", { size: queue.length });
      }
    } catch (err) {
      log("SCHEDULER_ERROR", { err: err.message });
    }
  }, interval);
}

// ======================================================
// 🧪 Self-Test Hook (optional)
// ======================================================
if (process.env.SCHEDULER_TEST === "1") {
  enqueuePost({
    salon_id: "demo",
    stylist: "Troy",
    type: "portfolio",
    platform: "instagram_feed",
    payload: { caption: "Scheduler self-test ✂️" },
  });
  startScheduler();
}