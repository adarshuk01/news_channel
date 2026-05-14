"use strict";

const crypto = require("crypto");
const path   = require("path");
const fs     = require("fs");

const newsService   = require("../services/newsServices");
const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");

const cloudinary = require("../config/cloudinary");
const redis      = require("../config/redis");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { uploadShort }         = require("../services/youtubeShorts");

const { getNextAdBannerUrl } =
  require("./adBannerController");

const {
  TMP,
  safeDelete,
  cleanImageUrl
} = require("../utils/fileUtils");

const PLATFORMS = [
  "instagram",
  "facebook",
  "youtube"
];


// ─────────────────────────────────────────────
// Stable ID
// ─────────────────────────────────────────────
function makeNewsId(title) {
  return crypto
    .createHash("md5")
    .update(title || "")
    .digest("hex")
    .slice(0, 12);
}


// ─────────────────────────────────────────────
// GET NEWS LIST
// ─────────────────────────────────────────────
exports.getNewsList = async (req, res) => {

  try {

    const allNews =
      await newsService.fetchAllLatestNews();

    const news = allNews.map((item) => ({
      id:      makeNewsId(item.title),
      title:   item.title,
      summary: item.summary || "",
      image:   item.image || "",
      link:    item.link || "",
      channel: item.channel || "",
      icon:    item.icon || "",
    }));

    return res.json({
      news,
      total: news.length
    });

  } catch (err) {

    console.error(
      "❌ getNewsList error:",
      err.message
    );

    return res.status(500).json({
      error: err.message
    });
  }
};


// ─────────────────────────────────────────────
// GET POST STATUS
// ─────────────────────────────────────────────
exports.getPostStatus = async (req, res) => {

  try {

    const ids =
      (req.query.ids || "")
        .split(",")
        .filter(Boolean);

    const statuses = {};

    for (const id of ids) {

      const [insta, fb, yt] =
        await Promise.all([

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

    console.error(
      "❌ getPostStatus error:",
      err.message
    );

    return res.status(500).json({
      error: err.message
    });
  }
};


// ─────────────────────────────────────────────
// POST NEWS ITEM
// ─────────────────────────────────────────────
exports.postNewsItem = async (req, res) => {

  const {
    newsId,
    platform,
    title,
    summary: originalSummary,
    image
  } = req.body;


  // ─── Validation ────────────────────────────
  if (!newsId || !platform || !title) {

    return res.status(400).json({
      error:
        "newsId, platform and title are required."
    });
  }

  if (!PLATFORMS.includes(platform)) {

    return res.status(400).json({
      error:
        `Invalid platform. Must be one of: ${PLATFORMS.join(", ")}.`
    });
  }


  // ─── Already posted? ───────────────────────
  const alreadyPosted =
    await redis.get(
      `posted:${platform}:${newsId}`
    );

  if (alreadyPosted) {

    return res.status(409).json({
      error: `Already posted to ${platform}.`,
      posted: true
    });
  }


  const timestamp =
    Date.now();

  const imgFile =
    path.join(
      TMP,
      `newsitem-${newsId}-${timestamp}.png`
    );

  const vidFile =
    path.join(
      TMP,
      `newsitem-${newsId}-${timestamp}.mp4`
    );


  try {

    console.log(
      `🚀 Posting [${platform}]`
    );


    // ────────────────────────────────────────
    // AI CACHE
    // ────────────────────────────────────────
    const aiCacheKey =
      `ai:${newsId}`;

    let aiContent;

    const cached =
      await redis.get(aiCacheKey);

    if (cached) {

      console.log("⚡ AI cache hit");

      aiContent = JSON.parse(cached);

    } else {

      console.log("🤖 Generating AI content");

      aiContent =
        await aiService.generateNewsContent(

          `${title}

${(originalSummary || "").slice(0, 500)}`
        );

      await redis.set(
        aiCacheKey,
        JSON.stringify(aiContent),
        {
          ex: 60 * 60 * 24
        }
      );
    }


    // ────────────────────────────────────────
    // Extract AI Data
    // ────────────────────────────────────────
    const finalSummary =
      aiContent.summary ||
      originalSummary ||
      "";

    const caption =
      aiContent.caption ||
      finalSummary;

    const hashtags =
      aiContent.hashtags ||
      "#kerala #malayalam #news";


    // ────────────────────────────────────────
    // Ad Banner
    // ────────────────────────────────────────
    const adBannerUrl =
      await getNextAdBannerUrl();


    // ────────────────────────────────────────
    // Create Poster
    // ────────────────────────────────────────
    const pngBuffer =
      await canvasService.createNewsPoster({

        title,

        summary: finalSummary,

        image:
          cleanImageUrl(image),

        adBannerUrl,
      });

    fs.writeFileSync(
      imgFile,
      pngBuffer
    );


    // ────────────────────────────────────────
    // Convert to Video
    // ────────────────────────────────────────
    await videoService.convertImageToVideo(
      imgFile,
      vidFile
    );


    // ────────────────────────────────────────
    // Upload to Cloudinary
    // ────────────────────────────────────────
    const upload =
      await cloudinary.uploader.upload(
        vidFile,
        {
          resource_type: "video",
          folder: "news_posters",
        }
      );

    const finalUrl =
      upload.secure_url;

    console.log(
      "🔗 Cloudinary URL:",
      finalUrl
    );


    // ────────────────────────────────────────
    // Cleanup temp
    // ────────────────────────────────────────
    safeDelete(imgFile);
    safeDelete(vidFile);


    // ────────────────────────────────────────
    // Captions
    // ────────────────────────────────────────
    const safeTitle =
      (title || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);

    const finalTitle =
      `${safeTitle} 🔥 #Shorts`;

    const captions = {

      instagram: `
${caption}

കൂടുതൽ വാർത്തകൾക്ക് ഫോളോ ചെയ്യൂ ❤️

${hashtags}

#kerala #malayalam #keralanews
`.trim(),

      facebook: `
${caption}

${hashtags}
`.trim(),

      youtube: `
${caption}

${hashtags}

#Shorts
`.trim(),
    };


    // ────────────────────────────────────────
    // POST
    // ────────────────────────────────────────
    if (platform === "instagram") {

      await postReelToInstagram(
        finalUrl,
        captions.instagram
      );
    }

    if (platform === "facebook") {

      await postReelToFacebook(
        finalUrl,
        captions.facebook
      );
    }

    if (platform === "youtube") {

      await uploadShort(
        finalUrl,
        finalTitle,
        captions.youtube
      );
    }


    // ────────────────────────────────────────
    // Mark Posted
    // ────────────────────────────────────────
    await redis.set(
      `posted:${platform}:${newsId}`,
      "1",
      {
        ex: 60 * 60 * 24 * 30
      }
    );


    console.log(
      `✅ Posted [${platform}]`
    );

    return res.json({

      success: true,

      platform,

      newsId,

      videoUrl: finalUrl,

      ai: {
        summary: finalSummary,
        caption,
        hashtags
      }
    });

  } catch (err) {

    safeDelete(imgFile);
    safeDelete(vidFile);

    console.error(
      `❌ postNewsItem [${platform}] error:`,
      err.message
    );

    return res.status(500).json({
      error: err.message
    });
  }
};