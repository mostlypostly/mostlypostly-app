// src/core/messageRouter.js
// MostlyPostly v0.5.15 — FB vs IG "Styled by" rules + IG rehost + consent + formatting

import { publishToFacebook } from "../publishers/facebook.js";
import { publishToInstagram } from "../publishers/instagram.js";
import { handleJoinCommand, continueJoinConversation } from "./joinManager.js";
import { isJoinInProgress } from "./joinSessionStore.js";
import {
  lookupStylist,
  getSalonByStylist,
  loadSalons,
} from "./salonLookup.js";
import {
  savePost,
  updatePostStatus,
  findPendingPostByManager,
  findPostAwaitingReason,
  saveStylistConsent,
} from "../core/storage.js";
import { composeFinalCaption } from "./composeFinalCaption.js";

// --------------------------------------
// Resolve a usable image URL from records
function resolveImageUrl(pending, draft) {
  return (
    pending?.image_url ||
    pending?.media_url ||
    pending?.source_image_url ||
    pending?.image ||
    draft?.image_url ||
    draft?.image ||
    null
  );
}

// --------------------------------------
// Timing helpers
function startTimer() { return performance.now(); }
function endTimer(start, label = "handleIncomingMessage") {
  const elapsed = (performance.now() - start).toFixed(2);
  console.log(`⏱ ${label}: ${elapsed}ms`);
}

// --------------------------------------
// Identity helpers
function getStylistName(stylist) {
  return (
    (stylist?.stylist_name ||
      stylist?.name ||
      stylist?.display_name ||
      stylist?.full_name ||
      "").toString().trim() || "Unknown Stylist"
  );
}
function getStylistHandle(stylist) {
  const raw = (
    stylist?.instagram_handle ||
    stylist?.ig ||
    stylist?.instagram ||
    ""
  ).toString().trim();
  const clean = raw.replace(/^@+/, "");
  return clean || null;
}

