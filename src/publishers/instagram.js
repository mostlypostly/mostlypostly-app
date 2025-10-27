// src/publishers/instagram.js
// MostlyPostly — Instagram publish with container status polling

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRAPH_VER = process.env.FB_GRAPH_VERSION || "v24.0";
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const FB_TOKEN = process.env.FACEBOOK_GRAPH_TOKEN;

// Optional tuning (ms)
const IG_MEDIA_MAX_WAIT_MS = Number(process.env.IG_MEDIA_MAX_WAIT_MS || 30000);
const IG_MEDIA_POLL_INTERVAL_MS = Number(process.env.IG_MEDIA_POLL_INTERVAL_MS || 1500);

// Your public base URL (ngrok or prod)
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ""; // e.g., https://your-ngrok-domain.ngrok-free.app

// Location to save rehosted images
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(process.cwd(), "public");

/**
 * Save a Buffer to /public and return the public URL to it.
 */
async function saveToPublic(jpgBuffer, filenameBase = Date.now().toString()) {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const fileName = `${filenameBase}.jpg`;
  const fullPath = path.join(PUBLIC_DIR, fileName);
  await fs.writeFile(fullPath, jpgBuffer);
  if (!PUBLIC_BASE_URL) {
    throw new Error("PUBLIC_BASE_URL is not set; cannot build public image URL.");
  }
  return `${PUBLIC_BASE_URL}/public/${fileName}`;
}

/**
 * Ensure the image URL is accessible by Instagram (public HTTPS URL).
 * - If Telegram file URL, download and rehost to PUBLIC_BASE_URL/public/*.jpg
 * - If already public (non-Telegram), return as is.
 */
async function ensurePublicImage(imageUrl, nameHint) {
  if (!imageUrl) throw new Error("Missing imageUrl");
  const isTelegramFile = /^https:\/\/api\.telegram\.org\/file\//i.test(imageUrl);

  if (!isTelegramFile) {
    // Assume it is already a public, direct URL.
    return imageUrl;
  }

  // Download from Telegram and rehost locally
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download Telegram file (${resp.status})`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const filenameBase = nameHint || Date.now().toString();
  const publicUrl = await saveToPublic(buf, filenameBase);
  console.log("📷 [instagram] using public image:", publicUrl);
  return publicUrl;
}

/**
 * Create IG media container.
 */
async function createIgMedia({ imageUrl, caption }) {
  const url = `https://graph.facebook.com/${GRAPH_VER}/${IG_USER_ID}/media`;
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption: caption || "",
    access_token: FB_TOKEN
  });

  const resp = await fetch(url, { method: "POST", body: params });
  const data = await resp.json();
  if (!resp.ok || !data?.id) {
    throw new Error(
      `IG media create failed: ${resp.status} ${JSON.stringify(data)}`
    );
  }
  return data.id; // creation_id
}

/**
 * Poll container status until FINISHED or timeout.
 * GET /{creation_id}?fields=status_code
 * Possible status_code: IN_PROGRESS, FINISHED, ERROR
 */
async function waitForContainer(creationId, { maxWaitMs, pollIntervalMs } = {}) {
  const deadline = Date.now() + (maxWaitMs ?? IG_MEDIA_MAX_WAIT_MS);
  const interval = pollIntervalMs ?? IG_MEDIA_POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    const url = `https://graph.facebook.com/${GRAPH_VER}/${creationId}?fields=status_code&access_token=${encodeURIComponent(FB_TOKEN)}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(`IG container status failed: ${resp.status} ${JSON.stringify(data)}`);
    }

    const status = data?.status_code || "UNKNOWN";
    // console.log("🕒 [instagram] container status:", status);

    if (status === "FINISHED") return true;
    if (status === "ERROR") throw new Error("IG container entered ERROR status.");

    // IN_PROGRESS or unknown: wait then retry
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Timed out waiting for IG container to finish.");
}

/**
 * Publish the processed container.
 */
async function publishContainer(creationId) {
  const url = `https://graph.facebook.com/${GRAPH_VER}/${IG_USER_ID}/media_publish`;
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: FB_TOKEN
  });

  const resp = await fetch(url, { method: "POST", body: params });
  const data = await resp.json();
  if (!resp.ok || !data?.id) {
    throw new Error(`IG media publish failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Public entry: publish to Instagram
 * @param {Object} opts
 * @param {string} opts.imageUrl - source image (Telegram file URL or public URL)
 * @param {string} opts.caption  - final IG caption (with @handle, no IG URL line)
 * @param {string} [opts.postId] - optional hint to name the local rehost file
 */
export async function publishToInstagram({ imageUrl, caption, postId }) {
  if (!IG_USER_ID || !FB_TOKEN) {
    throw new Error("INSTAGRAM_USER_ID or FACEBOOK_GRAPH_TOKEN missing.");
  }

  // 1) Ensure public image URL
  const publicImageUrl = await ensurePublicImage(imageUrl, postId);

  // 2) Create container
  const creationId = await createIgMedia({ imageUrl: publicImageUrl, caption });
  console.log("✅ [instagram] creation_id:", creationId);

  // 3) Wait for FINISHED
  await waitForContainer(creationId);

  // 4) Publish
  const publishRes = await publishContainer(creationId);
  console.log("✅ [instagram] published:", publishRes);
  return { media_id: publishRes.id };
}
