// formatters.js — MostlyPostly caption and post builders (ESM version)
// v0.5 — Adds Manager Approval and Notification Templates

// ------------------------------------
// 💅 Specialty → Hashtag Mapping
// ------------------------------------
const specialtyHashtags = {
  balayage: ["#balayagespecialist", "#balayageartist"],
  color: ["#haircolorist", "#colorcorrection"],
  mens_grooming: ["#menshair", "#mensgrooming"],
  vivid: ["#vividhair", "#creativecolor"],
  extensions: ["#hairextensions", "#extensionartist"],
  spa: ["#skincare", "#spaexperience"],
  makeup: ["#makeupartist", "#beautypro"]
};

// ------------------------------------
// ✅ Helper: normalize and de-dupe hashtags
// ------------------------------------
function normalizeTag(tag) {
  if (!tag) return "";
  const clean = String(tag).trim();
  if (!clean) return "";
  return clean.startsWith("#") ? clean : `#${clean.replace(/^#+/, "")}`;
}

// ------------------------------------
// ✅ Helper: merge all hashtag sources
// ------------------------------------
function mergeAllHashtags(draft, stylist, salon) {
  const base = new Set();

  // 1️⃣ AI-generated hashtags
  (draft?.hashtags || []).forEach((h) => base.add(normalizeTag(h)));

  // 2️⃣ Salon-level hashtags
  (salon?.custom_hashtags || []).forEach((h) => base.add(normalizeTag(h)));

  // 3️⃣ Stylist-level hashtags
  (stylist?.custom_hashtags || []).forEach((h) => base.add(normalizeTag(h)));

  // 4️⃣ Specialty hashtags
  const service = (draft?.service_type || "").toLowerCase();
  if (stylist?.specialties?.length) {
    for (const specialty of stylist.specialties) {
      if (service.includes(specialty)) {
        (specialtyHashtags[specialty] || []).forEach((tag) => base.add(normalizeTag(tag)));
      }
    }
  }

  // 5️⃣ Salon brand hashtags (Aveda, etc.)
  const brand1 = salon?.preferred_brand_1?.toLowerCase() || "";
  const brand2 = salon?.preferred_brand_2?.toLowerCase() || "";
  if (brand1.includes("aveda")) base.add("#Aveda");
  if (brand2.includes("aveda")) base.add("#Aveda");
  if (brand1 && !brand1.includes("aveda")) base.add(`#${brand1}`);
  if (brand2 && !brand2.includes("aveda")) base.add(`#${brand2}`);

  // 6️⃣ Always include #MostlyPostly
  base.add("#MostlyPostly");

  return Array.from(base);
}

// ------------------------------------
// ✅ Helper: build stylist tag line with Instagram link
// ------------------------------------
function buildTagLine(stylist) {
  if (!stylist?.instagram_handle) return "";
  const igHandle = stylist.instagram_handle;
  return `Styled by @${igHandle} (https://www.instagram.com/${igHandle}/)`;
}

// ------------------------------------
// 📸 Instagram Post Formatter
// ------------------------------------
export function formatInstagramPost(draft, stylist, salon) {
  const caption = draft.caption || "";
  const hashtags = mergeAllHashtags(draft, stylist, salon).join(" ");
  const cta = draft.cta || "Book your next visit today!";
  const tagLine = buildTagLine(stylist);

  return `${caption}\n\n${tagLine}\n\n${hashtags}\n\n${cta}\nBook via link in bio.`;
}

// ------------------------------------
// 📘 Facebook Post Formatter
// ------------------------------------
export function formatFacebookPost(draft, stylist, salon) {
  // Normalize salon shape so we can read defaults reliably
  const salonInfo = salon?.salon_info ? salon.salon_info : salon || {};
  const bookingUrl = salonInfo?.booking_url || "";

  // 1) Pull salon defaults regardless of key naming
  const salonDefaults =
    Array.isArray(salonInfo?.default_hashtags) && salonInfo.default_hashtags.length
      ? salonInfo.default_hashtags
      : (Array.isArray(salonInfo?.custom_hashtags) ? salonInfo.custom_hashtags : []);

  // 2) Merge (AI + salon defaults + brand) with de-dupe
  const BRAND_TAG = (process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly");
  const combinedHashtags = mergeHashtags(draft?.hashtags || [], salonDefaults, BRAND_TAG);

  // 3) Build the base caption exactly as before (plain text)
  let caption = composeFinalCaption({
    caption: draft?.caption,
    hashtags: combinedHashtags,
    cta: draft?.cta,
    instagramHandle: stylist?.instagram_handle,
    stylistName: stylist?.stylist_name,
    bookingUrl,
    salon: { salon_info: salonInfo },
    asHtml: false
  });

  // 4) Make the stylist handle clickable on FB by appending a real URL
  const handle = (stylist?.instagram_handle || "").replace(/^@+/, "");
  if (handle) {
    caption += `\nIG: https://instagram.com/${handle}`;
  }

  return caption;
}

// Helper lives in this file to avoid touching other modules
function mergeHashtags(aiTags = [], salonDefaults = [], brandTag = "#MostlyPostly") {
  const incoming = [...aiTags, ...salonDefaults, brandTag];
  const out = [];
  const seen = new Set();
  for (const raw of incoming) {
    const t = (raw || "").toString().trim();
    if (!t || !t.startsWith("#")) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ------------------------------------
// 🕊️ X (Twitter) Post Formatter
// ------------------------------------
export function formatXPost(draft, stylist, salon) {
  const caption = draft.caption || "";
  const hashtags = mergeAllHashtags(draft, stylist, salon).slice(0, 3).join(" ");
  const cta = draft.cta || "Book your next visit today!";
  const tagLine = buildTagLine(stylist);
  const url = salon?.booking_url || "";

  return `${caption} ${cta}\n${tagLine}\n${hashtags}\n${url}`;
}

// =====================================================================
// ✉️ Manager + Stylist Notifications (for SMS/Telegram)
// =====================================================================

/**
 * 🧾 Notify manager when stylist submits a post for review
 */
export function formatManagerNotification(salon, post) {
  const salonName = salon?.salon_info?.salon_name || salon?.salon_name || "Salon";
  const stylist = post?.stylist_name || "A stylist";
  const caption = post?.caption || "No caption provided";
  const img = post?.image_url ? "\n📸 Image attached." : "";

  return `📝 *${salonName} — New Post for Review*\nFrom: ${stylist}\n\n"${caption}"${img}\n\nReply *APPROVE* to post or *DENY* to reject.`;
}

/**
 * ✅ Notify stylist that their post was approved + published
 */
export function formatStylistApproved(post) {
  const caption = post?.caption || "";
  const booking = post?.booking_url || "https://booking.rejuvesalonandspa.com";
  return `🎉 Your post was approved and published!\n\n"${caption}"\n\nBook link: ${booking}\n\nKeep up the great work! 💇‍♀️`;
}

/**
 * 🚫 Notify stylist that their post was denied + include reason
 */
export function formatStylistDenied(post, reason) {
  const manager = post?.manager_name || "your manager";
  return `🚫 Your post was denied by ${manager}.\nReason: "${reason}"\n\nPlease edit and resubmit when ready.`;
}

/**
 * 🕓 (Optional future use)
 * Notify stylist if post auto-published after manager timeout
 */
export function formatAutoPublishNotice(post) {
  return `⏰ Your post was automatically published after manager review timeout.\n\n"${post.caption}"\n\nKeep creating great content!`;
}