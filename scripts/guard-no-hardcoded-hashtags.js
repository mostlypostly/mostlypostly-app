// scripts/guard-no-hardcoded-hashtags.js
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BRAND_TAG = (process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly").toLowerCase();

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache", "coverage", "data", "tests"
]);
const SCAN_EXTS = new Set([".js", ".ts", ".jsx", ".tsx", ".json"]);
const VIOLATIONS = [];

function isIgnoredDir(p) {
  return [...IGNORE_DIRS].some(dir => p.split(path.sep).includes(dir));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isIgnoredDir(full)) continue;
    if (entry.isDirectory()) walk(full);
    else if (SCAN_EXTS.has(path.extname(entry.name))) scanFile(full);
  }
}

function scanFile(file) {
  // salon configs are allowed to contain hashtags
  if (file.includes(`${path.sep}salons${path.sep}`)) return;

  // skip known test/demo files
  const lower = file.toLowerCase();
  if (lower.includes(`${path.sep}tests${path.sep}`)) return;
  if (lower.includes("test")) return;       // any file with "test" in the name
  if (lower.endsWith("guard-no-hardcoded-hashtags.js")) return;

  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split(/\r?\n/);

  const hashtagRegex = /(^|[^A-Za-z0-9_])#([A-Za-z][A-Za-z0-9_]+)/g;
  let inBlockComment = false;

  lines.forEach((rawLine, i) => {
    const line = rawLine;

    // basic block comment handling
    if (!inBlockComment && line.includes("/*")) inBlockComment = true;
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return; // ignore block comments
    }

    const trimmed = line.trim();

    // ignore single-line comments and pragma allow
    if (trimmed.startsWith("//")) return;
    if (/hashtag-ok\s*$/.test(line)) return;

    let m;
    while ((m = hashtagRegex.exec(line))) {
      const tag = `#${m[2]}`;

      // allow the brand tag
      if (tag.toLowerCase() === BRAND_TAG) continue;

      // ignore anchors in URLs
      if (line.includes("://") && line.indexOf("#") > line.indexOf("://")) continue;

      VIOLATIONS.push({ file, line: i + 1, tag, text: trimmed });
    }
  });
}

walk(ROOT);

if (VIOLATIONS.length) {
  console.error("\n❌ Hard-coded hashtags found (non-brand). Move them into salons/*.json or mark the line with // hashtag-ok\n");
  for (const v of VIOLATIONS) {
    console.error(`${v.file}:${v.line}  ${v.tag}  →  ${v.text}`);
  }
  console.error("\nAllowed: only MOSTLYPOSTLY_BRAND_TAG (default #MostlyPostly), salon JSONs, or lines with // hashtag-ok\n");
  process.exit(1);
} else {
  console.log("✅ No hard-coded hashtags detected in code.");
}
