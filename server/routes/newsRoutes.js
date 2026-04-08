const express = require("express");
const {
  postLatestNews,
  postAsianetNews,
} = require("../controller/postNewsController");
const { manualPostNews, streamPostLogs } = require("../controller/manualPostController");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const { login, logout } = require("../controller/authController");

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
router.post("/manual-post",protect, upload.single("image"), manualPostNews);

// OR JSON (imageUrl)
router.post("/manual-post-json",protect, manualPostNews);

 
// ✅ SSE endpoint for log streaming
router.get("/manual-post/stream",protect, streamPostLogs);

router.post("/auth/login", login);
router.post("/auth/logout", logout);

// ── Health check ──────────────────────────────────────────────────────────
router.get("/test", (req, res) => res.send("✅ Route working"));

module.exports = router;