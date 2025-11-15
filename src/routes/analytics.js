// src/routes/analytics.js — Scheduler Analytics (multi-tenant auto-detect)
import express from "express";
import { db } from "../../db.js";
import { DateTime } from "luxon";
import { getSalonPolicy } from "../scheduler.js";
import { getAllSalons } from "../core/salonLookup.js";

const router = express.Router();

function appHost() {
  return process.env.HOST || "http://localhost:3000";
}
function navBar(current = "scheduler", salon_id = "") {
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
        ${link("/logout", "Logout", "logout")}
      </nav>
    </div>
  </header>
  <div class="bg-gradient-to-b from-black via-zinc-950 to-black h-[1px]"></div>
  `;
}
function pageShell({ title, body, salon_id = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-zinc-100">
  ${navBar("scheduler", salon_id)}
  <main class="max-w-6xl mx-auto px-4 py-6">
    ${body}
  </main>
</body>
</html>`;
}
function salonNameFromId(salonId) {
  const policy = getSalonPolicy(salonId) || {};
  return policy?.salon_info?.salon_name || policy?.salon_info?.name || policy?.name || salonId || "Salon";
}
function formatLocalTime(utcString, salonId) {
  if (!utcString) return "—";
  try {
    const salonPolicy = getSalonPolicy(salonId) || {};
    const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";
    const parsedISO = DateTime.fromISO(utcString, { zone: "utc" });
    const dt = parsedISO.isValid ? parsedISO : DateTime.fromSQL(utcString, { zone: "utc" });
    if (!dt.isValid) return utcString;
    return dt.setZone(tz).toFormat("MMM d, yyyy • h:mm a");
  } catch {
    return utcString;
  }
}
function nextAvailableSlotUtcISO() {
  const row = db
    .prepare(`
      SELECT scheduled_for
      FROM posts
      WHERE status IN ('approved','queued')
      ORDER BY datetime(scheduled_for) DESC
      LIMIT 1
    `)
    .get();
  let dt;
  if (row?.scheduled_for) {
    dt = DateTime.fromISO(row.scheduled_for, { zone: "utc" });
    if (!dt.isValid) dt = DateTime.fromSQL(row.scheduled_for, { zone: "utc" });
  }
  if (!dt || !dt.isValid) dt = DateTime.utc();
  return dt.plus({ minutes: 30 }).toUTC().toISO({ suppressMilliseconds: true });
}
function resolveSalonId(req) {
  const fromToken = req.manager?.salon_id || req.salon_id || null;
  const fromQuery = req.query.salon || req.query.salon_id || null;
  if (fromToken) return fromToken;
  if (fromQuery) return fromQuery;
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
        body: `<p class="text-red-400">⚠️ No salon context detected. Access via a manager link (token) or add <code>?salon=&lt;your-salon-id&gt;</code>.</p>`,
      })
    );
  }

  const salonName = salonNameFromId(salon_id);

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM posts WHERE salon_id = ?`)
    .get(salon_id).count;

  const counts = {};
  for (const s of ["manager_pending", "approved", "queued", "published", "denied"]) {
    counts[s] = db
      .prepare(`SELECT COUNT(*) as c FROM posts WHERE salon_id = ? AND status=?`)
      .get(salon_id, s).c;
  }

  const lastTen = db
    .prepare(
      `SELECT stylist_name, status, datetime(created_at) as created
       FROM posts
       WHERE salon_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 10`
    )
    .all(salon_id);

  const salonPolicy = getSalonPolicy(salon_id) || {};
  const tz = salonPolicy?.timezone || "America/Indiana/Indianapolis";
  const nextUtcSlot = nextAvailableSlotUtcISO();
  const parsed = DateTime.fromISO(nextUtcSlot, { zone: "utc" });
  const nextSlot = parsed.isValid ? parsed.setZone(tz).toFormat("MMM d, yyyy • h:mm a") : "—";

  const cards = Object.entries({
    Total: total,
    Pending: counts.manager_pending,
    Approved: counts.approved,
    Queued: counts.queued,
    Published: counts.published,
    Denied: counts.denied,
  })
    .map(
      ([label, val]) => `
      <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg text-center shadow-md">
        <div class="text-2xl font-bold text-blue-400">${val}</div>
        <div class="text-sm text-zinc-400">${label}</div>
      </div>`
    )
    .join("\n");

  const recentRows = lastTen
    .map(
      (p) => `
      <tr class="border-b border-zinc-800 hover:bg-zinc-900/60">
        <td class="px-3 py-2">${p.stylist_name || "?"}</td>
        <td class="px-3 py-2 text-sm uppercase text-blue-400">${p.status}</td>
        <td class="px-3 py-2 text-sm text-zinc-400">${formatLocalTime(p.created, salon_id)}</td>
      </tr>`
    )
    .join("\n");

  const body = `
    <section class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Scheduler Analytics — <span class="text-blue-400">${salonName}</span></h1>
      <p class="text-sm text-zinc-400 mb-6">Overview of post statuses and next scheduling window for this salon.</p>

      <div class="mb-4 text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
        🕓 <span class="text-blue-400 font-semibold">Next Scheduler Slot:</span>
        <span class="text-zinc-200">${nextSlot}</span>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">${cards}</div>

      <h2 class="text-xl font-semibold mb-2">Recent Activity</h2>
      <div class="overflow-x-auto border border-zinc-800 rounded-lg">
        <table class="w-full text-sm border-collapse">
          <thead class="bg-zinc-900 text-zinc-300 text-left">
            <tr>
              <th class="px-3 py-2">Stylist</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            ${recentRows || "<tr><td colspan=3 class='px-3 py-4 text-center text-zinc-500'>No recent posts.</td></tr>"}
          </tbody>
        </table>
      </div>
    </section>
  `;

  res.send(pageShell({ title: `Analytics — ${salonName}`, body, salon_id }));
});

export default router;
