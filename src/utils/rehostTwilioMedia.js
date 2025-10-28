import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const PUBLIC_DIR = path.resolve("public/uploads");
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

export async function rehostTwilioMedia(twilioUrl) {
  if (!/^https:\/\/api\.twilio\.com/i.test(twilioUrl)) {
    // already public
    return twilioUrl;
  }
  console.log("🔐 TWILIO_ACCOUNT_SID exists?", !!process.env.TWILIO_ACCOUNT_SID);
  console.log("🔐 TWILIO_AUTH_TOKEN exists?", !!process.env.TWILIO_AUTH_TOKEN);

  console.log("🌐 Rehosting Twilio media:", twilioUrl);
  const res = await fetch(twilioUrl, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
    },
  });
  if (!res.ok) throw new Error(`Twilio media fetch failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const fileName = `twilio-${Date.now()}.jpg`;
  const filePath = path.join(PUBLIC_DIR, fileName);
  fs.writeFileSync(filePath, buf);

  const publicUrl = `${process.env.PUBLIC_BASE_URL}/uploads/${fileName}`;
  console.log("✅ Twilio media rehosted:", publicUrl);
  return publicUrl;
}