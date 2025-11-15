// src/routes/dashboard.js — MostlyPostly Database Dashboard (styled + filters + CSV)

import express from "express";
import { db } from "../../db.js";
import { Parser } from "json2csv"; // npm i json2csv
import { DateTime } from "luxon";
import { getSalonPolicy } from "../scheduler.js";

const router = express.Router();

function salonNameFromId(salonId) {
  const policy = getSalonPolicy(salonId);
  return policy?.salon_info?.name || policy?.name || salonId;
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

// Safely format any timestamp (ISO or SQL) in the salon's local timezone
function formatLocalTime(ts, salonId) {
  if (!ts) return "—";
  try {
    const salonPolicy = getSalonPolicy(salonId);
    const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";
    let dt;

    if (typeof ts === "string" && ts.includes("T")) {
      // ISO (likely UTC)
      dt = DateTime.fromISO(ts, { zone: "utc" });
    } else {
      // SQLite DATETIME (assume UTC)
      dt = DateTime.fromSQL(ts, { zone: "utc" });
    }
    if (!dt.isValid) return ts;

    return dt.setZone(tz).toFormat("MMM d, yyyy • h:mm a");
  } catch {
    return ts;
  }
}

// Resolve a date range into UTC ISO strings for SQLite comparisons
function rangeToUtc(range, tz, customStart, customEnd) {
  const now = DateTime.now().setZone(tz);
  let from = DateTime.fromMillis(0).setZone(tz); // default "All" = epoch
  let to = now;

  switch ((range || "all").toLowerCase()) {
    case "today":
      from = now.startOf("day"); to = now.endOf("day"); break;
    case "yesterday":
      from = now.minus({ days: 1 }).startOf("day");
      to = now.minus({ days: 1 }).endOf("day"); break;
    case "this week":
      from = now.startOf("week"); to = now.endOf("week"); break;
    case "last week":
      from = now.minus({ weeks: 1 }).startOf("week");
      to = now.minus({ weeks: 1 }).endOf("week"); break;
    case "this month":
      from = now.startOf("month"); to = now.endOf("month"); break;
    case "last month":
      from = now.minus({ months: 1 }).startOf("month");
      to = now.minus({ months: 1 }).endOf("month"); break;
    case "this year":
      from = now.startOf("year"); to = now.endOf("year"); break;
    case "last year":
      from = now.minus({ years: 1 }).startOf("year");
      to = now.minus({ years: 1 }).endOf("year"); break;
    case "custom":
      if (customStart) from = DateTime.fromISO(customStart, { zone: tz });
      if (customEnd) to = DateTime.fromISO(customEnd, { zone: tz });
      break;
    case "all":
    default:
      // leave from=epoch, to=now
      break;
  }

  return {
    fromUtc: from.toUTC().toISO({ suppressMilliseconds: true }),
    toUtc: to.toUTC().toISO({ suppressMilliseconds: true }),
  };
}

router.get("/", (req, res) => {
  const salon_id = req.query.salon || "rejuve-salon-spa";
  const salonName = salonNameFromId(salon_id);
  const salonPolicy = getSalonPolicy(salon_id);
  const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";

  // Filters
  const range = (req.query.range || "all").toLowerCase();
  const statusParam = (req.query.status || "all").toLowerCase();
  const stylist = (req.query.stylist || "").trim().toLowerCase();
  const search = (req.query.search || "").trim().toLowerCase();
  const start = req.query.start || "";
  const end = req.query.end || "";
  const download = req.query.download === "csv";

  // Resolve range to UTC ISO for SQLite
  const { fromUtc, toUtc } = rangeToUtc(range, tz, start, end);

  // Build SQL
  let sql = `
    SELECT id, stylist_name, salon_id, status, created_at, scheduled_for, final_caption, image_url
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

  // CSV export with current filters
  if (download && posts.length) {
    const parser = new Parser();
    const csv = parser.parse(posts);
    res.header("Content-Type", "text/csv");
    res.attachment(`mostlypostly_${salon_id}_posts.csv`);
    return res.send(csv);
  }

  // Options
  const rangeOptions = [
    "All", "Today", "Yesterday", "This Week", "Last Week",
    "This Month", "Last Month", "This Year", "Last Year", "Custom"
  ];
  const statusOptions = [
    ["all", "All"],
    ["manager_pending", "Manager Pending"],
    ["approved", "Approved"],
    ["queued", "Queued"],
    ["published", "Published"],
    ["denied", "Denied"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ];

  // Table rows
  const rows = posts.map(p => `
    <tr class="border-b border-zinc-800 hover:bg-zinc-900/60">
      <td class="px-3 py-2 text-xs text-zinc-500">${p.id}</td>
      <td class="px-3 py-2">${p.stylist_name || "—"}</td>
      <td class="px-3 py-2"><span class="uppercase text-blue-400">${p.status}</span></td>
      <td class="px-3 py-2 text-xs">${formatLocalTime(p.created_at, p.salon_id)}</td>
      <td class="px-3 py-2 text-xs text-blue-300">${formatLocalTime(p.scheduled_for, p.salon_id)}</td>
      <td class="px-3 py-2 text-xs max-w-xs truncate" title="${(p.final_caption || "").replace(/"/g, "&quot;")}">${(p.final_caption || "").substring(0, 140)}</td>
    </tr>
  `).join("\n");

  // Filters UI
  const filters = `
    <form method="GET" class="mb-4 grid gap-3 md:grid-cols-6 items-end bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
      <input type="hidden" name="salon" value="${salon_id}" />

      <label class="text-sm text-zinc-300 md:col-span-2">Date Range
        <select name="range" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2">
          ${rangeOptions.map(opt => {
            const val = opt.toLowerCase();
            const sel = (val === range) ? "selected" : "";
            return `<option value="${val}" ${sel}>${opt}</option>`;
          }).join("")}
        </select>
      </label>

      <label class="text-sm text-zinc-300">Start (custom)
        <input type="datetime-local" name="start" value="${start}" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2" />
      </label>

      <label class="text-sm text-zinc-300">End (custom)
        <input type="datetime-local" name="end" value="${end}" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2" />
      </label>

      <label class="text-sm text-zinc-300">Status
        <select name="status" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2">
          ${statusOptions.map(([val,label]) => `<option value="${val}" ${val===statusParam?"selected":""}>${label}</option>`).join("")}
        </select>
      </label>

      <label class="text-sm text-zinc-300">Stylist
        <input name="stylist" placeholder="e.g. Nicole" value="${(req.query.stylist||"")}" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2" />
      </label>

      <label class="text-sm text-zinc-300 md:col-span-2">Search text
        <input name="search" placeholder="caption contains..." value="${(req.query.search||"")}" class="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded text-zinc-200 p-2" />
      </label>

      <div class="md:col-span-4 flex gap-2">
        <button class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white">Apply</button>
        <a href="/dashboard?salon=${encodeURIComponent(salon_id)}" class="px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-white">Reset</a>
        <a href="/dashboard?salon=${encodeURIComponent(salon_id)}&range=${encodeURIComponent(range)}&status=${encodeURIComponent(statusParam)}&stylist=${encodeURIComponent(stylist)}&search=${encodeURIComponent(search)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&download=csv" class="ml-auto px-3 py-2 bg-zinc-800 hover:bg-blue-600 rounded text-sm text-zinc-300">⬇ CSV Export</a>
      </div>
    </form>
  `;

  const body = `
    <section class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Database — <span class="text-blue-400">${salonName}</span></h1>
      <p class="text-sm text-zinc-400 mb-4">All posts (filtered). Times shown in local timezone for this salon.</p>
      ${filters}
      <div class="overflow-x-auto border border-zinc-800 rounded-lg">
        <table class="w-full text-sm border-collapse">
          <thead class="bg-zinc-900 text-zinc-300 text-left">
            <tr>
              <th class="px-3 py-2">ID</th>
              <th class="px-3 py-2">Stylist</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Created (local)</th>
              <th class="px-3 py-2">Scheduled (local)</th>
              <th class="px-3 py-2">Preview</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="6" class="px-3 py-4 text-center text-zinc-500">No results</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;

  res.send(pageShell({
    title: `Database — ${salonName}`,
    body,
    current: "database",
    salon_id
  }));
});

export default router;
