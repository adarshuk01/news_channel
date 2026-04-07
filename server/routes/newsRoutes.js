const express = require("express");
const {
  postLatestNews,
  postAsianetNews,
} = require("../controller/postNewsController");

const router = express.Router();

// ── News routes ───────────────────────────────────────────────────────────
router.get("/post-manorama-latest-news", postLatestNews);
router.get("/post-asianet-latest-news",  postAsianetNews);

// ── Health check ──────────────────────────────────────────────────────────
router.get("/test", (req, res) => res.send("✅ Route working"));

module.exports = router;