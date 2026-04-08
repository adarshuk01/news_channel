const express = require("express");
const {
  postLatestNews,
  postAsianetNews,
} = require("../controller/postNewsController");
const { manualPostNews, streamPostLogs } = require("../controller/manualPostController");
const multer = require("multer");

const router = express.Router();

// ✅ MEMORY storage (IMPORTANT for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ── News routes ───────────────────────────────────────────────────────────
router.get("/post-manorama-latest-news", postLatestNews);
router.get("/post-asianet-latest-news",  postAsianetNews);

// POST with image upload
router.post("/manual-post", upload.single("image"), manualPostNews);

// OR JSON (imageUrl)
router.post("/manual-post-json", manualPostNews);

 
// ✅ SSE endpoint for log streaming
router.get("/manual-post/stream", streamPostLogs);

// ── Health check ──────────────────────────────────────────────────────────
router.get("/test", (req, res) => res.send("✅ Route working"));

module.exports = router;