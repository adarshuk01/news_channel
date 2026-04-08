"use strict";

const path = require("path");
const fs   = require("fs");

const newsService   = require("../services/newsServices");
const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");
const cloudinary    = require("../config/cloudinary");
const redis         = require("../config/redis");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { TMP, safeDelete, cleanImageUrl } = require("../utils/fileUtils");
const { uploadShort } = require("../services/youtubeShorts");


// ✅ Keep Malayalam + Numbers
function keepMalayalamAndSpaces(text) {
  if (!text) return "";
  return text
    .replace(/[^\u0D00-\u0D7F0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ Safe YouTube title
function getSafeYouTubeTitle(text) {
  if (!text || !text.trim()) {
    return "Latest News #Shorts";
  }

  return text
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

const SOURCE_CONFIG = {
  manorama: {
    fetchFn:   () => newsService.fetchManoramaLatestNews(),
    itemIndex: 0,
    redisKey:  "last-posted-title-manorama",
    label:     "Manorama",
  },
  asianet: {
    fetchFn:   () => newsService.fetchAsianetLatestNews(),
    itemIndex: 0,
    redisKey:  "last-posted-title-asianet",
    label:     "Asianet",
  },
};

async function runNewsPipeline(config, res) {
  const { fetchFn, itemIndex, redisKey, label } = config;

  console.log(`🕒 CRON HIT (${label}):`, new Date().toISOString());

  const timestamp   = Date.now();
  const imgFilePath = path.join(TMP, `poster-${label.toLowerCase()}-${timestamp}.png`);
  const vidFilePath = path.join(TMP, `poster-${label.toLowerCase()}-${timestamp}.mp4`);

  try {
    // 1 — Fetch news
    const news = await fetchFn();
    if (!news.length) {
      return res.status(400).json({ message: `No ${label} news found` });
    }

    const item = news[itemIndex] ?? news[0];

    const cleanTitle = keepMalayalamAndSpaces(item.title);
    const imageUrl = cleanImageUrl(item.image);

    console.log("📰 Original Title:", item.title);
    console.log("🧹 Clean Title:", cleanTitle);

    const safeTitle = getSafeYouTubeTitle(cleanTitle);

    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    console.log("🎯 FINAL TITLE:", finalTitle);

    // 2 — Duplicate check
    const lastTitle = await redis.get(redisKey);
    if (lastTitle && lastTitle === item.title) {
      console.log(`⏭️ Skipped duplicate`);
      return res.status(200).json({ message: "Skipped duplicate" });
    }

    // 3 — Generate hashtags
    const hashtags = await aiService.generateHashtags(
      `${item.title} ${item.summary}`
    );

    // 4 — Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title: cleanTitle || item.title,
      image: imageUrl,
    });

    fs.writeFileSync(imgFilePath, pngBuffer);

    // 5 — Convert to video
    await videoService.convertImageToVideo(imgFilePath, vidFilePath);

    // 6 — Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(vidFilePath, {
      resource_type: "video",
      folder: "news_posters",
    });

    const finalUrl = upload.secure_url;
    console.log("🔗 Cloudinary URL:", finalUrl);

    // ✅ 7 — SAFE MULTI-PLATFORM POSTING (IMPORTANT FIX)
    const platforms = [
      {
        name: "Instagram",
        fn: () =>
          postReelToInstagram(
            finalUrl,
            `${item.summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags} #kerala #malayalam #news`
          ),
      },
      // {
      //   name: "Facebook",
      //   fn: () =>
      //     postReelToFacebook(
      //       finalUrl,
      //       `${item.summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n${hashtags}`
      //     ),
      // },
      // {
      //   name: "YouTube",
      //   fn: () =>
      //     uploadShort(
      //       vidFilePath,
      //       finalTitle,
      //       `${item.summary}\n\n${hashtags} #Shorts`
      //     ),
      // },
    ];

    const results = await Promise.allSettled(
      platforms.map((p) => p.fn())
    );

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`✅ ${platforms[i].name} posted`);
      } else {
        console.error(
          `❌ ${platforms[i].name} failed:`,
          result.reason?.message
        );
      }
    });

    // 8 — Cleanup
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    // ✅ IMPORTANT: Save to Redis EVEN IF YouTube fails
    await redis.set(redisKey, item.title);

    return res.json({
      message: `✅ ${label} processed`,
      videoUrl: finalUrl,
      title: finalTitle,
      results: results.map((r, i) => ({
        platform: platforms[i].name,
        status: r.status,
      })),
    });

  } catch (err) {
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    console.error("❌ ERROR:", err.message);

    return res.status(500).json({
      error: "Failed",
      details: err.message,
    });
  }
}

exports.postLatestNews  = (req, res) =>
  runNewsPipeline(SOURCE_CONFIG.manorama, res);

exports.postAsianetNews = (req, res) =>
  runNewsPipeline(SOURCE_CONFIG.asianet, res);