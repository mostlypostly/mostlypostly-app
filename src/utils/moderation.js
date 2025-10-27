// src/utils/moderation.js
// Centralized moderation + sanitation helper for MostlyPostly

/**
 * Replace or mask banned words in a string.
 * @param {string} str - Input text
 * @returns {string} - Cleaned text with flagged words replaced by ⚠️
 */

import { createLogger } from "../utils/logHelper.js";

const log = createLogger("app"); // or "scheduler", "moderation", etc.


export function sanitizeText(str = "") {
  const bannedWords = [
    "bitch", "fuck", "shit", "asshole", "slut", "hoe", "dick", "cock",
    "pussy", "whore", "bastard", "cunt", "nude", "nsfw", "sexy",
    "seductive", "sensual", "provocative", "erotic", "fetish"
  ];

  let clean = str;
  for (const w of bannedWords) {
    const regex = new RegExp(`\\b${w}\\b`, "gi");
    clean = clean.replace(regex, "⚠️");
  }
  return clean;
}

/**
 * Check if content is safe for salon/spa public posting.
 * Blocks profanity, sexual content, hate speech, and disrespectful language.
 * @param {string} caption
 * @param {string[]} hashtags
 * @param {string} stylistInput
 * @returns {boolean} true if safe, false if blocked
 */
export function isContentSafe(caption = "", hashtags = [], stylistInput = "") {
  const text = `${caption} ${hashtags.join(" ")} ${stylistInput}`.toLowerCase();

  // 🚫 Hard block list
  const blocked = [
    "nude", "nsfw", "erotic", "sex", "sexual", "fetish", "provocative",
    "explicit", "onlyfans", "hot", "seductive", "pussy", "bitch", "fuck"
  ];
  if (blocked.some((w) => text.includes(w))) return false;

  // 🚫 Physical/body/appearance context
  const offContext = [
    "cleavage", "legs", "thigh", "body", "butt", "chest", "boobs", "abs",
    "face", "smile", "eyes", "outfit", "attire", "clothes", "expression"
  ];
  if (offContext.some((w) => text.includes(w))) return false;

  // 🚫 Disrespectful or harmful phrases
  const disallowedPhrases = [
    // Gendered or demographic insults
    "stupid women", "stupid men", "ugly women", "ugly men",
    "dumb women", "dumb men", "crazy women", "crazy men",
    "lazy women", "lazy men", "old women", "old men",

    // Against clients or guests
    "stupid client", "dumb client", "annoying client",
    "ugly client", "bad client", "idiot", "moron",

    // Hate or violence
    "racist", "sexist", "hate", "kill", "die", "suicide", "murder"
  ];
  if (disallowedPhrases.some((p) => text.includes(p))) return false;

  // 🚫 Spammy emoji combos
  if ((caption.match(/🔥|💋|🍑|🍆|💦|🍒|🩱|👙/g) ?? []).length > 2) return false;

  return true;
}

/**
 * Run moderation on a full AI draft and return a safe version or block signal.
 * @param {object} aiJson - { caption, hashtags[], cta, image_url }
 * @param {string} stylistInput
 * @returns {{safe: boolean, result: object}}
 */
/**
 * Moderate AI output for salon-safe content.
 * Returns { safe: boolean, result: object }
 */
export function moderateAIOutput(aiJson, userText = "") {
  try {
    // Mock moderation check — in production this could call OpenAI or another model
    const text = `${aiJson.caption || ""} ${userText || ""}`.toLowerCase();

    // 🚫 Words/phrases to block
    const banned = [
      "nsfw",
      "nude",
      "naked",
      "sex",
      "erotic",
      "violence",
      "blood",
      "weapon",
      "kill",
      "suicide"
    ];

    const found = banned.filter((w) => text.includes(w));

    // 🧠 Decide safe/unsafe
    if (found.length > 0) {
      return {
        safe: false,
        result: {
          ...aiJson,
          _meta: { type: "blocked", reasons: found }
        }
      };
    }

    // ✅ Safe (no violations)
    return {
      safe: true,
      result: {
        ...aiJson,
        _meta: { type: "approved", reasons: [] }
      }
    };
  } catch (err) {
    console.error("⚠️ [Moderation] Error:", err);
    // ✅ Fail open (allow through) if moderation logic fails
    return { safe: true, result: aiJson };
  }
}