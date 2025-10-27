// scripts/schedulerSmokeTest.js
// MostlyPostly — Enhanced Scheduler Smoke Test
// Enqueues multiple post types, runs scheduler, then prints a summary report.

import { enqueuePost, startScheduler } from "../src/scheduler.js";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "logs", "queue.json");
const POSTS_LOG = path.join(ROOT, "logs", "posts.log");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 🧹 Reset logs for clean run
if (fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]");
console.log("🧹 Cleared queue.json");

if (fs.existsSync(POSTS_LOG)) fs.writeFileSync(POSTS_LOG, "");
console.log("🧹 Cleared posts.log");

// 🧩 Batch of realistic test posts
const samplePosts = [
  {
    salon_id: "rejuve",
    stylist: "Addie",
    type: "stylist_portfolio",
    platform: "instagram_feed",
    payload: { caption: "✨ Balayage glow-up #MostlyPostly" },
  },
  {
    salon_id: "rejuve",
    stylist: "Kayla",
    type: "open_availability",
    platform: "instagram_stories",
    payload: { caption: "💇‍♀️ Open slots tomorrow! DM to book." },
  },
  {
    salon_id: "rejuve",
    stylist: "Troy",
    type: "retail_spotlight",
    platform: "facebook_page",
    payload: { caption: "🌿 Featured product: Aveda Nutriplenish!" },
  },
  {
    salon_id: "rejuve",
    stylist: "Team",
    type: "culture_post",
    platform: "instagram_feed",
    payload: { caption: "💚 Love where you work — team brunch vibes!" },
  },
];

// 🚀 Enqueue posts
console.log("\n📦 Enqueuing test posts...");
for (const post of samplePosts) {
  enqueuePost(post);
}

// 🕒 Show initial queued posts
const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
console.log("\n✅ Queued Posts:");
queue.forEach((p, i) => {
  const when = new Date(p.scheduled_at).toLocaleString("en-US", {
    timeZone: "America/Indiana/Indianapolis",
  });
  console.log(`#${i + 1}: ${p.type} (${p.platform}) → ${when}`);
});

// 🕐 Start scheduler in test mode
console.log("\n🕒 Starting scheduler (TEST_INTERVAL=1 for fast loop)...");
process.env.TEST_INTERVAL = "1";
startScheduler();

// 🧭 Wait for one full cycle (15s * 2 = 30s)
await sleep(30000);

// 📊 Collect analytics summary
let published = [];
if (fs.existsSync(POSTS_LOG)) {
  const raw = fs.readFileSync(POSTS_LOG, "utf8").trim();
  if (raw.length) {
    published = raw
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
}

// 📈 Summarize results
const summary = {};
for (const post of published) {
  const key = `${post.platform}:${post.type}`;
  summary[key] = (summary[key] || 0) + 1;
}

console.log("\n📊 Publish Summary (from posts.log):");
if (!published.length) {
  console.log("No posts published yet — they may still be queued for tomorrow’s window.");
} else {
  for (const [key, count] of Object.entries(summary)) {
    console.log(`• ${key} → ${count} post${count > 1 ? "s" : ""}`);
  }
}

// 🧩 Optional: show remaining queue
const remaining = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
console.log(`\n📬 Remaining queued posts: ${remaining.length}\n`);
