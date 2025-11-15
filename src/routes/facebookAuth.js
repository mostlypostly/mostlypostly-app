import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const FB_OAUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth";
const FB_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const FB_API_URL = "https://graph.facebook.com/v19.0";

function getRedirectUri() {
  const uri = process.env.FB_REDIRECT_URI;
  if (!uri) throw new Error("FB_REDIRECT_URI missing in .env");
  return uri;
}

// -----------------------------
// STEP 1: LOGIN START
// -----------------------------
router.get("/login", (req, res) => {
  const salonFromQuery = req.query.salon;
  const salonFromManager = req.manager?.salon_id;
  const salon_id = salonFromQuery || salonFromManager || "unknown";

  const clientId = process.env.FACEBOOK_APP_ID;
  const redirectUri = getRedirectUri();

    const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_manage_metadata",
      "instagram_basic",
      "instagram_content_publish",
      "business_management",
    ].join(","),
    state: JSON.stringify({ salon_id }),
  });

  return res.redirect(`${FB_OAUTH_URL}?${params.toString()}`);
});

// -----------------------------
// STEP 2: CALL BACK
// -----------------------------
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  let salon_id = "unknown";
  try {
    salon_id = JSON.parse(state)?.salon_id || "unknown";
  } catch {}

  const clientId = process.env.FACEBOOK_APP_ID;
  const clientSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = getRedirectUri();

  // Exchange code for User Token
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });

  const tokenResp = await fetch(`${FB_TOKEN_URL}?${tokenParams}`);
  const tokenJson = await tokenResp.json();

  const userAccessToken = tokenJson.access_token;

  // Fetch pages
  const pagesResp = await fetch(
    `${FB_API_URL}/me/accounts?access_token=${userAccessToken}`
  );
  const pages = (await pagesResp.json()).data || [];

  // Build HTML response
  let pageSnippets = "";
  for (const p of pages) {
    pageSnippets += `
<h3>${p.name} (Page ID: ${p.id})</h3>
<pre>{
  "facebook_page_id": "${p.id}",
  "facebook_page_token": "${p.access_token}",
  "instagram_business_id": "",
  "instagram_handle": "",
  "timezone": "America/Indiana/Indianapolis"
}</pre>
<hr>
`;
  }

  res.send(`
<h1>Facebook Connected for salon: ${salon_id}</h1>
<p>Copy one Page snippet below into salons/${salon_id}.json under "salon_info".</p>
${pageSnippets}
`);
});

export default router;
