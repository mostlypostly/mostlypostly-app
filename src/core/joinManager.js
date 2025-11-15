// src/core/joinManager.js
import fs from "fs";
import path from "path";
import { joinSessions } from "./joinSessionStore.js";

/** Handles the initial "JOIN" command from a manager. */
export async function handleJoinCommand(identifier, lookupStylist, messageText, sendMessage) {
  const existing = lookupStylist(identifier);
  if (!existing) {
    await sendMessage("⚠️ You’re not registered with any salon. Please contact your salon manager to be added.");
    return;
  }

  const stylist = existing?.stylist || existing;
  const salon = existing?.salon || null;
  const role = (stylist?.role || "stylist").toLowerCase();

  console.log(
    `🔐 JOIN attempt: ${stylist?.stylist_name || stylist?.name || "Unknown"} (${identifier}) — role: ${role} @ ${
      salon?.salon_info?.name || salon?.salon_info?.salon_name || "Unknown Salon"
    }`
  );

  if (role !== "manager") {
    await sendMessage("🚫 You don’t have permission to add team members.\nOnly salon *managers* can use the Join command.");
    return;
  }

  joinSessions.set(identifier, { step: 1, salon, lookupStylist, data: {} });
  await sendMessage(`🧾 Let's add a new stylist to ${salon?.salon_info?.name || salon?.salon_info?.salon_name || "your salon"}!\n\nWhat is their first name?`);
}

/** Continues an in-progress Join conversation. */
export async function continueJoinConversation(identifier, messageText, sendMessage) {
  const session = joinSessions.get(identifier);
  if (!session) return { done: false };

  const text = (messageText || "").trim();
  const { step, salon, data } = session;

  switch (step) {
    case 1:
      data.name = text;
      session.step = 2;
      await sendMessage(`✅ Got it — ${text}.\nWhat is their phone number?`);
      return { done: false };

    case 2:
      data.contact = text.replace(/\D/g, "");
      session.step = 3;
      await sendMessage(`📱 Thanks! What is their Instagram handle (you can type none)?`);
      return { done: false };

    case 3:
      data.instagram_handle = text.toLowerCase().replace("@", "") === "none" ? "" : text.replace("@", "");
      session.step = 4;
      await sendMessage(`🎨 Great! What are their specialties?\n(Type 1–2, separated by commas, or reply NONE if you’re not sure yet)`);
      return { done: false };

    case 4:
      data.specialties = text.toLowerCase() === "none" || !text.trim()
        ? []
        : text.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 2);
      await finalizeJoin(identifier, sendMessage);
      return { done: true };

    default:
      await sendMessage("⚠️ Unknown join step. Type JOIN to start over.");
      joinSessions.delete(identifier);
      return { done: true };
  }
}

/** Finalizes the stylist addition and writes to salon JSON. */
async function finalizeJoin(identifier, sendMessage) {
  const session = joinSessions.get(identifier);
  if (!session) return;

  const { salon, data } = session;
  const salonDir = "./salons";

  const displayName = salon?.salon_info?.name || salon?.salon_info?.salon_name || "Unknown";
  const safeFileBase =
    (displayName || "unknown").toLowerCase().replace(/\s+/g, "");

  const filePath = path.join(salonDir, `${safeFileBase}.json`);
  if (!fs.existsSync(filePath)) {
    await sendMessage(`⚠️ Salon file for ${displayName} not found.`);
    joinSessions.delete(identifier);
    return;
  }

  const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!json.stylists) json.stylists = [];

  // ✅ ensure salon_id is present
  const computedSalonId =
    json.salon_id ||
    (displayName || "unknown").toLowerCase().replace(/\s+/g, "_");
  json.salon_id = computedSalonId;

  // avoid duplicates
  const already = (json.stylists || []).some(s => (s.phone || "").replace(/\D/g, "") === data.contact);
  if (already) {
    await sendMessage(`⚠️ That contact (${data.contact}) is already registered.`);
    joinSessions.delete(identifier);
    return;
  }

  const newStylist = {
    stylist_name: data.name,
    phone: data.contact,
    instagram_handle: data.instagram_handle || "",
    role: "stylist",
    specialties: data.specialties || [],
    consent: { sms_opt_in: false },
    compliance_opt_in: false,
  };

  json.stylists.push(newStylist);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2));

  console.log(`👤 Added stylist ${data.name} (${data.contact}) to ${displayName} [salon_id=${computedSalonId}]`);
  await sendMessage(
    `✅ ${data.name} has been added to ${displayName}.\nInstagram: @${data.instagram_handle || "N/A"}\nSpecialties: ${data.specialties?.join(", ") || "None"}\n\nThey must reply AGREE once before posting.`
  );

  joinSessions.delete(identifier);
}
