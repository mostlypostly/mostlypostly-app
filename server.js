// =====================================================
// Core imports (unchanged)
// =====================================================
import fs from "fs";
import path from "path";
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
import "dotenv/config";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import http from "http";
import { Server } from "socket.io";
import { createLogger } from "./src/utils/logHelper.js";
import { lookupStylist } from "./src/core/salonLookup.js";


// =====================================================
// DB FIRST — load SQLite and open connection
// =====================================================
import { db } from "./db.js";

// =====================================================
// LOAD SALONS + START WATCHER ***THIS IS HOW IT ORIGINALLY WORKED***
// =====================================================
import {
  loadSalons,
  startSalonWatcher,
  getAllSalons,
} from "./src/core/salonLookup.js";

// ------------------------------------------------------
// 🔥 Salon watcher (WEB ONLY)
// ------------------------------------------------------
await loadSalons();
startSalonWatcher();
console.log("💇 Salons loaded and file watcher active.");

// =====================================================
// TENANT + SESSION MIDDLEWARES (must load before routes)
// =====================================================
import tenantFromLink from "./src/middleware/tenantFromLink.js";

// =====================================================
// SCHEMA INIT (AFTER DB + SALONS, BEFORE ANALYTICS & ROUTES)
// =====================================================
import { initSchemaHealth } from "./src/core/initSchemaHealth.js";
initSchemaHealth();

// =====================================================
// ANALYTICS DB (AFTER schema exists, BEFORE routes)
// =====================================================
import "./src/core/analyticsDb.js";

// =====================================================
// CORE LOGIC LOAD (original order)
// =====================================================
import { composeFinalCaption } from "./src/core/composeFinalCaption.js";
import {
  handleJoinCommand,
  continueJoinConversation,
} from "./src/core/joinManager.js";
import { joinSessions } from "./src/core/joinSessionStore.js";
import { generateCaption } from "./src/openai.js";

// =====================================================
// ROUTES — MUST load AFTER salons + tenant middleware
// =====================================================
import dashboardRoute from "./src/routes/dashboard.js";
import postsRoute from "./src/routes/posts.js";
import analyticsRoute from "./src/routes/analytics.js";
import telegramRoute from "./src/routes/telegram.js";
import twilioRoute from "./src/routes/twilio.js";
import analyticsSchedulerRoute from "./src/routes/analyticsScheduler.js";
import managerRoute from "./src/routes/manager.js";
import facebookAuthRoutes from "./src/routes/facebookAuth.js";

// ==========================================
// Scheduler imports only (web never runs scheduler)
// ==========================================
import { enqueuePost, runSchedulerOnce } from "./src/scheduler.js";

// ==========================================
// WEB-ONLY guard
// ==========================================
if (process.env.APP_ROLE === "worker") {
  console.log("❌ server.js launched in worker mode — exiting.");
  process.exit(1);
}

console.log("WEB MODE: Scheduler disabled.");

// NOTE: Do NOT call startScheduler() in server.js.
// The background worker (worker.js) is responsible for starting the scheduler loop.



// ------------------------------------------------------
// 🚀 Initialize Express app
// ------------------------------------------------------
const app = express();

// Mount analytics API after app exists
app.use(tenantFromLink());
app.use("/api", analyticsRoute);


dotenv.config();
const log = createLogger("app");

// ------------------------------------------------------
// 🧩 Middleware order (important!)
// ------------------------------------------------------
app.use(cookieParser()); // must be before routes for /manager auth
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ------------------------------------------------------
// 🌍 Public static assets (uploads, ok.txt, etc.)
// ------------------------------------------------------
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "public/uploads"), {
    setHeaders(res, filePath) {
      if (/\.(jpg|jpeg)$/i.test(filePath))
        res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  })
);

// ------------------------------------------------------
// 🔌 Route mounting
// ------------------------------------------------------
app.use("/dashboard", dashboardRoute);
app.use("/posts", postsRoute);
app.use("/analytics", analyticsRoute);
app.use("/telegram", telegramRoute);
app.use("/twilio", twilioRoute);
app.use("/analyticsScheduler", analyticsSchedulerRoute);
app.use("/manager", managerRoute);
app.use("/auth/facebook", facebookAuthRoutes);

// ------------------------------------------------------
// 💡 Health & basic endpoints
// ------------------------------------------------------
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true, status: "healthy" });
});

app.get("/", (req, res) => {
  res.send("MostlyPostly API is running 🚀");
});

// ------------------------------------------------------
// ---------
// ------------------------------------------------------
app.get("/scheduler/run-now", async (req, res) => {
  const result = await runSchedulerOnce();
  res.json(result);
});

