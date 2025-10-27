// src/core/postClassifier.js

/**
 * Heuristic classifier: before/after, product placement, promotion, availability, standard
 * Returns: { type, reasons[], availability?: {dates:[], slots:[]}, productBrand?: string }
 */
export function classifyPost({ notes = "", imageSummary = "", draft = {} }) {
  const text = `${notes} ${draft.caption || ""}`.toLowerCase();
  const img = (imageSummary || "").toLowerCase();

  const reasons = [];

  // before/after signals
  if (/\bbefore\b.*\bafter\b|\bafter\b.*\bbefore\b/.test(text) || /side[-\s]?by[-\s]?side/.test(text)) {
    return { type: "before_after", reasons: ["text mentions before/after"] };
  }

  // promotion/discount
  if (/\b(save|off|%|promo|special|deal|discount|sale)\b/.test(text) || /\$\d+/.test(text)) {
    return { type: "promotion", reasons: ["promo/discount signals in text"] };
  }

  // appointment availability
  if (/\bavailability\b|\bopen slots?\b|\bbook now\b|\bappointments?\b/.test(text)) {
    return { type: "availability", reasons: ["availability keywords"], availability: { dates: [], slots: [] } };
  }

  // product placement (from image or text)
  if (/\b(shampoo|conditioner|bottle|product|aveda|spray|styling cream)\b/.test(text) ||
      /\b(bottle|product|label)\b/.test(img)) {
    const brandMatch = text.match(/\b(aveda|davines|redken|olaplex|kevin\.?murphy)\b/);
    return { type: "product", reasons: ["product cues in text/image"], productBrand: brandMatch?.[1] || null };
  }

  // default
  return { type: "standard", reasons: [] };
}
