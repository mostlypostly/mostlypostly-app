// scripts/check-salon-defaults.js
// Ensures each salons/*.json defines salon_info.default_hashtags as an array of '#Tags'. hashtag-ok
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

const salonsDir = path.resolve("salons");
if (!fs.existsSync(salonsDir)) {
  console.log("(info) salons/ not found — skipping check.");
  process.exit(0);
}

let failed = 0;
const tagPattern = /^#\S+$/;

for (const file of fs.readdirSync(salonsDir)) {
  if (!file.endsWith(".json")) continue;
  const full = path.join(salonsDir, file);

  try {
    const data = JSON.parse(fs.readFileSync(full, "utf-8"));
    assert(data.salon_info && typeof data.salon_info === "object", "missing salon_info");
    const arr = data.salon_info.default_hashtags;
    assert(Array.isArray(arr), "salon_info.default_hashtags must be an array");
    for (const t of arr) {
      assert(typeof t === "string", "hashtags must be strings");
      assert(tagPattern.test(t), `invalid hashtag format: ${t}`);
    }
    console.log(`✅ ${file}`);
  } catch (e) {
    failed++;
    console.error(`❌ ${file}: ${e.message}`);
  }
}

process.exit(failed ? 1 : 0);