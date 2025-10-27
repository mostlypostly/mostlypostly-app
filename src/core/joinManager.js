import fs from "fs";
import path from "path";
import { joinSessions } from "./joinSessionStore.js";

/**
 * Handles the initial "join" command from a manager.
 * Starts a conversational flow to collect new stylist info.
 */
export async function handleJoinCommand(identifier, lookupStylist, messageText, sendMessage) {
  const existing = lookupStylist(identifier);

  if (!existing) {
    await sendMessage(
      identifier,
      "⚠️ You’re not registered with any salon. Please contact your salon manager to be added."
    );
    return;
  }

  const stylist = existing?.stylist || existing;
  const salon = existing?.salon || null;
  const role = (stylist?.role || "stylist").toLowerCase();

  console.log(
    `🔐 JOIN attempt: ${stylist?.stylist_name || "Unknown"} (${identifier}) — role: ${role} @ ${
      salon?.salon_name || "Unknown Salon"
    }`
  );

  if (role !== "manager") {
    await sendMessage(
      identifier,
      "🚫 You don’t have permission to add team members.\nOnly salon *managers* can use the Join command."
    );
    return;
  }

  // Start new join session
  joinSessions.set(identifier, {
    step: 1,
    salon,
    lookupStylist,
    data: {}
  });

  await sendMessage(
    identifier,
    `🧾 *Let's add a new stylist to ${salon?.salon_name || "your salon"}!*\n\nWhat is their *first name*?`
  );
}

/**
 * Continues an in-progress Join conversation.
 */
export async function continueJoinConversation(identifier, messageText, sendMessage) {
  const session = joinSessions.get(identifier);
  if (!session) return { done: false };

  const text = (messageText || "").trim();
  const { step, salon, data } = session;

  // Step 1: First Name
  if (step === 1) {
    data.name = text;
    session.step = 2;
    await sendMessage(identifier, `✅ Got it — *${text}*.\nWhat is their *phone number or Telegram ID*?`);
    return { done: false };
  }

  // Step 2: Contact
  if (step === 2) {
    data.contact = text.replace(/\D/g, ""); // sanitize digits
    session.step = 3;
    await sendMessage(identifier, `📱 Thanks! What is their *Instagram handle* (without @)?`);
    return { done: false };
  }

  // Step 3: Instagram handle
  if (step === 3) {
    data.instagram_handle = text.replace("@", "");
    session.step = 4;
    await sendMessage(
      identifier,
      `🎨 Perfect! Now select up to *2 specialties* for them.\n\nAvailable options:\n• balayage\n• color\n• mens_grooming\n• vivid\n• extensions\n\n(Type them separated by commas)`
    );
    return { done: false };
  }

  // Step 4: Specialties
  if (step === 4) {
    const valid = ["balayage", "color", "mens_grooming", "vivid", "extensions"];
    const specialties = text
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(s => valid.includes(s))
      .slice(0, 2);

    data.specialties = specialties.length ? specialties : [];
    session.step = 5;

    // Proceed to final save
    await finalizeJoin(identifier, sendMessage);
    return { done: true };
  }

  return { done: false };
}

/**
 * Finalizes the stylist addition and writes to salon JSON.
 */
async function finalizeJoin(identifier, sendMessage) {
  const session = joinSessions.get(identifier);
  if (!session) return;

  const { salon, data } = session;
  const salonDir = "./salons";
  const filePath = path.join(
    salonDir,
    `${salon.salon_name.replace(/\s+/g, "").toLowerCase()}.json`
  );

  if (!fs.existsSync(filePath)) {
    await sendMessage(identifier, `⚠️ Salon file for ${salon.salon_name} not found.`);
    joinSessions.delete(identifier);
    return;
  }

  const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!json.stylists) json.stylists = {};

  if (json.stylists[data.contact]) {
    await sendMessage(
      identifier,
      `⚠️ That contact (${data.contact}) is already registered as ${json.stylists[data.contact].stylist_name}.`
    );
    joinSessions.delete(identifier);
    return;
  }

  // Add new stylist
  json.stylists[data.contact] = {
    stylist_name: data.name,
    salon_name: salon.salon_name,
    city: salon.city,
    instagram_handle: data.instagram_handle || "",
    facebook_handle: "",
    role: "stylist",
    specialties: data.specialties || []
  };

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2));

  console.log(`👤 Added stylist ${data.name} (${data.contact}) to ${salon.salon_name}`);
  await sendMessage(
    identifier,
    `✅ *${data.name}* has been added to *${salon.salon_name}*.\nInstagram: @${
      data.instagram_handle || "N/A"
    }\nSpecialties: ${data.specialties?.join(", ") || "None"}\n\nThey can now post using MostlyPostly!`
  );

  joinSessions.delete(identifier);
}