// server.js — MostlyPostly v3.4.3 (KISS: hot-reload endpoints + healthz + static /public)

import fs from "fs";
import path from "path";
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
import fetch from "node-fetch";
import http from "http";
import { Server } from "socket.io";
import "dotenv/config";
import crypto from "crypto";

import { db, saveDraft, getLatestDraft, savePost } from "./db.js";
import dashboardRoute from "./src/routes/dashboard.js";
import postsRoute from "./src/routes/posts.js";
import analyticsRoute from "./src/routes/analytics.js";
import * as formatters from "./formatters.js";
import telegramRoute from "./src/routes/telegram.js";
import twilioRoute from "./src/routes/twilio.js";
import { parseNaturalAvailability } from "./src/core/timeParser.js";
import {
  getSalonAvailability,
  injectAvailabilityIntoCaption,
} from "./src/core/availabilityProvider.js";

import { buildCombinedHashtags } from "./src/utils/hashtags.js";
import { classifyPost } from "./src/core/postClassifier.js";

import { enqueuePost, startScheduler } from "./src/scheduler.js";
import analyticsSchedulerRoute from "./src/routes/analyticsScheduler.js";

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve /public/uploads as a truly public static directory
app.use(
  "/uploads",
  express.static(path.join(__dirname, "public/uploads"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
        res.setHeader("Content-Type", "image/jpeg");
      }
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  })
);


enqueuePost({
  salon_id: "rejuve",
  stylist: "Addie",
  type: "stylist_portfolio",
  platform: "instagram_feed",
  payload: { caption: "Fresh fall balayage 🍂" }
});

startScheduler();

const schedulerPolicy = JSON.parse(fs.readFileSync("./data/schedulerPolicy.json", "utf8"));


// 🔥 Hot-reloadable salons
import {
  loadSalons,
  startSalonWatcher,
  reloadSalonsNow,
  getSalonSnapshot,
  getSalonSettingFor,
} from "./src/core/salonLookup.js";

// ✅ Unified caption composer (HTML/plain) + env brand tag
import { composeFinalCaption } from "./src/core/composeFinalCaption.js";
import { createLogger } from "./src/utils/logHelper.js";

const log = createLogger("app"); // or "scheduler", "moderation", etc.

dotenv.config();

// Single source of truth for brand tag (configurable)
// If you change this in CI/local env: export MOSTLYPOSTLY_BRAND_TAG="#YourBrand"
const BRAND_TAG = process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly";

// ======================================================
// 🌍 Environment Check
// ======================================================
console.log("🌍 ENV CHECK:", {
  TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
  FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_TOKEN: process.env.FACEBOOK_PAGE_TOKEN
    ? process.env.FACEBOOK_PAGE_TOKEN.slice(0, 10) + "..."
    : undefined,
});

// 👀 start watcher + initial load
startSalonWatcher();
await loadSalons(); // preload once (watcher will keep it fresh)

const { MessagingResponse } = twilio.twiml;
const app = express();
const drafts = new Map();
const joinSessions = new Map();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use("/analytics/scheduler", analyticsSchedulerRoute);

// ======================================================
// 📂 Static files: /public  (NEW - robust setup)
// ======================================================
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(process.cwd(), "public");

// Ensure the folder exists
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Drop a tiny ok.txt so you can hit /public/ok.txt right away
const okPath = path.join(PUBLIC_DIR, "ok.txt");
if (!fs.existsSync(okPath)) {
  try {
    fs.writeFileSync(okPath, "ok\n");
  } catch {}
}

console.log("🗂️  Serving /public from:", PUBLIC_DIR);
// IMPORTANT: mount static BEFORE any catch-all routes
app.use("/public", express.static(PUBLIC_DIR, {
  // Helpful headers for images over ngrok
  setHeaders(res, filePath) {
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=600");
    }
  }
}));

// ======================================================
// Health / Admin
// ======================================================

