"use strict";

const crypto       = require("crypto");
const path         = require("path");
const fs           = require("fs");

const newsService   = require("../services/newsServices");
const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");
const cloudinary    = require("../config/cloudinary");
const redis         = require("../config/redis");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { uploadShort }         = require("../services/youtubeShorts");
const { getNextAdBannerUrl }  = require("./adBannerController");
const { TMP, safeDelete, cleanImageUrl } = require("../utils/fileUtils");

const PLATFORMS = ["instagram", "facebook", "youtube"];

// ─── Stable ID from title ─────────────────────────────────────────────────────
function makeNewsId(title) {
  return crypto.createHash("md5").update(title || "").digest("hex").slice(0, 12);
}

// ─── GET /api/news/list ───────────────────────────────────────────────────────
// Returns latest news from Manorama + Asianet.
exports.getNewsList = async (req, res) => {
  try {
    const allNews = await newsService.fetchAllLatestNews();

    const news = allNews.map((item) => ({
      id:      makeNewsId(item.title),
      title:   item.title,
      summary: item.summary || "",
      image:   item.image   || "",
      link:    item.link    || "",
      channel: item.channel || "",
      icon:    item.icon    || "",
    }));

    return res.json({ news, total: news.length });
  } catch (err) {
    console.error("❌ getNewsList error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/news/post-status ────────────────────────────────────────────────
// Query: ?ids=abc,def,ghi
// Returns per-id per-platform posted flags.
exports.getPostStatus = async (req, res) => {
  try {
    const ids = (req.query.ids || "").split(",").filter(Boolean);

    const statuses = {};
    for (const id of ids) {
      const [insta, fb, yt] = await Promise.all([
        redis.get(`posted:instagram:${id}`),
        redis.get(`posted:facebook:${id}`),
        redis.get(`posted:youtube:${id}`),
      ]);
      statuses[id] = {
        instagram: !!insta,
        facebook:  !!fb,
        youtube:   !!yt,
      };
    }

    return res.json({ statuses });
  } catch (err) {
    console.error("❌ getPostStatus error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/news/post-item ─────────────────────────────────────────────────
// Body: { newsId, platform, title, summary, image }
// Builds poster → video → Cloudinary → posts → marks Redis.
exports.postNewsItem = async (req, res) => {
  const { newsId, platform, title, summary, image } = req.body;

  if (!newsId || !platform || !title) {
    return res.status(400).json({ error: "newsId, platform and title are required." });
  }

  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(", ")}.` });
  }

  // Already posted?
  const alreadyPosted = await redis.get(`posted:${platform}:${newsId}`);
  if (alreadyPosted) {
    return res.status(409).json({ error: `Already posted to ${platform}.`, posted: true });
  }

  const timestamp  = Date.now();
  const imgFile    = path.join(TMP, `newsitem-${newsId}-${timestamp}.png`);
  const vidFile    = path.join(TMP, `newsitem-${newsId}-${timestamp}.mp4`);

  try {
    console.log(`🚀 Posting [${platform}] news: ${title.slice(0, 60)}`);

    // 1 — Hashtags
    const hashtags = await aiService.generateHashtags(`${title} ${summary || ""}`);

    // 2 — Ad banner (round-robin)
    const adBannerUrl = await getNextAdBannerUrl();

    // 3 — Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title,
      summary:    summary || "",
      image:      cleanImageUrl(image),
      adBannerUrl,
    });
    fs.writeFileSync(imgFile, pngBuffer);

    // 4 — Convert to video
    await videoService.convertImageToVideo(imgFile, vidFile);

    // 5 — Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(vidFile, {
      resource_type: "video",
      folder:        "news_posters",
    });
    const finalUrl = upload.secure_url;
    console.log(`🔗 Cloudinary [${platform}]:`, finalUrl);

    safeDelete(imgFile, vidFile);

    // 6 — Build captions
    const safeTitle  = (title || "").replace(/\s+/g, " ").trim().slice(0, 90);
    const finalTitle = `${safeTitle} 🔥 #Shorts`;

    const captions = {
      instagram: `LIKE & FOLLOW 💯\n${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags} #kerala #malayalam #keralanews`,
      facebook:  `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags}`,
      youtube:   `${summary}\n\n${hashtags} #Shorts`,
    };

    // 7 — Post to platform
    if (platform === "instagram") await postReelToInstagram(finalUrl, captions.instagram);
    if (platform === "facebook")  await postReelToFacebook(finalUrl, captions.facebook);
    if (platform === "youtube")   await uploadShort(finalUrl, finalTitle, captions.youtube);

    // 8 — Mark in Redis (30-day TTL)
    await redis.set(`posted:${platform}:${newsId}`, "1", { ex: 60 * 60 * 24 * 30 });

    console.log(`✅ Posted [${platform}] for news ${newsId}`);
    return res.json({ success: true, platform, newsId, videoUrl: finalUrl });

  } catch (err) {
    safeDelete(imgFile, vidFile);
    console.error(`❌ postNewsItem [${platform}] error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
