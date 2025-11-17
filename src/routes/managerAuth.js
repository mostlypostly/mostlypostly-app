import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../../db.js";

const router = express.Router();

// Render login page
router.get("/login", (req, res) => {
  return res.send(`
    <!DOCTYPE html>
    <html class="bg-slate-950 text-slate-50">
    <head>
      <meta charset="utf-8" />
      <title>Manager Login — MostlyPostly</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="min-h-screen flex items-center justify-center">
      <form method="POST" class="bg-slate-900 p-8 rounded-xl border border-slate-800 w-96">
        <h1 class="text-xl font-bold mb-4">Manager Login</h1>
        <input name="email" type="email" placeholder="Email" class="w-full p-3 rounded bg-slate-800 border border-slate-700 mb-3"/>
        <input name="password" type="password" placeholder="Password" class="w-full p-3 rounded bg-slate-800 border border-slate-700 mb-4"/>

        <button class="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg font-medium">
          Sign In
        </button>
      </form>
    </body>
    </html>
  `);
});

// Handle POST login
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const mgr = db.prepare(
    `SELECT * FROM managers WHERE email=?`
  ).get(email);

  if (!mgr) return res.send("Invalid login");

  const ok = bcrypt.compareSync(password, mgr.password_hash);
  if (!ok) return res.send("Invalid password");

  // Save session
  req.session.manager_id = mgr.id;
  return res.redirect("/manager");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/manager/login");
  });
});

export default router;