// Simple health probe for your host/monitoring
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// See what's currently loaded (names + require_manager_approval flag)
app.get("/admin/salons", (_req, res) => {
  try {
    res.json(getSalonSnapshot());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Force a reload now (handy if watcher missed something)
app.post("/admin/reload-salons", async (_req, res) => {
  try {
    const snap = await reloadSalonsNow();
    res.json({ ok: true, ...snap });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Quickly read the live approval flag the router will use for a given chat_id/phone
// Example: /admin/require-approval?id=8246265288
app.get("/admin/require-approval", (req, res) => {
  const id = req.query.id;
  const val = !!getSalonSettingFor(id, "settings.require_manager_approval");
  res.json({ id, require_manager_approval: val });
});

// ======================================================
// Brand Repos (unchanged)
// ======================================================
const BRANDS_DIR = "./brands";
const BRAND_REPOS = {
  aveda: path.join(BRANDS_DIR, "aveda"),
};

// ======================================================
// Multi-salon setup (legacy objects still here; routes use src/core now)
// ======================================================
const salonsDir = "./salons";
const salons = {};

function saveSalonFile(salonInfoName) {
  const record = salons[salonInfoName];
  if (!record) return;
  const safeName = salonInfoName.toLowerCase().replace(/\s+/g, "");
  const filePath = path.join(salonsDir, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  console.log(`💾 Saved salon file: ${filePath}`);
}

// ======================================================
/* Legacy lookupStylist shim (kept for Twilio route wiring).
   Your production lookups should use src/core/salonLookup.js.
*/
function lookupStylist(identifier) {
  for (const salonName in salons) {
    const salonData = salons[salonName];
    const stylist = salonData.stylists[identifier];
    if (stylist) {
      return {
        stylist: {
          ...stylist,
          salon_name: salonData.salon_info.salon_name,
          city: salonData.salon_info.city,
          role: stylist.role || "stylist",
          specialties: stylist.specialties || [],
        },
        salon: salonData.salon_info,
      };
    }
  }
  return null;
}

// ======================================================
// Twilio image helper (unchanged)
// ======================================================
async function fetchTwilioImageAsBase64(url) {
  console.log("📸 Fetching Twilio media securely...");
  const resp = await fetch(url, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
    },
  });
  if (!resp.ok) throw new Error(`Twilio image fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
}

// ======================================================
// Log Approved Posts (unchanged)
// ======================================================
function logApprovedPost(stylist, platformPosts, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    stylist: stylist?.stylist_name || "Unknown",
    salon: stylist?.salon_name || "Unknown",
    city: stylist?.city || "",
    type: meta?.type || "standard",
    reasons: meta?.reasons || [],
    posts: platformPosts,
  };

  try {
    fs.appendFileSync("posts.log", JSON.stringify(entry, null, 2) + "\n\n");
    console.log("🗂️ Logged approved post to posts.log");
  } catch (err) {
    console.error("⚠️ Failed to log post:", err);
  }
}

// ======================================================
// 🧠 Improved AI Caption Generation (no hard-coded tags)
// ======================================================
async function safeGenerateCaption(imageDataUrl, notes = "", city = "", ctx = {}) {
  const { stylist = {}, salon = {} } = ctx;
  const model = "gpt-4o-mini";
  const stylistName = stylist?.stylist_name || "a stylist";
  const instagramHandle = stylist?.instagram_handle || null;
  const salonName = salon?.salon_name || "the salon";

  const systemPrompt = `
You are MostlyPostly, an AI assistant that writes social media captions for salons.
- Use friendly, professional, and confident tone.
- Vary sentence openings; do NOT always say “Our stylist has created”.
- If available, include the stylist’s name or @handle.
- Focus on the hair result (texture, tone, color, feel).
- Keep it 2–3 sentences max.
- End naturally with a booking invitation.
Return only JSON like:
{
  "service_type": "...",
  "caption": "...",
  "hashtags": ["#..."],
  "cta": "..."
}
`;

  const userPrompt = `
Salon: ${salonName} in ${city || "unknown city"}
Stylist: ${stylistName}
Instagram: ${instagramHandle ? "@" + instagramHandle : "N/A"}
Notes: ${notes}
Image URL: ${imageDataUrl ? "[binary]" : "no image provided"}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: userPrompt.trim() },
        ],
      }),
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      service_type: parsed?.service_type || "other",
      caption:
        parsed?.caption ||
        `A fresh new look styled by ${instagramHandle ? "@" + instagramHandle : stylistName}.`,
      // ✅ Only brand tag by default; NO location/salon hashtags here
      hashtags: Array.isArray(parsed?.hashtags) && parsed.hashtags.length > 0 ? parsed.hashtags : [BRAND_TAG],
      cta: parsed?.cta || "Book your next visit today!",
    };
  } catch (err) {
    console.error("❌ AI caption failed:", err);
    return {
      service_type: "other",
      caption: "A beautiful new look, ready to turn heads!",
      hashtags: [BRAND_TAG], // ✅ brand-only fallback
      cta: "Book your next visit today!",
    };
  }
}

// ======================================================
// Express Routes (unchanged wiring)
// ======================================================
app.get("/status", (req, res) => res.json({ ok: true, version: "3.4.3" }));

app.set("joinSessions", joinSessions);
app.set("salons", salons);
app.set("saveSalonFile", saveSalonFile);
app.set("lookupStylist", lookupStylist);

app.use(
  "/inbound/telegram",
  telegramRoute(drafts, lookupStylist, (img, notes, city, who) =>
    safeGenerateCaption(img, notes, city, who)
  )
);
app.use(
  "/inbound/twilio",
  twilioRoute(drafts, lookupStylist, (img, notes, city, who) =>
    safeGenerateCaption(img, notes, city, who)
  )
);

app.use("/dashboard", dashboardRoute(db));
app.use("/posts", postsRoute(db));
app.use("/analytics", analyticsRoute(db));

// ======================================================
// 🚀 Twilio Quick Tester (JOIN + Photo Flow) — Hardened Core Flow + File Logging
// ======================================================

const LOGS_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const APP_LOG = path.join(LOGS_DIR, "app.log");

function writeLog(entry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFile(APP_LOG, line, (err) => {
    if (err) console.error("⚠️ log write failed:", err.message);
  });
}

