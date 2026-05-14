"use strict";

const path = require("path");
const fs   = require("fs");

const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");
const cloudinary    = require("../config/cloudinary");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { uploadShort }         = require("../services/youtubeShorts");

const { TMP, safeDelete } = require("../utils/fileUtils");
const { getNextAdBannerUrl } = require("./adBannerController");

// ─────────────────────────────────────────────
// Active SSE connections  { sessionId → res }
// ─────────────────────────────────────────────
const activeStreams = new Map();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function keepMalayalamAndSpaces(text) {
  return text || "";
}

function getSafeYouTubeTitle(text) {
  if (!text || !text.trim()) return "Latest News #Shorts";
  return text.toString().replace(/\s+/g, " ").trim().slice(0, 90);
}

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sendSSEMessage(res, type, data) {
  const timestamp = new Date().toLocaleTimeString();
  res.write(`data: ${JSON.stringify({ type, data, timestamp })}\n\n`);
}

function broadcastLog(sessionId, type, message) {
  const stream = activeStreams.get(sessionId);
  if (stream && !stream.destroyed) {
    sendSSEMessage(stream, type, { message });
    return true;
  }
  return false;
}

function waitForSSEClient(sessionId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (activeStreams.has(sessionId)) return resolve(true);

    const interval = 100;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += interval;
      if (activeStreams.has(sessionId)) {
        clearInterval(timer);
        return resolve(true);
      }
      if (elapsed >= timeoutMs) {
        clearInterval(timer);
        return resolve(false);
      }
    }, interval);
  });
}

// ─────────────────────────────────────────────
// SSE endpoint  GET /api/manual-post/stream
// ─────────────────────────────────────────────
exports.streamPostLogs = (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.flushHeaders?.();

  activeStreams.set(sessionId, res);
  sendSSEMessage(res, "connected", { sessionId });

  req.on("close", () => activeStreams.delete(sessionId));
};