// --------------------------------------
// Formatting utilities
function prettifyBody(body) {
  const srcLines = String(body || "").split("\n");
  const out = [];

  const isStyled = (s) => /^Styled by /.test(s);
  const isIG = (s) => /^IG:\s/.test(s);
  const isHashtag = (s) => /^#/.test(s);
  const isCTA = (s) => /^_.*_$/.test(s) || /^Book\b/i.test(s) || /^Schedule\b/i.test(s);
  const isBooking = (s) => /^Book:\s/i.test(s);

  for (let i = 0; i < srcLines.length; i++) {
    const ln = srcLines[i].replace(/\s+$/g, "");
    const prev = out.length ? out[out.length - 1] : "";
    const prevTrim = prev.trim();

    const curStyled = isStyled(ln);
    const curIG = isIG(ln);
    const curHashtag = isHashtag(ln);
    const curCTA = isCTA(ln);
    const curBooking = isBooking(ln);

    let needBlankBefore = false;

    if (curStyled) {
      if (out.length && prevTrim !== "") needBlankBefore = true;
    } else if (curIG) {
      if (!isStyled(prevTrim) && prevTrim !== "") needBlankBefore = true;
    } else if (curHashtag) {
      if (!isHashtag(prevTrim) && prevTrim !== "") needBlankBefore = true;
    } else if (curCTA) {
      if (isHashtag(prevTrim)) needBlankBefore = true;
    } else if (curBooking) {
      if (prevTrim !== "" && !curCTA) needBlankBefore = true;
    }

    if (needBlankBefore && out.length && out[out.length - 1] !== "") out.push("");
    out.push(ln);
  }

  // Ensure exactly one blank line AFTER the LAST hashtag block
  let lastHashIdx = -1;
  for (let i = 0; i < out.length; i++) if (isHashtag(out[i].trim())) lastHashIdx = i;

  if (lastHashIdx >= 0) {
    let nextIdx = -1;
    for (let j = lastHashIdx + 1; j < out.length; j++) {
      const t = out[j].trim();
      if (t === "" || isHashtag(t)) continue;
      nextIdx = j; break;
    }
    if (nextIdx > 0) {
      const before = out.slice(0, lastHashIdx + 1);
      const nextBlock = out[nextIdx];
      const after = out.slice(nextIdx + 1);
      const result = [...before, "", nextBlock, ...after];
      out.splice(0, out.length, ...result);
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Ensure a "Styled by <Name>" line exists or overwrite the current one
function enforceCreditName(caption, stylistName) {
  const name = (stylistName || "Unknown Stylist").toString().trim();
  const lines = String(caption || "").split("\n");
  const idx = lines.findIndex((l) => /^Styled by /.test(l));
  if (idx >= 0) {
    lines[idx] = `Styled by ${name}`;
    return lines.join("\n");
  }
  if (lines.length) {
    lines.splice(1, 0, `Styled by ${name}`);
    return lines.join("\n");
  }
  return `Styled by ${name}`;
}

// Insert IG URL *under* the Styled by line (used for Facebook)
function insertIGUnderStyledBy(caption, instagramHandle) {
  const rawHandle = (instagramHandle || "").toString().trim().replace(/^@+/, "");
  if (!rawHandle) return caption;
  const igLine = `IG: https://instagram.com/${rawHandle}`;
  const lines = String(caption || "").split("\n");
  const idx = lines.findIndex((l) => /^Styled by /.test(l));
  if (idx >= 0) {
    if (lines[idx + 1] && lines[idx + 1].trim() === igLine) return caption;
    lines.splice(idx + 1, 0, igLine);
    return lines.join("\n");
  }
  return `${caption}\n${igLine}`;
}

// Replace the "Styled by ..." line with a custom value
function replaceStyledByLine(caption, newLine) {
  const lines = String(caption || "").split("\n");
  const idx = lines.findIndex((l) => /^Styled by /.test(l));
  if (idx >= 0) {
    lines[idx] = newLine;
    return lines.join("\n");
  }
  // If not found, insert near top
  if (lines.length) {
    lines.splice(1, 0, newLine);
    return lines.join("\n");
  }
  return newLine;
}

// Remove any IG URL helper line (for Instagram caption)
function removeIGUrlLine(caption) {
  const lines = String(caption || "").split("\n").filter((l) => !/^IG:\s/.test(l.trim()));
  return lines.join("\n");
}

// Build final per-network captions
function buildFacebookCaption(baseCaption, stylistName, igHandle) {
  let c = enforceCreditName(baseCaption, stylistName); // "Styled by Full Name"
  c = insertIGUnderStyledBy(c, igHandle);              // add IG URL under it
  return prettifyBody(c);
}
function buildInstagramCaption(baseCaption, stylistName, igHandle) {
  const handle = (igHandle || "").replace(/^@+/, "");
  let c;
  if (handle) {
    c = replaceStyledByLine(baseCaption, `Styled by @${handle}`); // IG wants @handle
  } else {
    c = enforceCreditName(baseCaption, stylistName);              // fallback to name
  }

  // Remove IG URL helper line and any raw booking URLs (non-clickable on IG)
  c = removeIGUrlLine(c);

  const IG_BOOKING_CTA = process.env.IG_BOOKING_CTA || "Book via link in bio.";

  // Strip any line starting with "Book: http(s)://..." since IG doesn't hyperlink captions
  const lines = c.split("\n");
  const filtered = [];
  let removedBookingUrl = false;

  for (const line of lines) {
    if (/^\s*Book:\s*https?:\/\//i.test(line.trim())) {
      removedBookingUrl = true;
      continue; // drop the raw URL line
    }
    filtered.push(line);
  }

  // If we removed a booking URL line, add a clean CTA instead
  if (removedBookingUrl && !filtered.join("\n").includes(IG_BOOKING_CTA)) {
    // Ensure a blank line before CTA if the previous block isn't empty
    if (filtered.length && filtered[filtered.length - 1].trim() !== "") filtered.push("");
    filtered.push(IG_BOOKING_CTA);
  }

  c = filtered.join("\n");
  return prettifyBody(c);
}

// --------------------------------------
// Consent session (in-memory)
const consentSessions = new Map(); // chatId -> { status: 'pending' | 'granted', queued?: { imageUrl, text } }

function hasConsent(stylist) {
  const legacy = stylist?.compliance_opt_in === true;
  const modern = stylist?.consent?.sms_opt_in === true;
  return legacy && modern;
}
function isAgreementMessage(text) {
  return /^\s*(AGREE|I AGREE|YES|YES I AGREE)\s*$/i.test(text || "");
}
function queueConsentAndPrompt(chatId, imageUrl, text, sendMessage, stylist) {
  consentSessions.set(chatId, { status: "pending", queued: { imageUrl, text } });
  const prompt = `
MostlyPostly: Please review our SMS Consent, Privacy, and Terms:
Consent: https://sites.google.com/view/mostlypostly-consent/home
Privacy: https://sites.google.com/view/mostlypostly-privacy-policy/home
Terms: https://sites.google.com/view/mostlypostly-terms-conditions/home

Reply *AGREE* to opt in. Reply STOP to opt out. HELP for help. Msg&data rates may apply.

`.trim();
  return sendMessage.sendText(chatId, prompt);
}
function markConsentGranted(chatId) {
  const cur = consentSessions.get(chatId) || {};
  consentSessions.set(chatId, { ...cur, status: "granted" });
}
function getQueuedIfAny(chatId) {
  const cur = consentSessions.get(chatId);
  return cur?.queued || null;
}

// --------------------------------------
// Manager Preview (Telegram) — unchanged visuals
async function sendManagerPreviewPhoto(chatId, imageUrl, { draft, stylist, salon }) {
  try {
    const salonInfo = salon?.salon_info ? salon.salon_info : (salon || {});
    const salonName = salonInfo.salon_name || salonInfo.name || "Salon";
    const stylistName = getStylistName(stylist);
    const stylistHandle = getStylistHandle(stylist);
    const bookingUrl = salonInfo?.booking_url || "";

    let fullBody = composeFinalCaption({
      caption: draft?.caption || "",
      hashtags: draft?.hashtags || [],
      cta: draft?.cta || "",
      instagramHandle: null,
      stylistName,
      bookingUrl,
      salon: { salon_info: salonInfo },
      asHtml: false
    });

    // Preview format keeps: "Styled by Name" + IG URL under it
    fullBody = buildFacebookCaption(fullBody, stylistName, stylistHandle);
    const notifyText = `${salonName} — New Post for Review

👤 From: ${stylistName}
📸 Instagram: ${stylistHandle ? `@${stylistHandle}` : "N/A"}

💬 Full Caption Preview:
${fullBody}

Reply "APPROVE" to post or "DENY" to reject.
`.slice(0, 1000);

    if (!imageUrl?.startsWith("https://api.telegram.org/file/")) {
      throw new Error("Invalid Telegram file URL");
    }

    const resp = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: notifyText,
          parse_mode: "HTML"
        })
      }
    );

    const data = await resp.json();
    if (!data.ok) throw new Error(data.description || "Telegram sendPhoto failed");
    console.log("✅ Manager preview sent successfully");
    return data;
  } catch (err) {
    console.error("🚫 sendPhoto failed:", err.message);
    const salonInfo = salon?.salon_info ? salon.salon_info : (salon || {});
    const salonName = salonInfo.salon_name || salonInfo.name || "Salon";
    const stylistName = getStylistName(stylist);
    const stylistHandle = getStylistHandle(stylist);
    const bookingUrl = salonInfo?.booking_url || "";

    let fullBody = composeFinalCaption({
      caption: draft?.caption || "",
      hashtags: draft?.hashtags || [],
      cta: draft?.cta || "",
      instagramHandle: null,
      stylistName,
      bookingUrl,
      salon: { salon_info: salonInfo },
      asHtml: false
    });
    fullBody = buildFacebookCaption(fullBody, stylistName, stylistHandle);

    const fallback = `${salonName} — New Post for Review

👤 From: ${stylistName}
📸 Instagram: ${stylistHandle ? `@${stylistHandle}` : "N/A"}

💬 Full Caption Preview:
${fullBody}

Reply "APPROVE" to post or "DENY" to reject.
📸 ${imageUrl}`.slice(0, 3900);

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: fallback })
    });
  }
}