// Environment check
console.log("🌍 Environment OK — Tokens Loaded:", {
  TELEGRAM: !!process.env.TELEGRAM_BOT_TOKEN,
  FB_PAGE: process.env.FACEBOOK_PAGE_ID || "unset",
  FB_TOKEN: process.env.FACEBOOK_PAGE_TOKEN ? "✅ (truncated)" : "❌ missing",
});

// ======================================================
// Public static files
// ======================================================
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(process.cwd(), "public");
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
const okPath = path.join(PUBLIC_DIR, "ok.txt");
if (!fs.existsSync(okPath)) fs.writeFileSync(okPath, "ok\n");

app.use("/public", express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=600");
    }
  }
}));

// ======================================================
// Health & Admin
// ======================================================
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.post("/admin/reload-salons", async (_req, res) => {
  try {
    const snap = await reloadSalonsNow();
    res.json({ ok: true, ...snap });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/admin/salons", (_req, res) => {
  try {
    const salons = getAllSalons().map(s => ({
      name: s.salon_info?.name,
      city: s.salon_info?.city,
      manager_approval: !!s.salon_info?.settings?.require_manager_approval,
    }));
    res.json({ ok: true, count: salons.length, salons });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================================
// Helpers
// ======================================================
function normalizePhone(v = "") {
  const digits = (v + "").replace(/\D+/g, "");
  if (digits.startsWith("1") && digits.length === 11) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (v.startsWith("+")) return v;
  return "+" + digits;
}

async function fetchTwilioImageAsBase64(url) {
  const resp = await fetch(url, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
    },
  });
  if (!resp.ok) throw new Error(`Twilio image fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
}

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
  } catch (err) {
    console.error("⚠️ Failed to log post:", err);
  }
}

// ======================================================
// 🧩 JOIN (Manager onboarding + stylist creation)
// ======================================================
app.post("/inbound/join", async (req, res) => {
  const from = req.body.From || req.body.chat_id;
  const text = (req.body.Body || req.body.text || "").trim();
  const sendMessage = async (to, message) => {
    console.log(`📩 [JOIN MSG to ${to}] ${message}`);
    // In production you’d send this via Twilio or Telegram
  };

  // Handle new join start
  if (/^JOIN\b/i.test(text)) {
    await handleJoinCommand(from, lookupStylist, text, sendMessage);
    return res.json({ ok: true, action: "start" });
  }

  // Continue join conversation if already started
  if (joinSessions.has(from)) {
    const result = await continueJoinConversation(from, text, sendMessage);
    return res.json({ ok: true, action: result.done ? "complete" : "continue" });
  }

  res.json({ ok: false, message: "No active join session." });
});

// ======================================================
// Express Routes
// ======================================================
const drafts = new Map();

app.use("/analytics/scheduler", analyticsSchedulerRoute);

app.use(
  "/inbound/telegram",
  telegramRoute(drafts, lookupStylist, ({ imageUrl, notes, stylist, salon }) =>
    generateCaption({
      imageDataUrl: imageUrl,
      notes,
      salon,
      stylist,
      city: stylist?.city || ""
    })
  )
);

app.use(
  "/inbound/twilio",
  twilioRoute(drafts, lookupStylist, ({ imageUrl, notes, stylist, salon }) =>
    generateCaption({
      imageDataUrl: imageUrl,
      notes,
      salon,
      stylist,
      city: stylist?.city || ""
    })
  )
);

app.use("/dashboard", dashboardRoute);
app.use("/posts", postsRoute);
app.use("/analytics", analyticsRoute);

app.get("/", (_req, res) =>
  res.send("✅ MostlyPostly is running! Use /dashboard or /status to check system health.")
);
app.get("/status", (_req, res) => res.json({ ok: true, version: "3.4.3" }));

// ======================================================
// Socket.IO for dashboard
// ======================================================
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

io.on("connection", (s) => {
  console.log("🟢 Dashboard connected:", s.id);
  s.on("disconnect", () => console.log("🔴 Dashboard disconnected:", s.id));
});

// ------------------------------------------------------
// 🗓️ Scheduler bootstrapping — ALWAYS RUN IN WEB SERVICE
// ------------------------------------------------------
import { startScheduler } from "./src/scheduler.js";

// Start scheduler unconditionally in web service
console.log("WEB MODE: Scheduler enabled (single-service mode).");
startScheduler();

// ------------------------------------------------------
// 🚀 Start server
// ------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 MostlyPostly ready at ${process.env.BASE_URL || "http://localhost:" + PORT}`);
  console.log(`💡 Health check: http://localhost:${PORT}/healthz`);
});
