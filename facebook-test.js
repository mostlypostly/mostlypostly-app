// facebook-test.js
import dotenv from "dotenv";
import { publishToFacebook } from "./src/publishers/facebook.js";

dotenv.config();

(async () => {
  try {
    const result = await publishToFacebook(
      process.env.FACEBOOK_PAGE_ID,
      process.env.FACEBOOK_PAGE_TOKEN,
      "✨ Test post from Postly! 🚀 #Automation", //hashtag-ok
      "https://images.unsplash.com/photo-1519741497674-611481863552"
    );
    console.log("✅ Facebook API Response:", result);
  } catch (err) {
    console.error("❌ Facebook API Test Failed:", err);
  }
})();
