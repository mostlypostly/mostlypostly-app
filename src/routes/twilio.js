// src/routes/twilio.js — unified message router integration for SMS/MMS
import express from "express";
import bodyParser from "body-parser";
import { handleIncomingMessage } from "../core/messageRouter.js";
import { publishToFacebook } from "../publishers/facebook.js";
import { moderateAIOutput } from "../utils/moderation.js";
import { savePost } from "../../db.js";
import { createLogger } from "../utils/logHelper.js";
import twilio from "twilio";
const { MessagingResponse } = twilio;


const log = createLogger("app"); // or "scheduler", "moderation", etc.

export default function twilioRoute(drafts, lookupStylist, safeGenerateCaption) {
  const router = express.Router();
  router.use(bodyParser.urlencoded({ extended: true }));

  router.post("/", async (req, res) => {
    console.log("🔔 Twilio webhook hit!");
    const twiml = new MessagingResponse();

    try {
      const from = req.body.From;
      const text = (req.body.Body || "").trim();
      const numMedia = parseInt(req.body.NumMedia || "0", 10);
      const stylist = lookupStylist(from) || {
        stylist_name: "SMS User",
        salon_name: "Rejuve Salon Spa",
        city: "Carmel"
      };

      if (!from) {
        console.warn("⚠️ Missing sender (From)");
        twiml.message("⚠️ No sender found.");
        return res.type("text/xml").send(twiml.toString());
      }

      // 📸 Get media URL if present
      let imageUrl = null;
      if (numMedia > 0) {
        imageUrl = req.body[`MediaUrl${numMedia - 1}`];
        console.log("📸 Twilio photo URL:", imageUrl);
      }

      const command = text.toUpperCase();
      const sendMessage = async (_chatId, message) => {
        twiml.message(message);
      };

      // ------------------------------------------
      // 1️⃣ CANCEL
      // ------------------------------------------
      if (command === "CANCEL") {
        drafts.delete(from);
        twiml.message("🛑 Cancelled. No action taken.");
        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 2️⃣ APPROVE
      // ------------------------------------------
      if (command === "APPROVE") {
        const draft = drafts.get(from);
        if (!draft) {
          twiml.message("⚠️ No draft found. Please send a photo first.");
          return res.type("text/xml").send(twiml.toString());
        }

        const caption = `${draft.caption}\n\n${(draft.hashtags || []).join(" ")}\n\n_${draft.cta}_`;
        const image = draft.image_url || imageUrl || null;

        console.log("📡 [Twilio] Approving post for Facebook...", {
          salon: stylist?.salon_name,
          stylist: stylist?.stylist_name,
          image
        });

        try {
          const fbResult = await publishToFacebook(process.env.FACEBOOK_PAGE_ID, caption, image);
          const fbLink = fbResult?.post_id
            ? `https://facebook.com/${fbResult.post_id.replace("_", "/posts/")}`
            : "✅ Facebook post created, but link unavailable.";

          // Save post to DB/dashboard
          await savePost(from, stylist, caption, caption, caption);

          twiml.message(
            `✅ Approved and posted!\n\n${draft.caption}\n\n${(draft.hashtags || []).join(
              " "
            )}\n\n_${draft.cta}_\n\n📍 ${fbLink}\n\n💾 Saved to dashboard.`
          );
          drafts.delete(from);
        } catch (err) {
          console.error("🚫 [Twilio] Facebook post failed:", err);
          twiml.message("⚠️ Approved but failed to post to Facebook. Check logs for details.");
        }

        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 3️⃣ REGENERATE
      // ------------------------------------------
      if (command === "REGENERATE") {
        const draft = drafts.get(from);
        if (!draft?.image_url) {
          twiml.message("⚠️ No previous image found. Please send a new photo first.");
          return res.type("text/xml").send(twiml.toString());
        }

        twiml.message("🔄 Regenerating a fresh caption...");
        try {
          const aiJson = await safeGenerateCaption(
            draft.image_url,
            draft.original_notes || "",
            stylist?.city || "",
            stylist
          );
          aiJson.image_url = draft.image_url;
          aiJson.original_notes = draft.original_notes;
          drafts.set(from, aiJson);

          const preview = `💇‍♀️ *MostlyPostly Preview (Regenerated)*\n\n${aiJson.caption}\n\n${(
            aiJson.hashtags || []
          ).join(" ")}\n\n_${aiJson.cta}_\n\nReply APPROVE to post to Facebook, or REGENERATE, or CANCEL.`;

          twiml.message(preview);
        } catch (err) {
          console.error("⚠️ [Twilio] Regeneration failed:", err);
          twiml.message("⚠️ Could not regenerate caption. Try again later.");
        }

        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 4️⃣ NEW PHOTO or NOTE
      // ------------------------------------------
      if (imageUrl) {
        console.log("📸 [Twilio] New image received:", imageUrl);
        const aiJson = await safeGenerateCaption(imageUrl, text || "", stylist?.city || "", stylist);
        aiJson.image_url = imageUrl;
        aiJson.original_notes = text;

        const { safe, result } = moderateAIOutput(aiJson, text);
        if (!safe) {
          console.log("🚫 [Twilio] Moderation blocked:", result);
          twiml.message(
            "⚠️ This caption or note was flagged for inappropriate content and will not be posted.\n\nPlease send a new photo and caption focused on salon, spa, or beauty services."
          );
          drafts.delete(from);
          return res.type("text/xml").send(twiml.toString());
        }

        drafts.set(from, result);

        const preview = `💇‍♀️ MostlyPostly Preview\n\n${result.caption}\n\n${(
          result.hashtags || []
        ).join(" ")}\n\n_${result.cta}_\n\nReply APPROVE to post to Facebook, or REGENERATE, or CANCEL.`;

        twiml.message(preview);
        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 5️⃣ Fallback — no image or command
      // ------------------------------------------
      twiml.message("📸 Please send a photo with a short note (like 'blonde highlights' or 'balayage').");
      res.type("text/xml").send(twiml.toString());
    } catch (err) {
      console.error("❌ Twilio route error:", err);
      twiml.message("⚠️ Something went wrong. Try again soon.");
      res.type("text/xml").send(twiml.toString());
    }
  });

  return router;
}
