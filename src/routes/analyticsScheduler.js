// src/routes/analyticsScheduler.js
// MostlyPostly — Analytics API for Scheduler / posts.log

import fs from "fs";
import path from "path";
import express from "express";

const router = express.Router();
const POSTS_LOG = path.join(process.cwd(), "logs", "posts.log");

// --- Helper: read and parse posts.log
function readPosts() {
  if (!fs.existsSync(POSTS_LOG)) return [];
  const raw = fs.readFileSync(POSTS_LOG, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// --- Helper: group array items by key
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

// --- Build summary object
function buildSummary(posts) {
  if (!posts.length) {
    return { ok: true, total: 0, message: "No posts found" };
  }

  const byPlatform = groupBy(posts, (p) => p.platform || "unknown");
  const byType = groupBy(posts, (p) => p.type || "unknown");
  const byStylist = groupBy(posts, (p) => p.stylist || "unknown");
  const byDay = groupBy(posts, (p) =>
    new Date(p.published_at || p.scheduled_at).toISOString().slice(0, 10)
  );

  // average spacing (approx)
  const times = posts
    .map((p) => new Date(p.published_at || p.scheduled_at).getTime())
    .sort((a, b) => a - b);
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
      byStylist: Object.fromEntries(
        Object.entries(byStylist).map(([k, v]) => [k, v.length])
      ),
      byDay: Object.fromEntries(
        Object.entries(byDay).map(([k, v]) => [k, v.length])
      ),
      avgSpacingMin,
    },
  };
}

// --- Route handler
router.get("/", async (_req, res) => {
  try {
    const posts = readPosts();
    const report = buildSummary(posts);
    res.json(report);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
