"use strict";

const axios        = require("axios");
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

// ─── Proxy an image URL → base64 data URI ────────────────────────────────────
// Used for sources (like 24 News / WordPress) that block direct server fetches
// due to hotlink protection or missing CORS / Referer checks.
async function proxyImageToBase64(imageUrl) {
  if (!imageUrl) return "";
  try {
    // Derive the origin to send as Referer so hotlink checks pass
    const origin = new URL(imageUrl).origin;
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        Referer: `${origin}/`,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    const mime = response.headers["content-type"] || "image/jpeg";
    const b64  = Buffer.from(response.data).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    console.warn("⚠️ proxyImageToBase64 failed for", imageUrl, "→", err.message);
    return "";
  }
}

// ─── Channels whose images need server-side proxying ─────────────────────────
const PROXY_REQUIRED_CHANNELS = ["24 News"];

// ─── Resolve image for canvas: proxy if needed, otherwise clean URL ───────────
async function resolveImageForCanvas(imageUrl, channel) {
  const clean = cleanImageUrl(imageUrl);
  if (!clean) return "";

  if (PROXY_REQUIRED_CHANNELS.includes(channel)) {
    console.log(`🔄 Proxying image for [${channel}]:`, clean);
    return await proxyImageToBase64(clean);
  }

  return clean;
}

// ─── GET /api/news/list ───────────────────────────────────────────────────────
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
      readableTime: item.readableTime || "",
    }));

    return res.json({ news, total: news.length });
  } catch (err) {
    console.error("❌ getNewsList error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/news/post-status ────────────────────────────────────────────────
// Query: ?ids=abc,def,ghi
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
// Body: { newsId, platform, title, summary, image, channel }
exports.postNewsItem = async (req, res) => {
  const { newsId, platform, title, summary, image, channel } = req.body;

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

  const timestamp = Date.now();
  const imgFile   = path.join(TMP, `newsitem-${newsId}-${timestamp}.png`);
  const vidFile   = path.join(TMP, `newsitem-${newsId}-${timestamp}.mp4`);

  try {
    console.log(`🚀 Posting [${platform}] | channel: ${channel} | ${title.slice(0, 60)}`);

    // 1 — Hashtags
    const hashtags = await aiService.generateHashtags(`${title} ${summary || ""}`);

    // 2 — Ad banner (round-robin)
    const adBanner       = await getNextAdBannerUrl(); // { url, resourceType } | null
    const adBannerUrl    = adBanner?.url    || null;
    const adResourceType = adBanner?.resourceType || null;

    // 3 — Resolve image (proxy for channels that need it, e.g. 24 News)
    const resolvedImage = await resolveImageForCanvas(image, channel);

    // 4 — Create poster
    const posterResult = await canvasService.createNewsPoster({
      title,
      summary:    summary || "",
      image:      resolvedImage,
      adBannerUrl,
      adResourceType,
    });
    // posterResult is { type: "image"|"video", buffer, liveAdVideoUrl, adH }

    let finalUrl;

    if (posterResult.type === "video") {
      // FFmpeg already composited the MP4 inside canvasService — upload directly
      fs.writeFileSync(vidFile, posterResult.buffer);
      const upload = await cloudinary.uploader.upload(vidFile, {
        resource_type: "video",
        folder:        "news_posters",
      });
      finalUrl = upload.secure_url;
    } else {
      // PNG poster — convert to video (with live ad composite if applicable) then upload
      fs.writeFileSync(imgFile, posterResult.buffer);
      // 5 — Convert to video
      await videoService.convertImageToVideo(imgFile, vidFile, {
        adVideoInput: posterResult.liveAdVideoUrl || null,
        adH:          posterResult.adH            || null,
      });
      // 6 — Upload to Cloudinary
      const upload = await cloudinary.uploader.upload(vidFile, {
        resource_type: "video",
        folder:        "news_posters",
      });
      finalUrl = upload.secure_url;
    }

    console.log(`🔗 Cloudinary [${platform}]:`, finalUrl);
    safeDelete(imgFile, vidFile);

    // 7 — Build captions
    const safeTitle  = (title || "").replace(/\s+/g, " ").trim().slice(0, 90);
    const finalTitle = `${safeTitle} 🔥 #Shorts`;

    const captions = {
      instagram: `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags} #kerala #malayalam #keralanews`,
      facebook:  `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags}`,
      youtube:   `${summary}\n\n${hashtags} #Shorts`,
    };

    // 8 — Post to platform
    if (platform === "instagram") await postReelToInstagram(finalUrl, captions.instagram);
    if (platform === "facebook")  await postReelToFacebook(finalUrl, captions.facebook);
    if (platform === "youtube")   await uploadShort(finalUrl, finalTitle, captions.youtube);

    // 9 — Mark in Redis (30-day TTL)
    await redis.set(`posted:${platform}:${newsId}`, "1", { ex: 60 * 60 * 24 * 30 });

    console.log(`✅ Posted [${platform}] for news ${newsId}`);
    return res.json({ success: true, platform, newsId, videoUrl: finalUrl });

  } catch (err) {
    safeDelete(imgFile, vidFile);
    console.error(`❌ postNewsItem [${platform}] error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};