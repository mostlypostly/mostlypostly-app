// routes/posts.js — Postly Posts API (ESM version, Safari Date fix)
import express from "express";

export default function postsRoute(db) {
  const router = express.Router();

  function normalizeCreatedAt(row) {
    if (!row?.created_at) return row;

    // SQLite format: "YYYY-MM-DD HH:MM:SS"
    // Convert to ISO for Safari
    const iso = row.created_at.replace(" ", "T") + "Z";

    let formatted = row.created_at;
    try {
      formatted = new Date(iso).toLocaleString();
    } catch {
      // fallback: leave original value
    }

    return {
      ...row,
      created_at_formatted: formatted,
    };
  }

  // Fetch all posts
  router.get("/", (req, res) => {
    db.all(
      "SELECT * FROM posts ORDER BY created_at DESC",
      [],
      (err, rows) => {
        if (err) {
          console.error("⚠️ DB error (posts):", err);
          return res.status(500).send("Database error");
        }

        const normalized = rows.map(normalizeCreatedAt);
        res.json(normalized);
      }
    );
  });

  // Fetch single post by ID
  router.get("/:id", (req, res) => {
    db.get(
      "SELECT * FROM posts WHERE id = ?",
      [req.params.id],
      (err, row) => {
        if (err) {
          console.error("⚠️ DB error (single post):", err);
          return res.status(500).send("Database error");
        }
        if (!row) return res.status(404).send("Post not found");

        res.json(normalizeCreatedAt(row));
      }
    );
  });

  return router;
}
