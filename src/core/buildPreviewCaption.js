// src/core/buildPreviewCaption.js
// ✅ Unified preview builder for Telegram + Twilio with consistent spacing

import { composeFinalCaption } from "./composeFinalCaption.js";

function prettifyBody(body) {
  // adds blank lines between logical sections, even if composeFinalCaption used \n only
  const lines = String(body || "").split("\n").map(l => l.replace(/\s+$/g, ""));
  const out = [];
  const isStyled = (s) => /^Styled by /.test(s);
  const isHashtag = (s) => /^#/.test(s);
  const isCTA = (s) => /^(_.*_|Book\b|Schedule\b)/i.test(s);
  const isBooking = (s) => /^Book:\s/i.test(s);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const prev = out.length ? out[out.length - 1] : "";
    const prevTrim = prev.trim();

    let needBlankBefore = false;
    if (isStyled(ln)) {
      if (out.length && prevTrim !== "") needBlankBefore = true;
    } else if (isHashtag(ln)) {
      if (!isHashtag(prevTrim) && prevTrim !== "") needBlankBefore = true;
    } else if (isCTA(ln)) {
      if (isHashtag(prevTrim)) needBlankBefore = true;
    } else if (isBooking(ln)) {
      if (prevTrim !== "" && !isCTA(prevTrim)) needBlankBefore = true;
    }

    if (needBlankBefore && out.length && out[out.length - 1] !== "") out.push("");
    out.push(ln);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPreviewCaption({
  aiJson = {},
  stylist = {},
  salon = {},
  platform = "telegram", // future platform-specific tweaks
}) {
  const stylistName = stylist.stylist_name || stylist.name || "Team Member";
  const handle = stylist.instagram_handle
    ? stylist.instagram_handle.replace(/^@/, "")
    : null;

  const bookingUrl =
    stylist.booking_url ||
    salon?.salon_info?.booking_url ||
    "";

  // build unified caption once
  const unifiedCaption = composeFinalCaption({
    caption: aiJson.caption,
    hashtags: aiJson.hashtags,
    cta: aiJson.cta,
    instagramHandle: stylist.instagram_handle,
    stylistName,
    bookingUrl,
    salon,
    asHtml: false,
  });

  // prettify spacing for preview text
  const prettyBody = prettifyBody(unifiedCaption);

  const previewText = [
    "💇‍♀️ *MostlyPostly Preview (Full Post)*",
    "",
    prettyBody,
    "",
    "Reply *APPROVE* to continue, *REGENERATE*, or *RESET* to stop.",
  ].join("\n");

  return { unifiedCaption, previewText };
}
