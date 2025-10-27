// routes/analytics.js — counts posts per stylist
import express from "express";

export default function analyticsRoute(db) {
  const router = express.Router();

  router.get("/", (req, res) => {
    db.all(
      `SELECT stylist_name, COUNT(*) as total_posts 
       FROM posts 
       GROUP BY stylist_name 
       ORDER BY total_posts DESC`,
      [],
      (err, rows) => {
        if (err) {
          console.error("⚠️ Analytics DB error:", err);
          return res.status(500).send("DB error");
        }
        res.json(rows);
      }
    );
  });

  return router;
}
