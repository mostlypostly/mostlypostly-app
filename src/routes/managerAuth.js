import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../../db.js";
import dayjs from "dayjs";

const router = express.Router();

/* -------------------------------
   Utility: Check columns
---------------------------------*/
function managerTableHas(columnName) {
  const cols = db.prepare("PRAGMA table_info(managers)").all();
  return cols.some(c => c.name === columnName);
}

/* -------------------------------
   GET: Login Page
---------------------------------*/
router.get("/login", (req, res) => {
  return res.sendFile("public/manager-login.html", { root: process.cwd() });
});

/* -------------------------------
   POST: Login Submit
---------------------------------*/
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!managerTableHas("email") || !managerTableHas("password_hash")) {
    return res.send(`
      <h2>Email login not available yet</h2>
      <p>Your account has not been upgraded for password login.</p>
      <a href="/manager/login">Back</a>
    `);
  }

  const mgr = db.prepare(`SELECT * FROM managers WHERE email=?`).get(email);
  if (!mgr) return res.send("Invalid login");

  const ok = bcrypt.compareSync(password, mgr.password_hash);
  if (!ok) return res.send("Invalid password");

  req.session.manager_id = mgr.id;
  return res.redirect("/manager");
});

/* -------------------------------
   GET: Signup Page
---------------------------------*/
router.get("/signup", (req, res) => {
  return res.sendFile("public/manager-signup.html", { root: process.cwd() });
});

/* -------------------------------
   POST: Signup Submit
---------------------------------*/
router.post("/signup", (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!managerTableHas("email") || !managerTableHas("password_hash")) {
    return res.send("Signup unavailable: database missing email/password columns.");
  }

  // Hash password
  const hash = bcrypt.hashSync(password, 10);

  // Insert manager
  db.prepare(`
    INSERT INTO managers (id, name, phone, email, password_hash, salon_id)
    VALUES (
      lower(hex(randomblob(16))),
      ?, ?, ?, ?, ?
    )
  `).run(name, phone, email, hash, "rejuve-salon-spa");  // TODO: dynamic salon assignment

  return res.redirect("/manager/login");
});

/* -------------------------------
   GET: Forgot Password (placeholder)
---------------------------------*/
router.get("/forgot-password", (req, res) => {
  return res.send(`
    <h2>Password Reset Coming Soon</h2>
    <p>We will send reset instructions once email delivery is configured.</p>
    <a href="/manager/login">Back to login</a>
  `);
});

/* -------------------------------
   Magic token login (unchanged)
---------------------------------*/
router.get("/login-with-token", (req, res) => {
  const token = req.query.token;
  const row = db.prepare(
    "SELECT * FROM manager_tokens WHERE token=?"
  ).get(token);

  if (!row) return res.send("Invalid or expired login link");

  req.session.manager_id = row.manager_id;
  return res.redirect("/manager");
});

export default router;
