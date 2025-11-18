// src/routes/managerAuth.js

import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../../db.js";

const router = express.Router();

/* -------------------------------
   Utility: Check columns
---------------------------------*/
function managerTableHas(columnName) {
  const cols = db.prepare("PRAGMA table_info(managers)").all();
  return cols.some((c) => c.name === columnName);
}

/* -------------------------------
   GET: Login Page — SENT AS INLINE HTML
   (prevents raw HTML issues & ensures correct content-type)
---------------------------------*/
router.get("/login", (req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Manager Login — MostlyPostly</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">

  <style>
    body { background: #0B1223; }
    .card {
      background: #111827;
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 32px;
    }
    .mp-logo {
      width: 52px;
      margin: 0 auto 12px;
      display: block;
    }
    .footer-text {
      font-size: 12px;
      color: #8892a6;
    }
  </style>
</head>

<body class="text-gray-200">
  <div class="min-h-screen flex flex-col justify-center items-center px-4">

    <div class="card w-full max-w-md mt-4">
      <h2 class="text-center text-3xl font-bold mb-6">Sign In</h2>

      <form method="POST" action="/manager/login">
        <label class="block mb-3">
          <span class="text-gray-300 text-sm">Email Address</span>
          <input type="email" name="email" required
            class="mt-1 w-full p-3 rounded bg-gray-800 border border-gray-700 text-gray-200 focus:ring focus:ring-blue-500" />
        </label>

        <label class="block mb-4">
          <span class="text-gray-300 text-sm">Password</span>
          <input type="password" name="password" required
            class="mt-1 w-full p-3 rounded bg-gray-800 border border-gray-700 text-gray-200 focus:ring focus:ring-blue-500" />
        </label>

        <button type="submit"
          class="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold transition">
          Sign In
        </button>

        <div class="flex justify-between text-sm mt-3">
          <a href="/manager/forgot-password" class="text-blue-400 hover:underline">Forgot password?</a>
          <a href="/manager/signup" class="text-blue-400 hover:underline">Create Account</a>
        </div>
      </form>

      <div class="mt-6 text-center footer-text">
        By continuing, you agree to our
        <a href="/legal/terms" class="text-blue-400 hover:underline">Terms of Service</a>
        and
        <a href="/legal/privacy" class="text-blue-400 hover:underline">Privacy Policy</a>.
      </div>

    </div>

  </div>
</body>
</html>
  `);
});

/* -------------------------------
   POST: Login Submit
---------------------------------*/
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!managerTableHas("email") || !managerTableHas("password_hash")) {
    return res.type("html").send(`
      <h2>Email login not available yet</h2>
      <p>Your account has not been upgraded for password login.</p>
      <a href="/manager/login">Back</a>
    `);
  }

  const mgr = db.prepare(`SELECT * FROM managers WHERE email=?`).get(email);
  if (!mgr) return res.type("html").send("Invalid login");

  const ok = bcrypt.compareSync(password, mgr.password_hash);
  if (!ok) return res.type("html").send("Invalid password");

  req.session.manager_id = mgr.id;
  return res.redirect("/manager");
});

/* -------------------------------
   GET: Signup Page
---------------------------------*/
router.get("/signup", (req, res) => {
  res.type("html").send(`
    <h2>Signup coming soon</h2>
    <p>You will be able to create accounts here.</p>
    <a href="/manager/login">Back to login</a>
  `);
});

/* -------------------------------
   POST: Signup Submit (placeholder)
---------------------------------*/
router.post("/signup", (req, res) => {
  return res.type("html").send("Signup disabled for now.");
});

/* -------------------------------
   GET: Forgot Password
---------------------------------*/
router.get("/forgot-password", (req, res) => {
  res.type("html").send(`
    <h2>Password Reset Coming Soon</h2>
    <p>Reset emails will be available once mail service is active.</p>
    <a href="/manager/login">Back to login</a>
  `);
});

/* -------------------------------
   MAGIC TOKEN LOGIN
---------------------------------*/
router.get("/login-with-token", (req, res) => {
  const token = req.query.token;
  const row = db.prepare("SELECT * FROM manager_tokens WHERE token=?").get(token);

  if (!row) return res.type("html").send("Invalid or expired login link");

  req.session.manager_id = row.manager_id;
  return res.redirect("/manager");
});

export default router;