// --------------------------------------
// New image → AI → store draft → preview to stylist
async function processNewImageFlow({
  chatId, text, imageUrl, drafts,
  safeGenerateCaption, moderateAIOutput, sendMessage,
  stylist, salon
}) {
  console.log("📸 [Router] New image received (consented):", imageUrl);

  const aiJson = await safeGenerateCaption(imageUrl, text || "", stylist?.city || "", stylist);
  aiJson.image_url = imageUrl;
  aiJson.original_notes = text;

  const { safe, result } = moderateAIOutput(aiJson, text);
  if (!safe) {
    await sendMessage.sendText(chatId, "⚠️ This caption or note was flagged. Please resend a different photo.");
    drafts.delete(chatId);
    return;
  }

  const bookingUrl = salon?.salon_info?.booking_url || "";
  const stylistName = getStylistName(stylist);
  const stylistHandle = getStylistHandle(stylist);

  let baseCaption = composeFinalCaption({
    caption: result.caption,
    hashtags: result.hashtags,
    cta: result.cta,
    instagramHandle: null,
    stylistName,
    bookingUrl,
    salon,
    asHtml: false
  });

  // Stylist preview remains FB-style (name + IG URL under it)
  const previewCaption = buildFacebookCaption(baseCaption, stylistName, stylistHandle);

  drafts.set(chatId, { ...result, final_caption: previewCaption, base_caption: baseCaption });

  const preview = `
💇‍♀️ *MostlyPostly Preview (Full Post)*

${previewCaption}

Reply *APPROVE* to continue, *REGENERATE*, or *CANCEL* to stop.
`.trim();

  await sendMessage.sendText(chatId, preview);
}