app.post("/inbound/twilio", async (req, res) => {
  const { MessagingResponse } = twilio.twiml;
  const twiml = new MessagingResponse();
  const start = Date.now();
  const SLA_MS = 10000;
  const id = crypto.randomUUID();

  const log = (event, data = {}) => {
    const entry = { t: new Date().toISOString(), id, event, ...data };
    console.log(JSON.stringify(entry));
    writeLog(entry);
  };

  try {
    const from = req.body.From;
    const body = (req.body.Body || "").trim();
    const numMedia = parseInt(req.body.NumMedia || "0", 10);

    // --- JOIN setup
    if (/^JOIN\\b/i.test(body)) {
      const msg = await startJoinFlow({ chatId: from, joinSessions });
      twiml.message(msg);
      log("JOIN_START", { from });
      return res.type("text/xml").send(twiml.toString());
    }

    if (isJoinInProgress({ chatId: from, joinSessions })) {
      const { message, done, salonNameAdded } = await handleJoinInput({
        chatId: from,
        text: body,
        joinSessions,
        salons,
        saveSalonFile,
      });
      twiml.message(message);
      if (done) log("JOIN_DONE", { salonNameAdded });
      return res.type("text/xml").send(twiml.toString());
    }

    const result = lookupStylist(from);
    const stylist = result?.stylist;
    const salonInfo = result?.salon;

    // --- APPROVE
    if (/^APPROVE\\b/i.test(body)) {
      const draft = drafts.get(from);
      if (!draft) {
        twiml.message("No draft to approve. Send a photo first.");
      } else {
        const ig = formatters.formatInstagramPost(draft, stylist, salonInfo);
        const fb = formatters.formatFacebookPost(draft, stylist, salonInfo);
        const x = formatters.formatXPost(draft, stylist, salonInfo);
        logApprovedPost(stylist, { ig, fb, x }, draft._meta);
        savePost(from, stylist, ig, fb, x);
        drafts.delete(from);
        twiml.message("✅ Approved! Your post is ready.\n\n" + ig);
      }
      log("POST_APPROVED", { stylist: stylist?.stylist_name });
      return res.type("text/xml").send(twiml.toString());
    }

    // --- No image
    if (numMedia === 0) {
      twiml.message(
        "I didn’t get a photo. Please send a clear image and optional note.\n\nCommands: APPROVE, EDIT <text>, OPTIONS, RESET."
      );
      log("NO_MEDIA", { from });
      return res.type("text/xml").send(twiml.toString());
    }

    // --- Fetch & AI
    const mediaUrl = req.body[`MediaUrl${numMedia - 1}`];
    const base64 = await fetchTwilioImageAsBase64(mediaUrl);

    let aiJson;
    try {
      aiJson = await safeGenerateCaption(base64, body, stylist?.city, { stylist, salon: salonInfo });
    } catch (err) {
      log("AI_ERROR", { err: err.message });
      twiml.message("⚠️ I'm having trouble generating your preview. Try again shortly.");
      return res.type("text/xml").send(twiml.toString());
    }

    if (!aiJson.caption || !Array.isArray(aiJson.hashtags) || !aiJson.cta) {
      log("AI_SCHEMA_FAIL", { aiJson });
      twiml.message("⚠️ Caption came back incomplete. Please resend your photo.");
      return res.type("text/xml").send(twiml.toString());
    }

    // --- Save + Preview
    drafts.set(from, aiJson);
    saveDraft(from, stylist, aiJson);

    const previewText = composeFinalCaption({
      caption: aiJson.caption,
      hashtags: aiJson.hashtags,
      cta: aiJson.cta,
      instagramHandle: stylist?.instagram_handle,
      stylistName: stylist?.stylist_name,
      bookingUrl: "",
      salon: { salon_info: salonInfo },
      asHtml: false,
    });

    const preview = `💇‍♀️ MostlyPostly Preview\\n\\n${previewText}\\n\\nReply APPROVE to post.`;
    twiml.message(preview);
    log("PREVIEW_SENT", { elapsed: Date.now() - start });

    if (Date.now() - start > SLA_MS) log("SLA_WARN", { ms: Date.now() - start });
    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    const twimlErr = new twilio.twiml.MessagingResponse();
    twimlErr.message("⚠️ Something went wrong. Please resend your last photo.");
    writeLog({ t: new Date().toISOString(), id, event: "UNHANDLED", error: err.message });
    return res.type("text/xml").send(twimlErr.toString());
  }
});

// ======================================================
// Socket.IO for dashboard (unchanged)
// ======================================================
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

io.on("connection", (s) => {
  console.log("🟢 Dashboard connected:", s.id);
  s.on("disconnect", () => console.log("🔴 Dashboard disconnected:", s.id));
});

// Simple home route for Render root URL
app.get("/", (req, res) => {
  res.send("✅ MostlyPostly is running! Use /dashboard or /status to check system health.");
});

// ======================================================
// 🚀 Start
// ======================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ MostlyPostly running on http://localhost:${PORT}`);
  console.log(`🔎 Try: http://localhost:${PORT}/public/ok.txt`);
});
