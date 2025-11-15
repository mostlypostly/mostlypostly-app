// src/publishers/instagram.js — multi-tenant + safe enhancements
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { rehostTwilioMedia } from "../utils/rehostTwilioMedia.js";
import { getSalonPolicy } from "../scheduler.js";
import { logEvent } from "../core/analyticsDb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_GRAPH_VER = process.env.FB_GRAPH_VERSION || "v24.0";
const DEFAULT_IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const DEFAULT_FB_TOKEN = process.env.FACEBOOK_GRAPH_TOKEN;
const IG_MEDIA_MAX_WAIT_MS = Number(process.env.IG_MEDIA_MAX_WAIT_MS || 30000);
const IG_MEDIA_POLL_INTERVAL_MS = Number(
  process.env.IG_MEDIA_POLL_INTERVAL_MS || 1500
);

const HOST_BASE =
  process.env.PUBLIC_BASE_URL ||
  process.env.HOST ||
  `http://localhost:${process.env.PORT || 3000}`;
const PUBLIC_DIR =
  process.env.PUBLIC_DIR || path.resolve(process.cwd(), "public");

async function saveToPublic(jpgBuffer, filenameBase = Date.now().toString()) {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const fileName = `${filenameBase}.jpg`;
  const fullPath = path.join(PUBLIC_DIR, fileName);
  await fs.writeFile(fullPath, jpgBuffer);
  return `${HOST_BASE}/public/${fileName}`;
}

/**
 * Ensure we have a publicly accessible image URL.
 * - Twilio MMS → rehost via rehostTwilioMedia (per-salon)
 * - Telegram files → mirror into /public
 * - Already public URLs → pass through
 */
async function ensurePublicImage(imageUrl, nameHint, salonId) {
  if (!imageUrl) throw new Error("Missing imageUrl");

  // Twilio-hosted MMS: rehost to our public CDN
  if (/^https:\/\/api\.twilio\.com\//i.test(imageUrl)) {
    console.log("🔄 [Instagram] Rehosting Twilio image…");
    return await rehostTwilioMedia(imageUrl, salonId || null);
  }

  // Telegram direct file: fetch and mirror into /public
  if (/^https:\/\/api\.telegram\.org\/file\//i.test(imageUrl)) {
    const resp = await fetch(imageUrl);
    if (!resp.ok)
      throw new Error(`Telegram file fetch failed (${resp.status})`);
    const arr = await resp.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length < 1000)
      throw new Error("Downloaded image appears empty (size < 1KB).");
    const publicUrl = await saveToPublic(buf, nameHint);
    return publicUrl;
  }

  // Already public
  return imageUrl;
}

async function createIgMedia({ userId, imageUrl, caption, token, graphVer }) {
  const url = `https://graph.facebook.com/${graphVer}/${userId}/media`;
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption: caption || "",
    access_token: token,
  });
  const resp = await fetch(url, { method: "POST", body: params });
  const data = await resp.json();
  if (!resp.ok || !data?.id)
    throw new Error(
      `IG media create failed: ${resp.status} ${JSON.stringify(data)}`
    );
  return data.id;
}

async function waitForContainer(creationId, token, graphVer) {
  const deadline = Date.now() + IG_MEDIA_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const url = `https://graph.facebook.com/${graphVer}/${creationId}?fields=status_code&access_token=${encodeURIComponent(
      token
    )}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const status = data?.status_code || "UNKNOWN";
    if (status === "FINISHED") return true;
    if (status === "ERROR") throw new Error("IG container ERROR status");
    await new Promise((r) => setTimeout(r, IG_MEDIA_POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for IG container to finish.");
}

async function publishContainer(creationId, userId, token, graphVer) {
  const url = `https://graph.facebook.com/${graphVer}/${userId}/media_publish`;
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });
  const resp = await fetch(url, { method: "POST", body: params });
  const data = await resp.json();
  if (!resp.ok || !data?.id)
    throw new Error(
      `IG media publish failed: ${resp.status} ${JSON.stringify(data)}`
    );
  return data;
}

