// src/routes/telegram.js — unified + loop-protected Telegram webhook for MostlyPostly v0.5

import express from "express";
import fetch from "node-fetch";
import { handleIncomingMessage } from "../core/messageRouter.js";
import { moderateAIOutput } from "../utils/moderation.js";
import { savePost } from "../core/storage.js";
import { createLogger } from "../utils/logHelper.js";
import { saveStylistConsent } from "../core/storage.js";
import { lookupStylist, lookupManager } from "../core/salonLookup.js";



const log = createLogger("app"); // or "scheduler", "moderation", etc.

console.log("✅ Telegram route loaded successfully.");

export default function telegramRoute(drafts, lookupStylist, safeGenerateCaption) {
  const router = express.Router();

  // -----------------------------------------
  // 📨 Telegram send helpers
  // -----------------------------------------
  async function sendText(chatId, text) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "Markdown"
          })
        }
      );

      const data = await resp.json();
      console.log("📨 Telegram message sent:", data);
      return data;
    } catch (err) {
      console.error("⚠️ Failed to send Telegram text message:", err);
    }
  }

  async function sendPhoto(chatId, imageUrl, caption = "") {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            photo: imageUrl,
            caption,
            parse_mode: "Markdown"
          })
        }
      );

      const data = await resp.json();
      console.log("🖼️ Telegram photo sent:", data);
      return data;
    } catch (err) {
      console.error("⚠️ Failed to send Telegram photo:", err);
    }
  }

  // -----------------------------------------
  // ✅ Unified callable sendMessage function
  // -----------------------------------------
  const sendMessage = async (chatId, text) => {
    return await sendText(chatId, text);
  };
  sendMessage.sendText = sendText;
  sendMessage.sendPhoto = sendPhoto;

  // -----------------------------------------
  // 🔔 Main Telegram webhook
  // -----------------------------------------
  router.post("/webhook", async (req, res) => {
    try {
      console.log("🔔 Telegram webhook hit!");
      const body = req.body;
      const message = body.message || body.edited_message || {};
      const chatId = message.chat?.id;
      const text = (message.caption || message.text || "").trim();

              // ✅ Handle consent reply
if (text.toUpperCase() === "AGREE") {
  console.log(`🧾 Consent reply detected from ${chatId}`);

  const timestamp = new Date().toISOString();
  const payload = {
    compliance_opt_in: true,
    compliance_timestamp: timestamp,
    consent: { sms_opt_in: true, timestamp }
  };

  try {
    const stylist = lookupStylist(chatId);
    const manager = lookupManager?.(chatId);
    const profile = stylist || manager;
    const profileKey = profile?.phone;

    if (!profileKey) {
      console.warn(`⚠️ Consent attempt from ${chatId} failed — user not found.`);
      await sendText(
        chatId,
        "⚠️ We couldn’t find your profile. Please ask your manager to add you using the JOIN command before agreeing."
      );
      return res.sendStatus(200);
    }

    const result = saveStylistConsent(profileKey, payload);
    console.log("💾 Consent persistence result:", result);

    await loadSalons(); // refresh cachedSalons so router sees new consent

    await sendText(chatId, "✅ Thanks! You’re now opted-in to MostlyPostly updates.");
    // ✅ STOP execution here so it doesn't fall through to handleIncomingMessage()
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Consent persistence failed:", err);
    await sendText(
      chatId,
      "⚠️ Sorry, something went wrong saving your consent. Please try again."
    );
    return res.sendStatus(200);
  }
}

      const photo = message.photo;
      const fromId = message.from?.id;
      const isFromBot = message.from?.is_bot;
      const now = Math.floor(Date.now() / 1000);

      // 🚫 Ignore self-messages and invalid payloads
      if (!chatId || !fromId || isFromBot) {
        console.log("⚙️ Ignoring bot-originated or invalid message.");
        return res.sendStatus(200);
      }

      // 🚫 Optional: ignore stale updates older than 60s
      if (message.date && now - message.date > 60) {
        console.log("⏳ Ignoring old Telegram update.");
        return res.sendStatus(200);
      }

      // -----------------------------------------
      // 📸 Resolve Telegram photo (if sent)
      // -----------------------------------------
      let fileUrl = null;
      if (photo && photo.length > 0) {
        const fileId = photo[photo.length - 1].file_id;
        const resp = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        const data = await resp.json();
        if (data.ok && data.result?.file_path) {
          fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
          console.log("📸 Telegram file URL:", fileUrl);
        } else {
          console.warn("⚠️ Could not resolve Telegram file path:", data);
        }
      }

      // -----------------------------------------
      // 🧠 Delegate to Unified Message Router
      // -----------------------------------------
      const io = req.app.get("io");

      console.time("⏱ handleIncomingMessage");
      await handleIncomingMessage({
        source: "telegram",
        chatId,
        text,
        imageUrl: fileUrl,
        drafts,
        lookupStylist,
        safeGenerateCaption,
        moderateAIOutput,
        savePost,
        sendMessage,
        io
      });
      console.timeEnd("⏱ handleIncomingMessage");

      // ✅ Always respond 200 to prevent Telegram retries
      res.sendStatus(200);
    } catch (err) {
      console.error("❌ Telegram route error:", err);
      res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
  });

  return router;
}
