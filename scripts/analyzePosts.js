// scripts/analyzePosts.js
// MostlyPostly — Post Analytics Utility
// Reads posts.log and prints summaries by platform, type, stylist, and date.

import fs from "fs";
import path from "path";

const POSTS_LOG = path.join(process.cwd(), "logs", "posts.log");

function readPosts() {
  if (!fs.existsSync(POSTS_LOG)) {
    console.log("⚠️ No posts.log found. Run the scheduler smoke test first.");
    return [];
  }
  const raw = fs.readFileSync(POSTS_LOG, "utf8").trim();
  if (!raw.length) return [];
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

// 🧩 Group helper
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

// 🧠 Summaries
function summarize(posts) {
  if (!posts.length) {
    console.log("📭 No posts published yet.");
    return;
  }

  console.log(`\n📊 MostlyPostly Post Analytics — ${posts.length} total posts\n`);

  // --- By Platform
  const byPlatform = groupBy(posts, (p) => p.platform || "unknown");
  console.log("📱 Posts by Platform:");
  for (const [platform, arr] of Object.entries(byPlatform)) {
    console.log(`  • ${platform.padEnd(20)} ${arr.length}`);
  }

  // --- By Type
  const byType = groupBy(posts, (p) => p.type || "unknown");
  console.log("\n🎨 Posts by Type:");
  for (const [type, arr] of Object.entries(byType)) {
    console.log(`  • ${type.padEnd(20)} ${arr.length}`);
  }

  // --- By Stylist
  const byStylist = groupBy(posts, (p) => p.stylist || "unknown");
  console.log("\n💇 Posts by Stylist:");
  for (const [stylist, arr] of Object.entries(byStylist)) {
    console.log(`  • ${stylist.padEnd(20)} ${arr.length}`);
  }

  // --- By Day
  const byDay = groupBy(posts, (p) =>
    new Date(p.published_at || p.scheduled_at).toISOString().slice(0, 10)
  );
  console.log("\n📅 Posts by Day:");
  for (const [date, arr] of Object.entries(byDay)) {
    console.log(`  • ${date} — ${arr.length} post${arr.length > 1 ? "s" : ""}`);
  }

  // --- Average spacing (approximate)
  const times = posts
    .map((p) => new Date(p.published_at || p.scheduled_at).getTime())
    .sort((a, b) => a - b);
  if (times.length > 1) {
    const diffs = times.slice(1).map((t, i) => t - times[i]);
    const avgMin = diffs.reduce((a, b) => a + b, 0) / diffs.length / 60000;
    console.log(
      `\n⏱️  Average spacing between posts: ${avgMin.toFixed(1)} minutes`
    );
  }

  console.log("\n✅ End of Report\n");
}

// Run analysis
const posts = readPosts();
summarize(posts);
