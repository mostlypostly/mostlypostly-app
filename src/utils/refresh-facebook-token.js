// src/utils/refresh-facebook-token.js
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const appId = process.env.FACEBOOK_APP_ID;
const appSecret = process.env.FACEBOOK_APP_SECRET;
const userToken = process.env.FACEBOOK_USER_TOKEN; // your long-lived user token

async function refreshToken() {
  try {
    console.log("🔁 Refreshing long-lived Facebook Page token...");

    const url = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${userToken}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.access_token) {
      console.log("✅ Refreshed long-lived user token:", data.access_token);
      console.log("💡 Copy this token into .env as FACEBOOK_USER_TOKEN (and re-run /me/accounts to get your Page token again).");
    } else {
      console.error("❌ Failed to refresh token:", data);
    }
  } catch (err) {
    console.error("⚠️ Error refreshing token:", err);
  }
}

refreshToken();
