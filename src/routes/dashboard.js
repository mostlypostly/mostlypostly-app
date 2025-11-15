// src/routes/dashboard.js — MostlyPostly Database Dashboard (multi-tenant auto-detect)
import express from "express";
import { db } from "../../db.js";
import { Parser } from "json2csv";
import { DateTime } from "luxon";
import { getSalonPolicy } from "../scheduler.js";
import { getAllSalons } from "../core/salonLookup.js"; // ⬅️ fixed: removed getSalonById

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function salonNameFromId(salonId) {
  const policy = getSalonPolicy(salonId) || {};
  return policy?.salon_info?.salon_name || policy?.salon_info?.name || policy?.name || salonId || "Salon";
}
function appHost() {
  return process.env.HOST || "http://localhost:3000";
}
function navBar(current = "database", salon_id = "", manager_phone = "") {
  const link = (href, label, key) =>
    `<a href="${href}" class="${
      current === key
        ? "text-white bg-blue-600"
        : "text-blue-300 hover:text-white hover:bg-blue-500"
    } px-3 py-1 rounded transition">${label}</a>`;
  const qsSalon = salon_id ? `?salon=${encodeURIComponent(salon_id)}` : "";
  return `
  <header class="bg-black/95 text-blue-300 shadow-md sticky top-0 z-10">
    <div class="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_2px_rgba(59,130,246,0.9)]"></span>
        <a href="${appHost()}/manager" class="font-semibold tracking-wide">MostlyPostly — Portal</a>
      </div>
      <nav class="flex gap-2">
        ${link("/manager", "Manager", "manager")}
        ${link(`/dashboard${qsSalon}`, "Database", "database")}
        ${link(`/analytics${qsSalon}`, "Scheduler Analytics", "scheduler")}
        ${link(`/index.html`, "Policies", "policies")}
        ${link("logout", "Logout", "logout")}
      </nav>
    </div>
  </header>
  <div class="bg-gradient-to-b from-black via-zinc-950 to-black h-[1px]"></div>
  `;
}
function pageShell({ title, body, current = "database", salon_id = "", manager_phone = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-zinc-100">
  ${navBar(current, salon_id, manager_phone)}
  <main class="max-w-6xl mx-auto px-4 py-6">
    ${body}
  </main>
</body>
</html>`;
}
function formatLocalTime(ts, salonId) {
  if (!ts) return "—";
  try {
    const salonPolicy = getSalonPolicy(salonId) || {};
    const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";
    let dt;
    if (typeof ts === "string" && ts.includes("T")) {
      dt = DateTime.fromISO(ts, { zone: "utc" });
    } else {
      dt = DateTime.fromSQL(ts, { zone: "utc" });
    }
    if (!dt.isValid) return ts;
    return dt.setZone(tz).toFormat("MMM d, yyyy • h:mm a");
  } catch {
    return ts;
  }
}
function rangeToUtc(range, tz, customStart, customEnd) {
  const now = DateTime.now().setZone(tz);
  let from = DateTime.fromMillis(0).setZone(tz); // "All" = epoch
  let to = now;
  switch ((range || "all").toLowerCase()) {
    case "today":        from = now.startOf("day"); to = now.endOf("day"); break;
    case "yesterday":    from = now.minus({ days: 1 }).startOf("day"); to = now.minus({ days: 1 }).endOf("day"); break;
    case "this week":    from = now.startOf("week"); to = now.endOf("week"); break;
    case "last week":    from = now.minus({ weeks: 1 }).startOf("week"); to = now.minus({ weeks: 1 }).endOf("week"); break;
    case "this month":   from = now.startOf("month"); to = now.endOf("month"); break;
    case "last month":   from = now.minus({ months: 1 }).startOf("month"); to = now.minus({ months: 1 }).endOf("month"); break;
    case "this year":    from = now.startOf("year"); to = now.endOf("year"); break;
    case "last year":    from = now.minus({ years: 1 }).startOf("year"); to = now.minus({ years: 1 }).endOf("year"); break;
    case "custom":
      if (customStart) from = DateTime.fromISO(customStart, { zone: tz });
      if (customEnd)   to   = DateTime.fromISO(customEnd, { zone: tz });
      break;
    case "all":
    default: break;
  }
  return {
    fromUtc: from.toUTC().toISO({ suppressMilliseconds: true }),
    toUtc: to.toUTC().toISO({ suppressMilliseconds: true }),
  };
}

// NEW: resolve salon automatically (token/cookie → query → single-tenant fallback)
function resolveSalonId(req) {
  const fromToken = req.manager?.salon_id || req.salon_id || null;
  const fromQuery = req.query.salon || req.query.salon_id || null;
  if (fromToken) return fromToken;
  if (fromQuery) return fromQuery;

  // single-tenant fallback: if only one salon is configured, use it
  try {
    const all = getAllSalons();
    const ids = Object.keys(all || {});
    if (ids.length === 1) return ids[0];
  } catch {}
  return null;
}

// ─────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const salon_id = resolveSalonId(req);
  if (!salon_id) {
    return res.status(400).send(
      pageShell({
        title: "Missing salon ID",
        body: `<p class="text-red-400">⚠️ No salon context detected. Access this page using your manager link, or add <code>?salon=&lt;your-salon-id&gt;</code> to the URL.</p>`,
      })
    );
  }

  const salonName = salonNameFromId(salon_id);
  const salonPolicy = getSalonPolicy(salon_id) || {};
  const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";

  const range = (req.query.range || "all").toLowerCase();
  const statusParam = (req.query.status || "all").toLowerCase();
  const stylist = (req.query.stylist || "").trim().toLowerCase();
  const search = (req.query.search || "").trim().toLowerCase();
  const start = req.query.start || "";
  const end = req.query.end || "";
  const download = req.query.download === "csv";

  const { fromUtc, toUtc } = rangeToUtc(range, tz, start, end);

    let sql = `
    SELECT id, stylist_name, salon_id, status, created_at, scheduled_for, salon_post_number, final_caption, image_url
    FROM posts
    WHERE salon_id = ?
      AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
  `;

  const params = [salon_id, fromUtc, toUtc];

  if (statusParam !== "all") {
    sql += ` AND LOWER(status) = ?`;
    params.push(statusParam);
  }
  if (stylist) {
    sql += ` AND LOWER(stylist_name) LIKE ?`;
    params.push(`%${stylist}%`);
  }
  if (search) {
    sql += ` AND (LOWER(final_caption) LIKE ?)`;
    params.push(`%${search}%`);
  }

  sql += ` ORDER BY datetime(created_at) DESC LIMIT 1000`;
  const posts = db.prepare(sql).all(...params);

  if (download && posts.length) {
    const parser = new Parser();
    const csv = parser.parse(posts);
    res.header("Content-Type", "text/csv");
    res.attachment(`mostlypostly_${salon_id}_posts.csv`);
    return res.send(csv);
  }

  const rows = posts
    .map(
      (p) => `
      <tr class="border-b border-zinc-800 hover:bg-zinc-900/60">
        <td class="px-3 py-2">#${p.salon_post_number ?? "—"}</td>
        <td class="px-3 py-2">${p.stylist_name || "—"}</td>
        <td class="px-3 py-2 text-sm uppercase text-blue-400">${p.status}</td>
        <td class="px-3 py-2 text-sm text-zinc-400">${formatLocalTime(p.created_at, salon_id)}</td>
        <td class="px-3 py-2 text-sm text-zinc-400">${formatLocalTime(p.scheduled_for, salon_id)}</td>
      </tr>`
    )
    .join("\n");

  const body = `
    <section class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Database — <span class="text-blue-400">${salonName}</span></h1>
      <p class="text-sm text-zinc-400 mb-6">Filter and export your posts for this salon.</p>

      <div class="overflow-x-auto border border-zinc-800 rounded-lg">
        <table class="w-full text-sm border-collapse">
          <thead class="bg-zinc-900 text-zinc-300 text-left">
            <tr>
              <th class="px-3 py-2">ID</th>
              <th class="px-3 py-2">Stylist</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Created</th>
              <th class="px-3 py-2">Scheduled</th>
            </tr>
          </thead>
          <tbody>
            ${rows || "<tr><td colspan=5 class='px-3 py-4 text-center text-zinc-500'>No posts in range.</td></tr>"}
          </tbody>
        </table>
      </div>
    </section>
  `;

  res.send(pageShell({ title: `Dashboard — ${salonName}`, body, current: "database", salon_id }));
});

export default router;