// tiny retry wrapper (non-breaking)
async function retryIg(fn, label, retries = 2, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === retries) break;
      console.warn(
        `⚠️ [Instagram] Retry ${i + 1}/${retries} on ${label}:`,
        err.message
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * publishToInstagram({ salon_id, caption, imageUrl })
 * - Uses salon-specific credentials when available; falls back to env.
 */
export async function publishToInstagram(input) {
  const { salon_id, caption, imageUrl } = input;
  console.log(
    `📷 [Instagram] Start publish for salon_id=${salon_id || "global"}`
  );

    // -------------------------------------------------------
    // Instagram Caption Rules
    // -------------------------------------------------------
    // - Convert HTML IG handle links → @handle
    // - Always include "Book via link in bio."
    let igCaption = (caption || "").trim();

    // Convert any HTML Instagram profile link to plain @handle
    igCaption = igCaption.replace(
      /<a[^>]*href="https?:\/\/instagram\.com\/([^"]+)"[^>]*>@[^<]+<\/a>/gi,
      "@$1"
    );

    // Strip ALL URLs (after fixing IG handle)
    igCaption = igCaption.replace(/https?:\/\/\S+/gi, "").trim();

    // Ensure CTA exists
    if (!/book via link in bio/i.test(igCaption)) {
      igCaption += (igCaption ? "\n\n" : "") + "Book via link in bio.";
    }


  // Resolve salon config (JSON from /salons via getSalonPolicy)
  const salonConfig = salon_id ? getSalonPolicy(salon_id) : {};
  const salonInfo = salonConfig?.salon_info || {};

  // Graph version: salon override → salon_info override → default
  const graphVer =
    salonConfig?.graph_version ||
    salonInfo.graph_version ||
    DEFAULT_GRAPH_VER;

  // Instagram "user id" for Graph API:
  // - Prefer salon-specific instagram_user_id
  // - Then salon_info.instagram_business_id / instagram_biz_id
  // - Then global env INSTAGRAM_USER_ID
  const userId =
    salonConfig?.instagram_user_id ||
    salonInfo.instagram_user_id ||
    salonInfo.instagram_business_id ||
    salonInfo.instagram_biz_id ||
    DEFAULT_IG_USER_ID;

  // Access token:
  // - Prefer salon-specific facebook_graph_token
  // - Then salon_info.facebook_page_token
  // - Then global env FACEBOOK_GRAPH_TOKEN
  const token =
    salonConfig?.facebook_graph_token ||
    salonInfo.facebook_graph_token ||
    salonInfo.facebook_page_token ||
    DEFAULT_FB_TOKEN;

  if (!token || !userId) {
    console.warn("[Instagram] Missing IG creds", {
      salon_id,
      hasUserId: !!userId,
      hasToken: !!token,
    });
    throw new Error("Missing Instagram credentials (token or userId).");
  }

  // Ensure image is public (Twilio/Telegram safe)
  const publicImageUrl = await ensurePublicImage(
    imageUrl,
    Date.now().toString(),
    salon_id
  );
  console.log("🌐 [Instagram] Public image URL:", publicImageUrl);

  try {
    const creationId = await retryIg(
      () =>
        createIgMedia({
          userId,
          imageUrl: publicImageUrl,
          caption: igCaption,
          token,
          graphVer,
        }),
      "media create"
    );
    console.log("✅ [Instagram] creation_id:", creationId);

    await waitForContainer(creationId, token, graphVer);

    const publishRes = await retryIg(
      () => publishContainer(creationId, userId, token, graphVer),
      "media publish"
    );
    console.log("✅ [Instagram] published:", publishRes);

    if (publishRes?.id) {
      logEvent({
        event: "instagram_publish_success",
        salon_id,
        data: { media_id: publishRes.id, image_url: publicImageUrl },
      });
      return { id: publishRes.id, status: "success" };
    }

    console.warn("⚠️ [Instagram] No post ID returned:", publishRes);
    logEvent({
      event: "instagram_publish_unknown",
      salon_id,
      data: { publishRes },
    });
    return { id: null, status: "unknown" };
  } catch (err) {
    console.error("❌ [Instagram] Publish failed:", err.message);
    logEvent({
      event: "instagram_publish_failed",
      salon_id,
      data: { error: err.message },
    });
    throw err;
  }
}
