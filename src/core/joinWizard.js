// src/core/joinWizard.js
// Chat-driven onboarding that writes to /salons/*.json and confirms

const STEPS = [
  { key: "salon_name",        prompt: "What is your *Salon Name*?" },
  { key: "city",              prompt: "City & State (e.g., *Carmel, IN*)?" },
  { key: "booking_url",       prompt: "Booking URL?" },
  { key: "facebook_page_id",  prompt: "Facebook Page ID?" },
  { key: "facebook_page_token", prompt: "Facebook Page Token? (permanent)" },
  { key: "instagram_handle",  prompt: "Salon Instagram handle (no @)?" },
  { key: "preferred_brand_1", prompt: "Preferred Brand 1 (e.g., Aveda) or 'none'?" },
  { key: "preferred_brand_2", prompt: "Preferred Brand 2 or 'none'?" },
  { key: "custom_hashtags",   prompt: "Salon hashtags (comma separated, e.g., RejuveSalonSpa, CarmelIndiana)" },

  // stylist sub-section
  { key: "stylist_name",      prompt: "Stylist Name?" },
  { key: "stylist_instagram_handle", prompt: "Stylist Instagram handle (no @)?" },
  { key: "stylist_custom_hashtags",  prompt: "Stylist hashtags (comma separated)?" },
  { key: "stylist_specialties",      prompt: "Stylist specialties (comma separated, e.g., balayage, color, mens_grooming)?" },
  { key: "identifier",        prompt: "Identifier for this stylist (Telegram chat ID or phone for SMS)?" }
];

export function isJoinInProgress({ chatId, joinSessions }) {
  return joinSessions.has(chatId);
}

export async function startJoinFlow({ chatId, joinSessions }) {
  joinSessions.set(chatId, { idx: 0, data: {} });
  const step = STEPS[0];
  return `🧾 *Join MostlyPostly*\n\n${step.prompt}\n\n(You can type *CANCEL* anytime.)`;
}

export async function cancelJoinFlow({ chatId, joinSessions }) {
  joinSessions.delete(chatId);
  return "❎ Join cancelled.";
}

export async function handleJoinInput({ chatId, text, joinSessions, salons, saveSalonFile }) {
  const state = joinSessions.get(chatId);
  if (!state) return { message: "Type *JOIN* to begin onboarding.", done: false };

  // cancellation
  if (/^CANCEL\b/i.test(text)) {
    joinSessions.delete(chatId);
    return { message: "❎ Join cancelled.", done: true };
  }

  const step = STEPS[state.idx];
  if (!step) {
    joinSessions.delete(chatId);
    return { message: "⚠️ Wizard state error. Please type JOIN to restart.", done: true };
  }

  // save answer
  state.data[step.key] = text.trim();
  state.idx += 1;

  // if finished, persist
  if (state.idx >= STEPS.length) {
    // normalize fields
    const salonName = state.data.salon_name.trim();
    const safeName = salonName.toLowerCase().replace(/\s+/g, "");
    const salonInfo = {
      salon_name: salonName,
      city: state.data.city.trim(),
      booking_url: state.data.booking_url.trim(),
      facebook_page_id: state.data.facebook_page_id.trim(),
      facebook_page_token: state.data.facebook_page_token.trim(),
      instagram_handle: state.data.instagram_handle.trim(),
      preferred_brand_1: state.data.preferred_brand_1.toLowerCase() === "none" ? "" : state.data.preferred_brand_1.trim(),
      preferred_brand_2: state.data.preferred_brand_2.toLowerCase() === "none" ? "" : state.data.preferred_brand_2.trim(),
      custom_hashtags: (state.data.custom_hashtags || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(h => (h.startsWith("#") ? h : `#${h}`))
    };

    const stylistId = state.data.identifier.trim();
    const stylistRecord = {
      stylist_name: state.data.stylist_name.trim(),
      instagram_handle: state.data.stylist_instagram_handle.trim(),
      custom_hashtags: (state.data.stylist_custom_hashtags || "")
        .split(",").map(s => s.trim()).filter(Boolean).map(h => (h.startsWith("#") ? h : `#${h}`)),
      specialties: (state.data.stylist_specialties || "")
        .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    };

    // create or update salons object in memory
    if (!salons[salonName]) {
      salons[salonName] = {
        salon_info: { ...salonInfo },
        stylists: {}
      };
    } else {
      salons[salonName].salon_info = { ...salonInfo };
    }
    // insert stylist
    salons[salonName].stylists[stylistId] = stylistRecord;

    // persist to file
    saveSalonFile(salonName);

    // verification readback
    const verify = salons[salonName];
    const ok =
      verify?.salon_info?.salon_name === salonName &&
      !!verify?.stylists?.[stylistId]?.stylist_name;

    joinSessions.delete(chatId);

    return {
      message: ok
        ? `✅ *Successfully added!* Salon **${salonName}** and stylist **${stylistRecord.stylist_name}** are now set.\n\nYou can send a photo anytime to preview a post.`
        : `⚠️ Something didn't save correctly. Please type JOIN to try again.`,
      done: true,
      salonNameAdded: salonName
    };
  }

  // ask next
  const next = STEPS[state.idx];
  return { message: next.prompt, done: false };
}
