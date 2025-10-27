// routes/posts.js — Postly Posts API (ESM version)
import express from "express";

export default function postsRoute(db) {
  const router = express.Router();

  // Fetch all posts
  router.get("/", (req, res) => {
    db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, rows) => {
      if (err) {
        console.error("⚠️ DB error (posts):", err);
        return res.status(500).send("Database error");
      }
      res.json(rows);
    });
  });

  // Fetch single post by ID
  router.get("/:id", (req, res) => {
    db.get("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, row) => {
      if (err) {
        console.error("⚠️ DB error (single post):", err);
        return res.status(500).send("Database error");
      }
      if (!row) return res.status(404).send("Post not found");
      res.json(row);
    });
  });

  return router;
}