// ─────────────────────────────────────────────
// Core processing logic
// ─────────────────────────────────────────────
async function processPost({ sessionId, title, description, imageUrl, uploadedFile }) {
  const timestamp   = Date.now();
  const imgFilePath = path.join(TMP, `manual-${timestamp}.png`);
  const vidFilePath = path.join(TMP, `manual-${timestamp}.mp4`);

  try {
    // ── Wait for SSE client ───────────────────────────────────────────────
    const connected = await waitForSSEClient(sessionId);
    if (!connected) {
      console.warn(`[${sessionId}] SSE client never connected – proceeding without live logs`);
    }

    // ── Validation ────────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "📋 Validating inputs…");

    if (!title || !description) {
      broadcastLog(sessionId, "error", "❌ Title and description are required");
      return;
    }

    const cleanTitle = keepMalayalamAndSpaces(title);
    const safeTitle  = getSafeYouTubeTitle(cleanTitle);
    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    broadcastLog(sessionId, "success", `✅ Title: "${finalTitle}"`);

    // ── Image source ──────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "🖼️ Processing image…");

    let imageSource;

    if (uploadedFile) {
      imageSource = `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString("base64")}`;
      broadcastLog(sessionId, "success", "✅ File uploaded successfully");
    } else if (imageUrl) {
      imageSource = imageUrl;
      broadcastLog(sessionId, "success", "✅ Image URL loaded");
    } else {
      broadcastLog(sessionId, "error", "❌ No image provided");
      return;
    }

    // ── AI Content (summary + hashtags) ───────────────────────────────────
    broadcastLog(sessionId, "info", "🤖 Generating AI summary and hashtags…");

    const aiContent = await aiService.generateNewsContent(
      `${title}\n\n${description.slice(0, 500)}`
    );
    const viralTitle =
  aiContent.viralTitle || title;

    const summary  = aiContent.summary  || description;
    const hashtags = aiContent.hashtags || "";

    broadcastLog(sessionId, "success", `✅ Summary ready`);
    broadcastLog(sessionId, "success", `✅ Hashtags: ${hashtags}`);

    // ── Poster ────────────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "🎨 Creating news poster…");

    const adBannerUrl = await getNextAdBannerUrl();

    const pngBuffer = await canvasService.createNewsPoster({
      title:        viralTitle || title,
      summary,                          // ← AI-generated summary on poster
      image:        imageSource,
      adBannerUrl,
    });

    fs.writeFileSync(imgFilePath, pngBuffer);
    broadcastLog(sessionId, "success", "✅ Poster created");

    // ── Video ─────────────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "🎬 Converting image to video…");
    try {
      await videoService.convertImageToVideo(imgFilePath, vidFilePath);
      broadcastLog(sessionId, "success", "✅ Video conversion complete");
    } catch (videoErr) {
      broadcastLog(sessionId, "error", `❌ Video conversion failed: ${videoErr.message}`);
      throw videoErr;
    }

    // ── Cloudinary ────────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "☁️ Uploading to Cloudinary…");
    const upload = await cloudinary.uploader.upload(vidFilePath, {
      resource_type: "video",
      folder:        "manual_posts",
    });
    const finalUrl = upload.secure_url;
    broadcastLog(sessionId, "success", "✅ Cloudinary upload complete");

    // ── Captions ──────────────────────────────────────────────────────────
    const instaCaption = `LIKE & FOLLOW  💯 \n ${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags} #kerala #malayalam #keralagoodnews #keralanews #മലയാളം`;
    const fbCaption    = `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags}`;
    const ytCaption    = `${summary}\n\n${hashtags} #Shorts`;

    // ── Platform posting ──────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "📱 Starting multi-platform posting…");

    const platforms = [
      { name: "Instagram", fn: () => postReelToInstagram(finalUrl, instaCaption) },
      { name: "Facebook",  fn: () => postReelToFacebook(finalUrl, fbCaption)    },
      { name: "YouTube",   fn: () => uploadShort(vidFilePath, finalTitle, ytCaption) },
    ];

    for (const platform of platforms) {
      broadcastLog(sessionId, "info", `⏳ Posting to ${platform.name}…`);
      try {
        await platform.fn();
        broadcastLog(sessionId, "success", `✅ ${platform.name} posted`);
      } catch (err) {
        broadcastLog(sessionId, "error", `❌ ${platform.name} failed: ${err.message}`);
      }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────
    broadcastLog(sessionId, "info", "🧹 Cleaning up temporary files…");
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);
    broadcastLog(sessionId, "success", "✅ Cleanup complete");

    broadcastLog(sessionId, "complete", "🎉 All done! Your post is live!");

  } catch (err) {
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);
    console.error(`[${sessionId}] ❌ ERROR:`, err.message);
    broadcastLog(sessionId, "error", `❌ Fatal error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// POST /api/manual-post  (multipart/form-data)
// ─────────────────────────────────────────────
exports.manualPostNews = (req, res) => {
  const { title, description, imageUrl } = req.body;
  const uploadedFile = req.file;

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required" });
  }

  if (!uploadedFile && !imageUrl) {
    return res.status(400).json({ error: "Provide an image file or imageUrl" });
  }

  const sessionId = generateSessionId();

  res.json({
    message:   "Processing started",
    sessionId,
  });

  processPost({ sessionId, title, description, imageUrl, uploadedFile });
};

// ─────────────────────────────────────────────
// POST /api/manual-post-json  (application/json)
// ─────────────────────────────────────────────
exports.manualPostNewsJson = (req, res) => {
  const { title, description, imageUrl } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required" });
  }

  if (!imageUrl) {
    return res.status(400).json({ error: "imageUrl is required" });
  }

  const sessionId = generateSessionId();

  res.json({
    message:   "Processing started",
    sessionId,
  });

  processPost({ sessionId, title, description, imageUrl, uploadedFile: null });
};