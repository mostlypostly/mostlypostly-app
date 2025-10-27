// src/utils/hashtags.js
function normalizeTag(tag) {
  if (!tag) return "";
  const t = String(tag).trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t.replace(/^#+/, "")}`;
}

/**
 * Merge salon + stylist + extra hashtags, always include #MostlyPostly, de-dupe, preserve order.
 */
export function buildCombinedHashtags(salon, stylist, extra = []) {
  const salonTags = Array.isArray(salon?.custom_hashtags) ? salon.custom_hashtags : [];
  const stylistTags = Array.isArray(stylist?.custom_hashtags) ? stylist.custom_hashtags : [];
  const base = [...salonTags, ...stylistTags, "#MostlyPostly", ...extra].map(normalizeTag).filter(Boolean);

  const seen = new Set();
  const deduped = [];
  for (const tag of base) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(tag);
    }
  }
  return deduped;
}
