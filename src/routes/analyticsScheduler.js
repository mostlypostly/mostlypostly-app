// src/routes/analyticsScheduler.js
// MostlyPostly — Analytics API for Scheduler / posts.log

import fs from "fs";
import path from "path";
import express from "express";
import { DateTime } from "luxon";
import { getSalonPolicy } from "../scheduler.js";

const router = express.Router();
const POSTS_LOG = path.join(process.cwd(), "logs", "posts.log");

// --- Helper: read and parse posts.log (JSON lines)
function readPosts() {
  if (!fs.existsSync(POSTS_LOG)) return [];
  const raw = fs.readFileSync(POSTS_LOG, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      out.push(obj);
    } catch {
      // skip non-JSON lines
    }
  }
  return out;
}

// --- Build a simple summary of posts
function buildSummary(posts) {
  const byPlatform = {};
  const byType = {};
  const byStatus = {};
  let mostRecent = null;
  let earliest = null;

  const times = [];

  for (const p of posts) {
    const platform = p.platform || p.platforms || "unknown";
    const type = p.type || "unknown";
    const status = p.status || "unknown";

    byPlatform[platform] = byPlatform[platform] || [];
    byPlatform[platform].push(p);

    byType[type] = byType[type] || [];
    byType[type].push(p);

    byStatus[status] = byStatus[status] || 0;
    byStatus[status]++;

    // track created/published time for spacing calc
    const t =
      p.published_at ||
      p.created_at ||
      p.scheduled_for ||
      p.t ||
      p.time ||
      null;

    if (t) {
      const ts = Date.parse(t);
      if (!Number.isNaN(ts)) {
        times.push(ts);
        if (!mostRecent || ts > mostRecent) mostRecent = ts;
        if (!earliest || ts < earliest) earliest = ts;
      }
    }
  }

  times.sort((a, b) => a - b);
  let avgSpacingMin = null;
  if (times.length > 1) {
    const diffs = times.slice(1).map((t, i) => t - times[i]);
    avgSpacingMin = diffs.reduce((a, b) => a + b, 0) / diffs.length / 60000;
  }

  return {
    ok: true,
    total: posts.length,
    summary: {
      byPlatform: Object.fromEntries(
        Object.entries(byPlatform).map(([k, v]) => [k, v.length])
      ),
      byType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, v.length])
      ),
      byStatus,
      earliest_iso: earliest ? new Date(earliest).toISOString() : null,
      most_recent_iso: mostRecent ? new Date(mostRecent).toISOString() : null,
      avg_spacing_minutes: avgSpacingMin,
    },
  };
}

// --- Compute next available slot based on salon timezone + posting window
function computeNextSlot({ timezone, posting_window }) {
  const tz = timezone || "America/Indiana/Indianapolis";
  const window = posting_window || { start: "09:00", end: "19:00" };

  const now = DateTime.now().setZone(tz);

  // round to next 30-minute boundary
  const nextHalfMinute =
    now.minute < 30
      ? now.startOf("hour").plus({ minutes: 30 })
      : now.startOf("hour").plus({ hours: 1 });

  // window start/end today
  const [startH, startM] = (window.start || "09:00").split(":").map(Number);
  const [endH, endM] = (window.end || "19:00").split(":").map(Number);

  const todayStart = now.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
  const todayEnd = now.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

  let candidate = nextHalfMinute;

  if (candidate < todayStart) {
    candidate = todayStart;
  } else if (candidate > todayEnd) {
    // push to tomorrow's window start
    candidate = todayStart.plus({ days: 1 });
  }

  return {
    utc: candidate.toUTC().toISO({ suppressMilliseconds: true }),
    local: candidate.toFormat("MMM d, yyyy • h:mm a"),
  };
}

// --- Route handler
router.get("/", async (_req, res) => {
  try {
    const salon_id = _req.query.salon || "rejuve-salon-spa";
    const salonPolicy = getSalonPolicy(salon_id) || {};
    const timezone =
      salonPolicy?.timezone ||
      salonPolicy?.salon_info?.timezone ||
      "America/Indiana/Indianapolis";
    const posting_window =
      salonPolicy?.posting_window ||
      salonPolicy?.settings?.posting_window || // legacy
      { start: "09:00", end: "19:00" };

    const posts = readPosts();
    const report = buildSummary(posts);

    // add next-slot fields in multiple shapes (to satisfy any UI consumer)
    const next = computeNextSlot({ timezone, posting_window });
    report.next_slot_utc = next.utc;
    report.next_slot_local = next.local;
    report.next_run_utc = next.utc;
    report.next_run_local = next.local;
    report.nextAvailableSlot = next.utc;
    report.nextAvailableSlot_local = next.local;

    // include resolved salon info for display
    report.salon = {
      id: salon_id,
      name:
        salonPolicy?.salon_info?.name ||
        salonPolicy?.name ||
        salonPolicy?.display_name ||
        salon_id,
      timezone,
      posting_window,
    };

    res.json(report);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
