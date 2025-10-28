import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const PUBLIC_DIR = path.resolve("public/uploads");
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

export async function rehostTwilioMedia(twilioUrl) {
  if (!/^https:\/\/api\.twilio\.com/i.test(twilioUrl)) {
    console.log("✅ Skipping rehost, already public:", twilioUrl);
    return twilioUrl;
  }

  console.log("🌐 Rehosting Twilio media:", twilioUrl);
  const authHeader =
    "Basic " +
    Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString("base64");

  const response = await fetch(twilioUrl, {
    headers: { Authorization: authHeader },
    redirect: "follow", // 👈 important
  });

  if (!response.ok) {
    throw new Error(`Twilio media fetch failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = `twilio-${Date.now()}.jpg`;
  const filePath = path.join(PUBLIC_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  const publicUrl = `${process.env.PUBLIC_BASE_URL}/uploads/${fileName}`;
  console.log("✅ Twilio media rehosted:", publicUrl);
  return publicUrl;
}