// --------------------------------------
// MAIN HANDLER
export async function handleIncomingMessage({
  source,
  chatId,
  text,
  imageUrl,
  drafts,
  safeGenerateCaption,
  moderateAIOutput,
  sendMessage,
  io
}) {
  const start = startTimer();
  console.log(`💬 [Router] Message received from ${source}:`, { chatId, text, imageUrl });

  const cleanText = (text || "").trim();
  const command = cleanText.toUpperCase();

  // Identify who is talking
  const stylist =
    lookupStylist(chatId) || {
      stylist_name: "Guest User",
      salon_name: "Unknown",
      city: "Unknown",
      role: "stylist"
    };

  const role = stylist.role?.toLowerCase() || "stylist";
  console.log(`${role === "manager" ? "👔 Manager" : "💇 Stylist"} resolved: ${getStylistName(stylist)} @ ${stylist.salon_name}`);

  // Get the salon (with retry if cache was empty)
  let salon = getSalonByStylist(chatId);
  if (!salon) {
    console.warn(`⚠️ No salon match for ${chatId}. Reloading cache...`);
    await loadSalons();
    salon = getSalonByStylist(chatId);
  }
  if (!salon) {
    await sendMessage.sendText(chatId, "⚠️ Your salon is not properly linked in MostlyPostly. Please contact your manager.");
    endTimer(start);
    return;
  }

  // Join flow?
  if (isJoinInProgress(chatId)) {
    const result = await continueJoinConversation(chatId, cleanText, sendMessage.sendText);
    if (result.done) console.log(`✅ Join flow completed for ${chatId}`);
    endTimer(start);
    return;
  }

  // =========================
  // CONSENT: stylist typed AGREE
  // =========================
  if (isAgreementMessage(cleanText) && consentSessions.get(chatId)?.status === "pending") {
    markConsentGranted(chatId);

    // Persist consent to salons/<file>.json
    const now = new Date().toISOString();
    const persist = saveStylistConsent(chatId, {
      compliance_opt_in: true,
      compliance_timestamp: now,
      consent: { sms_opt_in: true, timestamp: now }
    });
    if (!persist.ok) {
      console.error("⚠️ Failed to persist consent:", persist.error);
    } else {
      console.log("✅ Consent persisted:", persist.file);
    }

    // Reload salons so live cache reflects the change
    await loadSalons();

    // Continue with queued content if any
    const queued = getQueuedIfAny(chatId);
    await sendMessage.sendText(chatId, "✅ Thanks! Consent received. Continuing…");

    if (queued?.imageUrl) {
      await processNewImageFlow({
        chatId,
        text: queued.text,
        imageUrl: queued.imageUrl,
        drafts,
        safeGenerateCaption,
        moderateAIOutput,
        sendMessage,
        stylist,
        salon: getSalonByStylist(chatId) || salon
      });
      consentSessions.set(chatId, { status: "granted" });
      endTimer(start);
      return;
    }

    await sendMessage.sendText(chatId, "📸 Please send a photo with a short note to generate your caption.");
    endTimer(start);
    return;
  }

  // CANCEL
  if (command === "CANCEL") {
    drafts.delete(chatId);
    await sendMessage.sendText(chatId, "🛑 Cancelled. No action taken.");
    endTimer(start);
    return;
  }

  // JOIN (managers)
  if (/^JOIN\b/i.test(cleanText)) {
    if (role !== "manager") {
      await sendMessage.sendText(chatId, "🚫 Only managers can use the JOIN command.");
      endTimer(start);
      return;
    }
    await handleJoinCommand(chatId, lookupStylist, cleanText, sendMessage.sendText);
    endTimer(start);
    return;
  }

  // APPROVE
  if (/^APPROVE\b/i.test(command)) {
    const draft = drafts.get(chatId);

    if (!draft) {
      const pending = findPendingPostByManager(chatId);
      if (pending) {
        await handleManagerApproval(chatId, pending, sendMessage.sendText);
        endTimer(start);
        return;
      }
      await sendMessage.sendText(chatId, "⚠️ No draft found. Please send a photo first.");
      endTimer(start);
      return;
    }

    const requiresManager = !!salon?.settings?.require_manager_approval;
    const manager = salon?.managers?.[0];
    const bookingUrl = salon?.salon_info?.booking_url || "";
    const stylistName = getStylistName(stylist);
    const stylistHandle = getStylistHandle(stylist);

    // Base caption (single source of truth)
    let baseCaption = composeFinalCaption({
      caption: draft.caption || "Beautiful new style!",
      hashtags: draft.hashtags || [],
      cta: draft.cta || "Book your next visit today!",
      instagramHandle: null,
      stylistName,
      bookingUrl,
      salon,
      asHtml: false
    });

    if (requiresManager && manager && role !== "manager") {
      console.log(`🕓 [Router] Manager approval required for ${stylistName}`);

      const stylistWithManager = {
        ...stylist,
        manager_phone: manager?.phone || null,
        manager_chat_id: manager?.chat_id ?? null,
        image_url: draft.image_url || null,
        final_caption: buildFacebookCaption(baseCaption, stylistName, stylistHandle), // preview style
        booking_url: bookingUrl,
        instagram_handle: stylistHandle
      };

      const pendingPost = await savePost(
        chatId,
        stylistWithManager,
        draft.caption,
        draft.hashtags || [],
        "manager_pending",
        io,
        salon
      );

      if (!pendingPost?.id) {
        await sendMessage.sendText(chatId, "⚠️ Could not save your post. Please try again.");
        endTimer(start);
        return;
      }

      const persistPayload = {
        ...draft,
        final_caption: buildFacebookCaption(baseCaption, stylistName, stylistHandle),
        stylist_name: stylistName,
        instagram_handle: stylistHandle,
        booking_url: bookingUrl,
        image_url: draft.image_url || null,
        status: "manager_pending"
      };

      const updated = await updatePostStatus(pendingPost.id, "manager_pending", persistPayload);
      console.log("💾 Post persisted (manager_pending):", { id: pendingPost.id, hasFinal: !!updated?.final_caption });

      if (source === "telegram") {
        const managerChatId = manager?.chat_id;
        if (managerChatId) {
          console.log("📤 Sending manager preview to", managerChatId, "for", stylistName);
          await sendManagerPreviewPhoto(managerChatId, draft.image_url, {
            draft: { ...draft, caption: draft.caption, hashtags: draft.hashtags, cta: draft.cta },
            stylist,
            salon
          });
        } else {
          await sendMessage.sendText(chatId, "⚠️ Manager Telegram chat_id not configured.");
        }
      } else {
        const managerPhone = manager?.phone;
        if (managerPhone) {
          const smsBody = buildFacebookCaption(baseCaption, stylistName, stylistHandle);
          await sendMessage.sendText(managerPhone, `${smsBody}\n📸 ${draft.image_url}`);
        } else {
          await sendMessage.sendText(chatId, "⚠️ Manager phone not configured.");
        }
      }

      await sendMessage.sendText(chatId, "✅ Your post is pending manager approval before publishing.");
      drafts.delete(chatId);
      endTimer(start);
      return;
    }

    // --------------------------
    // Direct post path
    try {
      const image = draft.image_url || null;

      // Build per-network captions
      const fbCaption = buildFacebookCaption(baseCaption, stylistName, stylistHandle);
      const igCaption = buildInstagramCaption(baseCaption, stylistName, stylistHandle);

      const pageId = salon?.salon_info?.facebook_page_id || process.env.FACEBOOK_PAGE_ID;
      const fbResult = await publishToFacebook(pageId, fbCaption, image);
      const fbLink = fbResult?.post_id
        ? `https://facebook.com/${fbResult.post_id.replace("_", "/posts/")}`
        : "✅ Facebook post created, but link unavailable.";

      await sendMessage.sendText(chatId, `✅ *Approved and posted!*\n\n${fbCaption}\n\n${fbLink}`);

      // Optional IG
      const IG_ENABLED = (process.env.PUBLISH_TO_INSTAGRAM || "false").toLowerCase() === "true";
      if (IG_ENABLED) {
        try {
          const imageForIg = resolveImageUrl(null, draft);
          if (imageForIg) {
            console.log("📷 Preparing Instagram publish with image:", imageForIg);
            const igResult = await publishToInstagram({
              imageUrl: imageForIg,
              caption: igCaption,              // IG gets @handle format without IG URL line
              postId: fbResult?.id || undefined
            });
            await sendMessage.sendText(chatId, igResult?.media_id ? `📸 Instagram post (id: ${igResult.media_id})` : "📸 Instagram post created.");
          } else {
            console.warn("⚠️ No imageUrl found for IG in direct-post path; skipping Instagram.");
          }
        } catch (igErr) {
          console.error("🚫 Instagram publish failed:", igErr);
          await sendMessage.sendText(chatId, "⚠️ Instagram publish failed (check server logs).");
        }
      }

      drafts.delete(chatId);
    } catch (err) {
      console.error("🚫 [Router] Facebook post failed:", err);
      await sendMessage.sendText(chatId, "⚠️ Could not post to Facebook. Check server logs.");
    }

    endTimer(start);
    return;
  }

  // DENY + reason
  if (command === "DENY") {
    const pending = findPendingPostByManager(chatId);
    if (pending) {
      await sendMessage.sendText(chatId, `✏️ Please provide a short reason for denying ${pending.stylist_name || "this stylist"}'s post.`);
      await updatePostStatus(pending.id, "awaiting_reason");
      endTimer(start);
      return;
    }
  }

  const awaitingReason = findPostAwaitingReason(chatId);
  if (awaitingReason) {
    await updatePostStatus(awaitingReason.id, "manager_denied", cleanText);
    await sendMessage.sendText(awaitingReason.stylist_phone, `❌ Your post was denied.\n\nReason: ${cleanText}`);
    await sendMessage.sendText(chatId, "✅ Denial reason recorded. Stylist notified.");
    endTimer(start);
    return;
  }

  // REGENERATE
  if (command === "REGENERATE") {
    const draft = drafts.get(chatId);
    if (!draft?.image_url) {
      await sendMessage.sendText(chatId, "⚠️ No previous image found. Please send a new photo first.");
      endTimer(start);
      return;
    }

    await sendMessage.sendText(chatId, "🔄 Regenerating a fresh caption...");
    try {
      const aiJson = await safeGenerateCaption(draft.image_url, draft.original_notes || "", stylist?.city || "", stylist);
      aiJson.image_url = draft.image_url;
      aiJson.original_notes = draft.original_notes;
      drafts.set(chatId, aiJson);

      const bookingUrlR = salon?.salon_info?.booking_url || "";
      let regenBase = composeFinalCaption({
        caption: aiJson.caption,
        hashtags: aiJson.hashtags,
        cta: aiJson.cta,
        instagramHandle: null,
        stylistName: getStylistName(stylist),
        bookingUrl: bookingUrlR,
        salon,
        asHtml: false
      });

      // Stylist preview remains FB-style
      const regenPreview = buildFacebookCaption(regenBase, getStylistName(stylist), getStylistHandle(stylist));

      const preview = `
💇‍♀️ *MostlyPostly Preview (Regenerated)*

${regenPreview}

Reply *APPROVE* to continue, *REGENERATE*, or *CANCEL* to start over.
`.trim();

      await sendMessage.sendText(chatId, preview);
    } catch (err) {
      console.error("⚠️ [Router] Regeneration failed:", err);
      await sendMessage.sendText(chatId, "⚠️ Could not regenerate caption. Try again later.");
    }
    endTimer(start);
    return;
  }

  // NEW PHOTO — Consented?
  if (imageUrl) {
    if (!hasConsent(stylist) && consentSessions.get(chatId)?.status !== "granted") {
      await queueConsentAndPrompt(chatId, imageUrl, text, sendMessage, stylist);
      endTimer(start);
      return;
    }

    await processNewImageFlow({
      chatId,
      text,
      imageUrl,
      drafts,
      safeGenerateCaption,
      moderateAIOutput,
      sendMessage,
      stylist,
      salon
    });
    endTimer(start);
    return;
  }

  // Default
  if (!hasConsent(stylist) && consentSessions.get(chatId)?.status !== "granted") {
    await queueConsentAndPrompt(chatId, null, null, sendMessage, stylist);
    endTimer(start);
    return;
  }

  await sendMessage.sendText(chatId, "📸 Please send a *photo* with a short note (like 'blonde balayage' or 'men’s cut').");
  endTimer(start);
}

