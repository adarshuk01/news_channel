const express = require("express");
const {
  postToInstagram,
  postToFacebook,
  postToYoutube,
} = require("../controller/postNewsController");
const { manualPostNews, manualPostNewsJson, streamPostLogs } = require("../controller/manualPostController");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const { login, logout } = require("../controller/authController");

const router = express.Router();

// ✅ MEMORY storage (IMPORTANT for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ── Platform-based news posting routes ───────────────────────────────────────
// Each route fetches BOTH Manorama + Asianet and posts them simultaneously
// to the specified platform.

// POST /api/post-instagram  → posts Manorama + Asianet to Instagram
router.get("/post-instagram", postToInstagram);

// POST /api/post-facebook   → posts Manorama + Asianet to Facebook
router.get("/post-facebook", postToFacebook);

// POST /api/post-youtube    → posts Manorama + Asianet to YouTube Shorts
router.get("/post-youtube", postToYoutube);

// ── Manual post routes ────────────────────────────────────────────────────────
// POST with image file upload
router.post("/manual-post", protect, upload.single("image"), manualPostNews);

// POST with JSON body (imageUrl)
router.post("/manual-post-json", protect, manualPostNewsJson);

// SSE endpoint for log streaming
router.get("/manual-post/stream", protect, streamPostLogs);

// ── Auth routes ───────────────────────────────────────────────────────────────
router.post("/auth/login", login);
router.post("/auth/logout", logout);

// ── Health check ──────────────────────────────────────────────────────────────
router.get("/test", (req, res) => res.send("✅ Route working"));

module.exports = router;
