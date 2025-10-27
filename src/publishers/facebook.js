// src/publishers/facebook.js — MostlyPostly NPE-safe permanent publisher
import fetch from "node-fetch";

/**
 * Publishes a post or photo to a Facebook Page.
 * Uses the Page token if present; otherwise falls back to the permanent System-User token.
 * Compatible with the New Pages Experience (requires /me/feed or /me/photos).
 */
export async function publishToFacebook(pageId, caption, imageUrl = null) {
  // Choose the correct token
  const token =
    process.env.FACEBOOK_PAGE_TOKEN ||
    process.env.FACEBOOK_SYSTEM_USER_TOKEN;

  if (!token) {
    throw new Error(
      "❌ Missing Facebook access token (FACEBOOK_PAGE_TOKEN or FACEBOOK_SYSTEM_USER_TOKEN)"
    );
  }

  const tokenType = process.env.FACEBOOK_PAGE_TOKEN
    ? "Page Token"
    : "System User Token";

  console.log(`🚀 Posting to Facebook Page ID: ${pageId}`);
  console.log(`🔑 Using token type: ${tokenType}`);

  // --- Build request ---
  const endpoint = imageUrl
    ? "https://graph.facebook.com/v19.0/me/photos"
    : "https://graph.facebook.com/v19.0/me/feed";

  // Form data (preferred by Graph API for media uploads)
  const payload = imageUrl
    ? { caption, url: imageUrl, access_token: token }
    : { message: caption, access_token: token };

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("🚫 Facebook API Error:", JSON.stringify(data, null, 2));
      throw new Error(data.error?.message || "Facebook API request failed");
    }

    console.log("✅ Facebook API Response:", data);
    return data;
  } catch (err) {
    console.error("❌ Facebook post failed:", err.message);
    throw err;
  }
}
