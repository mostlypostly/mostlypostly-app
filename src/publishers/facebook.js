// src/publishers/facebook.js — multi-tenant aware, simple + robust
import fetch from "node-fetch";

/**
 * Publish a post to a Facebook Page.
 *
 * @param {string} pageId              - Facebook Page ID
 * @param {string} caption             - Post caption text
 * @param {string|null} imageUrl       - Public URL of image to post (already rehosted)
 * @param {string|null} tokenOverride  - Optional page access token to use instead of env defaults
 */
export async function publishToFacebook(
  pageId,
  caption,
  imageUrl = null,
  tokenOverride = null
) {
  if (!pageId || typeof pageId !== "string") {
    console.error("❌ [Facebook] Invalid pageId:", pageId);
    throw new Error("Facebook publisher received invalid pageId");
  }

  const token =
    tokenOverride ||
    process.env.FACEBOOK_PAGE_TOKEN ||
    process.env.FACEBOOK_SYSTEM_USER_TOKEN;

  if (!token) {
    throw new Error(
      "Missing Facebook access token (no salon token and no env token)"
    );
  }

  const safeCaption = (caption || "").toString().slice(0, 2200);
  const endpointPhoto = `https://graph.facebook.com/v19.0/${pageId}/photos`;
  const endpointFeed = `https://graph.facebook.com/v19.0/${pageId}/feed`;

  console.log(
    `🚀 [Facebook] Posting to pageId=${pageId} hasImage=${!!imageUrl} usingTokenOverride=${!!tokenOverride}`
  );

  // If we have a usable image URL, try a photo post first
  if (imageUrl && typeof imageUrl === "string") {
    try {
      console.log("📤 [Facebook] Attempting photo post with URL…");
      const res = await fetch(endpointPhoto, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: safeCaption,
          url: imageUrl,
          access_token: token,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data?.error?.message || "Unknown FB photo error";
        console.warn("⚠️ [Facebook] Photo upload failed:", msg);
        // fall through to text-only feed post
      } else {
        console.log("✅ [Facebook] Photo post success:", data);
        return data;
      }
    } catch (err) {
      console.warn(
        "⚠️ [Facebook] Photo upload threw error, will fallback to feed:",
        err.message
      );
      // continue to feed fallback
    }
  }

  // Fallback: text-only feed post
  console.log("ℹ️ [Facebook] Falling back to text-only feed post…");
  const feedRes = await fetch(endpointFeed, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: safeCaption,
      access_token: token,
    }),
  });

  const feedData = await feedRes.json();
  if (!feedRes.ok || feedData.error) {
    const msg = feedData?.error?.message || "Unknown FB feed error";
    console.error("❌ [Facebook] Feed post failed:", msg);
    throw new Error(msg);
  }

  console.log("✅ [Facebook] Feed post success:", feedData);
  return feedData;
}