// --------------------------------------
// Manager approval → publish (FB + IG)
async function handleManagerApproval(managerIdentifier, pendingPost, sendText) {
  console.log("🧩 Debug: Pending post ID:", pendingPost.id, "final_caption:", !!pendingPost.final_caption);
  console.log("🧾 Stored final_caption preview:", pendingPost.final_caption?.slice?.(0, 100));

  // Rebuild a base caption if needed (without network-specific tweaks yet)
  let baseCaption = pendingPost.final_caption;
  if (!baseCaption) {
    console.warn("⚠️ No final_caption found — rebuilding fallback caption.");
    baseCaption = composeFinalCaption({
      caption: pendingPost.caption || "",
      hashtags: pendingPost.hashtags || [],
      cta: pendingPost.cta || "Book your next visit today!",
      instagramHandle: null,
      stylistName: pendingPost.stylist_name || "Unknown Stylist",
      bookingUrl:
        pendingPost.booking_url ||
        pendingPost.salon_info?.booking_url ||
        "",
      salon: { salon_info: pendingPost.salon_info || { default_hashtags: [] } },
      asHtml: false
    });
  }

  // Build per-network captions
  const fbCaption = buildFacebookCaption(
    baseCaption,
    pendingPost.stylist_name || "Unknown Stylist",
    pendingPost.instagram_handle
  );
  const igCaption = buildInstagramCaption(
    baseCaption,
    pendingPost.stylist_name || "Unknown Stylist",
    pendingPost.instagram_handle
  );

  const pageId = pendingPost.facebook_page_id || pendingPost.salon_info?.facebook_page_id || process.env.FACEBOOK_PAGE_ID;
  const image = pendingPost.image_url || null;

  try {
    // Facebook
    const fbRes = await publishToFacebook(pageId, fbCaption, image);
    const fbLink = fbRes?.post_id
      ? `https://facebook.com/${fbRes.post_id.replace("_", "/posts/")}`
      : "✅ Facebook post created, but link unavailable.";

    await updatePostStatus(pendingPost.id, "manager_approved", {
      fb_post_id: fbRes?.post_id || null,
      fb_response_id: fbRes?.id || null,
      published_at: new Date().toISOString(),
      final_caption: fbCaption
    });

    await sendText(pendingPost.stylist_phone, `✅ Your post was approved and published!\n\n${fbCaption}\n\n${fbLink}`);
    await sendText(managerIdentifier, "✅ Post approved and published successfully.");
    console.log("🧩 Unified caption published successfully (FB):\n", fbCaption);

    // Instagram (optional)
    const IG_ENABLED = (process.env.PUBLISH_TO_INSTAGRAM || "false").toLowerCase() === "true";
    if (IG_ENABLED) {
      try {
        const imageForIg = resolveImageUrl(pendingPost, null);
        if (imageForIg) {
          console.log("📷 Preparing Instagram publish with image:", imageForIg);
          const igResult = await publishToInstagram({
            imageUrl: imageForIg,
            caption: igCaption,     // IG gets @handle format without IG URL line
            postId: pendingPost.id
          });
          await sendText(pendingPost.stylist_phone, igResult?.media_id ? `📸 Instagram post (id: ${igResult.media_id})` : "📸 Instagram post created.");
        } else {
          console.warn("⚠️ No imageUrl on pending post; skipping Instagram publish.");
        }
      } catch (igErr) {
        console.error("🚫 Instagram publish failed:", igErr);
        await sendText(managerIdentifier, "⚠️ Instagram publish failed (check logs).");
      }
    }
  } catch (err) {
    console.error("🚫 [ManagerApproval] Facebook publish failed:", err);
    await sendText(managerIdentifier, "⚠️ Could not publish post to Facebook. Check logs.");
  }
}
