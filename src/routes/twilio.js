// src/routes/twilio.js — unified Twilio SMS/MMS router for MostlyPostly
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import { handleIncomingMessage } from "../core/messageRouter.js";
import { moderateAIOutput } from "../utils/moderation.js";
import { createLogger } from "../utils/logHelper.js";
import { savePost } from "../../db.js";

const MessagingResponse = twilio.twiml.MessagingResponse;
const log = createLogger("app");

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

      if (!from) {
        console.warn("⚠️ Missing sender (From)");
        twiml.message("⚠️ No sender found.");
        return res.type("text/xml").send(twiml.toString());
      }

      const stylist = lookupStylist(from) || {
        stylist_name: "SMS User",
        salon_name: "Rejuve Salon Spa",
        city: "Carmel",
      };

      // 📸 Get image if any
      let imageUrl = null;
      if (numMedia > 0) {
        imageUrl = req.body[`MediaUrl${numMedia - 1}`];
        console.log("📸 Twilio photo URL:", imageUrl);
      }

      const command = text.toUpperCase();

      // ------------------------------------------
      // 1️⃣ RESET (formerly CANCEL)
      // ------------------------------------------
      if (command === "RESET") {
        drafts.delete(from);
        twiml.message("♻️ Reset complete. Your previous draft has been cleared. Send a new photo to start over.");
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

        console.log("📡 [Twilio] Approving post for Facebook...");
        try {
          const caption = draft.final_caption || draft.caption;
          const fbLink = "✅ Facebook post created. (Simulation for SMS)";
          await savePost(from, stylist, caption, caption, caption);

          twiml.message(`✅ Approved and posted!\n\n${caption}\n\n${fbLink}`);
          drafts.delete(from);
        } catch (err) {
          console.error("🚫 [Twilio] Facebook post failed:", err);
          twiml.message("⚠️ Approved but failed to post to Facebook.");
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

          const preview = `
💇‍♀️ MostlyPostly Preview (Full Post)

${aiJson.caption}

Styled by ${stylist.stylist_name}
IG: https://instagram.com/${stylist.instagram_handle || "yourstylist"}

${(aiJson.hashtags || []).join(" ")}

${aiJson.cta}
Book: ${stylist.booking_url || "https://booking.rejuvesalonandspa.com"}

Reply APPROVE to continue, REGENERATE, or RESET to start over.
`.trim();

          twiml.message(preview);
        } catch (err) {
          console.error("⚠️ [Twilio] Regeneration failed:", err);
          twiml.message("⚠️ Could not regenerate caption. Try again later.");
        }

        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 4️⃣ NEW IMAGE — run unified router
      // ------------------------------------------
      if (imageUrl) {
        console.log("📸 [Twilio] New image received:", imageUrl);

        const sendMessage = {
          sendText: async (_, msg) => twiml.message(msg),
          sendPhoto: async (_, _photo, caption) => twiml.message(caption),
        };

        await handleIncomingMessage({
          source: "twilio",
          chatId: from,
          text,
          imageUrl,
          drafts,
          safeGenerateCaption,
          moderateAIOutput,
          sendMessage,
        });

        return res.type("text/xml").send(twiml.toString());
      }

      // ------------------------------------------
      // 5️⃣ Default fallback
      // ------------------------------------------
      twiml.message("📸 Please send a photo with a short note (like 'balayage' or 'men’s cut').");
      res.type("text/xml").send(twiml.toString());
    } catch (err) {
      console.error("❌ Twilio route error:", err);
      twiml.message("⚠️ Something went wrong. Try again soon.");
      res.type("text/xml").send(twiml.toString());
    }
  });

  return router;
}
