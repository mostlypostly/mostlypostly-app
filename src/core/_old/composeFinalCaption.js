// src/core/composeFinalCaption.js
// Single source of truth for caption assembly (production-only).
// No hard-coded salon/location hashtags in code.
// The only tag code adds is the brand tag, configurable via env.

const BRAND_TAG = (process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly");

/**
 * Return salon defaults whether caller passed:
 *  - { salon_info: { default_hashtags } }  ✅ current
 *  - just salon_info directly
 *  - legacy custom_hashtags (both shapes)
 */
function getSalonDefaults(salon) {
  const s = salon || {};
  const info = s.salon_info || s;

  const candidates = [
    info?.default_hashtags, // current
    info?.custom_hashtags,  // legacy
    s?.default_hashtags,    // if caller passed plain info object
    s?.custom_hashtags      // legacy
  ];

  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

/**
 * Compose a final caption string with consistent formatting across channels.
 * - Merges AI hashtags + salon defaults + BRAND_TAG (deduped, case-insensitive)
 * - HTML mode: clickable IG @handle
 * - Plain-text mode: optional handle URL (for Facebook/X) via linkHandleInPlain
 * - Booking URL is optional (exclude it for previews by passing "")
 */
export function composeFinalCaption({
  caption,
  hashtags = [],
  cta,
  instagramHandle,
  stylistName,
  bookingUrl,
  salon,
  asHtml = false,
  linkHandleInPlain = false   // ⬅️ NEW: when true in plain text, append IG URL so FB/X auto-link it
}) {
  const parts = [];

  // Normalize inputs
  const text = (caption || "").toString().trim();
  const ctaText = (cta || "").toString().trim();
  const handle = ((instagramHandle || (salon?.salon_info?.instagram_handle) || "").toString())
    .replace(/^@+/, "")
    .trim();
  const creditName = (stylistName || "").toString().trim();
  const booking = (bookingUrl || "").toString().trim();

  // 1) Caption body
  if (text) parts.push(text);

  // 2) Credit line
  let credit = "Styled by a stylist";
  if (handle) {
    if (asHtml) {
      credit = `Styled by <a href="https://instagram.com/${handle}">@${handle}</a>`;
    } else if (linkHandleInPlain) {
      // FB/X are plain text: include a URL to make it clickable
      credit = `Styled by @${handle} (https://instagram.com/${handle})`;
    } else {
      credit = `Styled by @${handle}`;
    }
  } else if (creditName) {
    credit = `Styled by ${creditName}`;
  }
  parts.push(credit);

  // 3) Hashtags (AI + salon defaults + BRAND_TAG → dedupe)
  const salonDefaults = getSalonDefaults(salon);
  const tags = _mergeHashtags(hashtags, salonDefaults, BRAND_TAG);
  if (tags.length) parts.push(tags.join(" "));

  // 4) CTA (optional)
  if (ctaText) parts.push(ctaText);

  // 5) Booking URL (final posts only; previews should pass "")
  if (booking) parts.push(`Book: ${booking}`);

  // 6) Join lines (HTML vs plaintext)
  return parts.join(asHtml ? "<br/>" : "\n");
}

/**
 * Utility: merge and dedupe hashtags case-insensitively.
 * Keeps first-seen order; filters out non-# strings.
 */
export function _mergeHashtags(aiTags = [], salonDefaults = [], brandTag = BRAND_TAG) {
  const incoming = [...(aiTags || []), ...(salonDefaults || []), brandTag];
  const seen = new Set();
  const out = [];

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
