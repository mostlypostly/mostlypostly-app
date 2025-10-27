// src/core/composeFinalCaption.js
// Single source of truth for caption assembly (production-only).
// No hard-coded salon/location hashtags in code.
// The only tag that code adds is the brand tag, which is configurable via env.

const BRAND_TAG = (process.env.MOSTLYPOSTLY_BRAND_TAG || "#MostlyPostly");

/**
 * Compose a final caption string with consistent formatting across channels.
 * - Merges AI hashtags + salon defaults + BRAND_TAG (deduped, case-insensitive)
 * - Clickable IG credit in HTML mode; plain "@handle" in text mode
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
  asHtml = false
}) {
  const parts = [];

  // Normalize inputs
  const text = (caption || "").toString().trim();
  const ctaText = (cta || "").toString().trim();
  const handle = ((instagramHandle || salon?.salon_info?.instagram_handle || "").toString())
    .replace(/^@+/, "")
    .trim();
  const creditName = (stylistName || "").toString().trim();
  const booking = (bookingUrl || "").toString().trim();

  // 1) Caption body
  if (text) parts.push(text);

  // 2) IG credit line
  let credit = "Styled by a stylist";
  if (handle) {
    credit = asHtml
      ? `Styled by <a href="https://instagram.com/${handle}">@${handle}</a>`
      : `Styled by @${handle}`;
  } else if (creditName) {
    credit = `Styled by ${creditName}`;
  }
  parts.push(credit);

  // 3) Hashtags (AI + salon defaults + BRAND_TAG → dedupe)
  const salonDefaults = Array.isArray(salon?.salon_info?.default_hashtags)
    ? salon.salon_info.default_hashtags
    : [];

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
