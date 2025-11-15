// formatters.js — MostlyPostly caption and post builders (ESM version)
// v0.5-spaced — adds better spacing + removes * around commands

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
// ✅ Core: mergeHashtags (for AI + salon defaults + brand)
// ------------------------------------
export function mergeHashtags(aiTags = [], salonDefaults = [], brandTag = "#MostlyPostly") {
  const incoming = [...(aiTags || []), ...(salonDefaults || []), brandTag];
  const out = [];
  const seen = new Set();
  for (const raw of incoming) {
    const t = (raw || "").toString().trim();
    if (!t.startsWith("#") || !t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ------------------------------------
// ✅ Helper: merge all hashtag sources (AI + salon + stylist + specialty + brand)
// ------------------------------------
function mergeAllHashtags(draft, stylist, salon) {
  const base = new Set();

  (draft?.hashtags || []).forEach((h) => base.add(normalizeTag(h)));
  (salon?.custom_hashtags || []).forEach((h) => base.add(normalizeTag(h)));
  (stylist?.custom_hashtags || []).forEach((h) => base.add(normalizeTag(h)));

  const service = (draft?.service_type || "").toLowerCase();
  if (stylist?.specialties?.length) {
    for (const specialty of stylist.specialties) {
      if (service.includes(specialty)) {
        (specialtyHashtags[specialty] || []).forEach((tag) => base.add(normalizeTag(tag)));
      }
    }
  }

  const brand1 = salon?.preferred_brand_1?.toLowerCase() || "";
  const brand2 = salon?.preferred_brand_2?.toLowerCase() || "";
  if (brand1.includes("aveda") || brand2.includes("aveda")) base.add("#Aveda");
  if (brand1 && !brand1.includes("aveda")) base.add(`#${brand1}`);
  if (brand2 && !brand2.includes("aveda")) base.add(`#${brand2}`);

  base.add("#MostlyPostly");
  return Array.from(base);
}

// ------------------------------------
// ✅ Helper: build stylist tag line
// ------------------------------------
function buildTagLine(stylist) {
  if (!stylist?.instagram_handle) return "";
  const igHandle = stylist.instagram_handle.replace(/^@+/, "");
  return `Styled by @${igHandle}`;
}

// 📸 Instagram Post Formatter
export function formatInstagramPost(draft, stylist, salon) {
  const caption = draft.caption || "";
  const hashtags = mergeAllHashtags(draft, stylist, salon).join(" ");
  const cta = draft.cta || "Book your next visit today!";
  const tagLine = buildTagLine(stylist);

  // 🧩  double-spacing between sections
  return [
    caption.trim(),
    "",
    "",
    tagLine,
    "",
    "",
    hashtags,
    "",
    "",
    cta,
    "",
    "Book via link in bio."
  ].join("\n");
}

// 📘 Facebook Post Formatter (FB-safe spacing with zero-width spacer)
export function formatFacebookPost(draft, stylist, salon) {
  const FB_SPACER = "\u200B"; // zero-width space line to preserve blank lines on Facebook

  const salonInfo = salon?.salon_info ? salon.salon_info : salon || {};
  const bookingUrl = salonInfo?.booking_url || "";
  const salonDefaults =
    Array.isArray(salonInfo?.default_hashtags) && salonInfo.default_hashtags.length
      ? salonInfo.default_hashtags
      : Array.isArray(salonInfo?.custom_hashtags)
      ? salonInfo.custom_hashtags
      : [];
  const BRAND_TAG = process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly";
  const combinedHashtags = mergeHashtags(draft?.hashtags || [], salonDefaults, BRAND_TAG);

  const handle = (stylist?.instagram_handle || "").replace(/^@+/, "");
  const tagLine = handle ? `Styled by @${handle}` : `Styled by ${stylist?.stylist_name || "a stylist"}`;
  const cta = draft?.cta || "Book your next visit today!";

  // Build logical blocks
  const blocks = [
    (draft?.caption || "").trim(),
    tagLine,
    combinedHashtags.join(" "),
    cta,
    bookingUrl ? `Book: ${bookingUrl}` : ""
  ].filter((b) => typeof b === "string"); // keep empties for spacer logic handling below

  // Join blocks with an FB-safe blank line (the spacer)
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = (blocks[i] || "").trim();
    if (!block) continue; // skip truly empty blocks
    if (out.length) out.push(FB_SPACER); // blank line that FB will keep
    out.push(block);
  }

  return out.join("\n");
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

  return `${caption}\n\n${cta}\n\n${tagLine}\n\n${hashtags}\n\n${url}`;
}

// ------------------------------------
// ✉️ Notifications (Manager + Stylist)
// ------------------------------------
export function formatManagerNotification(salon, post) {
  const salonName = salon?.salon_info?.salon_name || salon?.salon_name || "Salon";
  const stylist = post?.stylist_name || "A stylist";
  const caption = post?.caption || "No caption provided";
  const img = post?.image_url ? "\n📸 Image attached." : "";
  return [
    `📝 ${salonName} — New Post for Review`,
    `From: ${stylist}`,
    "",
    `"${caption}"${img}`,
    "",
    "Reply APPROVE to post or DENY to reject."
  ].join("\n");
}

export function formatStylistApproved(post) {
  const caption = post?.caption || "";
  const booking = post?.booking_url || "https://booking.rejuvesalonandspa.com";
  return [
    "🎉 Your post was approved and published!",
    "",
    `"${caption}"`,
    "",
    `Book link: ${booking}`,
    "",
    "Keep up the great work! 💇‍♀️"
  ].join("\n");
}

export function formatStylistDenied(post, reason) {
  const manager = post?.manager_name || "your manager";
  return [
    `🚫 Your post was denied by ${manager}.`,
    `Reason: "${reason}"`,
    "",
    "Please edit and resubmit when ready."
  ].join("\n");
}

export function formatAutoPublishNotice(post) {
  return [
    "⏰ Your post was automatically published after manager review timeout.",
    "",
    `"${post.caption}"`,
    "",
    "Keep creating great content!"
  ].join("\n");
}

// ✅ Export helpers
export { mergeAllHashtags, normalizeTag };
