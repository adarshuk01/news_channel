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


// ─────────────────────────────────────────────────────────────
// 📁 Ad Banner Folder
// ─────────────────────────────────────────────────────────────
const AD_BANNERS_DIR = path.join(__dirname, "../adBanners");
const AD_EXTENSIONS  = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function getNextAdBannerPath() {
  if (!fs.existsSync(AD_BANNERS_DIR)) {
    console.warn("⚠️  adBanners folder not found:", AD_BANNERS_DIR);
    return null;
  }

  const files = fs.readdirSync(AD_BANNERS_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return AD_EXTENSIONS.has(ext) && !f.startsWith(".");
  });

  if (!files.length) {
    console.warn("⚠️  No ad banners found in:", AD_BANNERS_DIR);
    return null;
  }

  const REDIS_KEY  = "ad-banner-index";
  const rawIndex   = await redis.get(REDIS_KEY);
  const currentIdx = rawIndex ? parseInt(rawIndex, 10) : 0;
  const safeIdx    = currentIdx % files.length;
  const nextIdx    = (safeIdx + 1) % files.length;

  await redis.set(REDIS_KEY, String(nextIdx));

  const chosenFile = files[safeIdx];
  console.log(`🖼️  Ad Banner [${safeIdx + 1}/${files.length}]: ${chosenFile}`);

  return path.join(AD_BANNERS_DIR, chosenFile);
}


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function keepMalayalamAndSpaces(text) {
  if (!text) return "";
  return text
    .replace(/[^\u0D00-\u0D7F0-9\s,.\-"'?!:;()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSafeYouTubeTitle(text) {
  if (!text || !text.trim()) return "Latest News #Shorts";
  return text.toString().replace(/\s+/g, " ").trim().slice(0, 90);
}


// ─────────────────────────────────────────────────────────────
// Source configuration
// ─────────────────────────────────────────────────────────────
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


// ─────────────────────────────────────────────────────────────
// preparePlatformPayload
// Fetches news for one source, builds poster → video →
// uploads to Cloudinary, and returns everything needed to post.
// ─────────────────────────────────────────────────────────────
async function preparePlatformPayload(sourceKey) {
  const { fetchFn, itemIndex, redisKey, label } = SOURCE_CONFIG[sourceKey];

  console.log(`📰 Preparing payload for: ${label}`);

  const timestamp   = Date.now();
  const imgFilePath = path.join(TMP, `poster-${label.toLowerCase()}-${timestamp}.png`);
  const vidFilePath = path.join(TMP, `poster-${label.toLowerCase()}-${timestamp}.mp4`);

  try {
    // 1 — Fetch news
    const news = await fetchFn();
    if (!news.length) throw new Error(`No ${label} news found`);

    const item       = news[itemIndex] ?? news[0];
    const cleanTitle = keepMalayalamAndSpaces(item.title);
    const imageUrl   = cleanImageUrl(item.image);

    console.log(`📰 [${label}] Title:`, item.title);

    // 2 — Duplicate check
    const lastTitle = await redis.get(redisKey);
    if (lastTitle && lastTitle === item.title) {
      console.log(`⏭️  [${label}] Skipped duplicate: "${item.title}"`);
      return { label, isDuplicate: true };
    }

    const safeTitle  = getSafeYouTubeTitle(cleanTitle);
    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    // 3 — Generate hashtags
    const hashtags = await aiService.generateHashtags(`${item.title} ${item.summary}`);

// const hashtags ='#gaintrick #thrissur #photooftheday #entekeralam #trivandrum #likeforfollow #keralaattraction #byelection #election #like #instadaily #tamil #keraladiaries #travel #malayalamcinema #chuvadelikes #follow #delhi #followforfollowback #mohanlal #gaintrain #naturephotography #gainparty #nilambur #keralaphotography #followtrain #bangalore #model #karnataka #travelphotography'

    // 4 — Pick ad banner (round-robin)
    const adBannerPath = await getNextAdBannerPath();

    // 5 — Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title:        cleanTitle || item.title,
      summary:      item.summary || "",
      image:        imageUrl,
      adBannerPath,
    });
    fs.writeFileSync(imgFilePath, pngBuffer);

    // 6 — Convert to video
    await videoService.convertImageToVideo(imgFilePath, vidFilePath);

    // 7 — Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(vidFilePath, {
      resource_type: "video",
      folder:        "news_posters",
    });
    const finalUrl = upload.secure_url;
    console.log(`🔗 [${label}] Cloudinary URL:`, finalUrl);

    // 8 — Cleanup temp files
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    // 9 — Save title to Redis
    await redis.set(redisKey, item.title);

    return {
      label,
      finalUrl,
      finalTitle,
      summary:      item.summary,
      hashtags,
      adBannerUsed: adBannerPath ? path.basename(adBannerPath) : "none",
    };

  } catch (err) {
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);
    throw err;
  }
}


// ─────────────────────────────────────────────────────────────
// buildCaptions
// ─────────────────────────────────────────────────────────────
function buildCaptions(summary, hashtags) {
  return {
    instagram: `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n ${hashtags}  #kerala #malayalam #keralagoodnews #keralanews #മലയാളം`,
    facebook:  `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n ${hashtags}`,
    youtube:   `${summary}\n\n${hashtags} #Shorts`,
  };
}


// ─────────────────────────────────────────────────────────────
// Shared response formatter
// ─────────────────────────────────────────────────────────────
function formatResult(payload, result, platform) {
  return {
    source:       payload.label,
    videoUrl:     payload.finalUrl,
    title:        payload.finalTitle,
    adBannerUsed: payload.adBannerUsed,
    status:       result.status,
    error:        result.reason?.message ?? null,
  };
}


// ─────────────────────────────────────────────────────────────
// POST /api/post-instagram
// Prepares Manorama + Asianet in parallel, then posts BOTH
// to Instagram simultaneously.
// ─────────────────────────────────────────────────────────────
exports.postToInstagram = async (req, res) => {
  console.log("🕒 INSTAGRAM POST HIT:", new Date().toISOString());

  try {
    // Step 1 — Prepare both sources simultaneously
    const [manoramaPayload, asianetPayload] = await Promise.all([
      preparePlatformPayload("manorama"),
      preparePlatformPayload("asianet"),
    ]);

    // Step 2 — Filter out duplicates; post only fresh payloads
    const allPayloads = [manoramaPayload, asianetPayload];
    const fresh       = allPayloads.filter((p) => !p.isDuplicate);
    const duplicates  = allPayloads.filter((p) =>  p.isDuplicate);

    duplicates.forEach((p) => console.log(`⏭️  Instagram [${p.label}] skipped — duplicate`));

    console.log(`✅ ${fresh.length} fresh payload(s). Posting to Instagram simultaneously…`);

    // Step 3 — Post all fresh payloads simultaneously
    const freshResults = await Promise.allSettled(
      fresh.map((p) =>
        postReelToInstagram(
          p.finalUrl,
          buildCaptions(p.summary, p.hashtags).instagram
        )
      )
    );

    freshResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`✅ Instagram [${fresh[i].label}] posted`);
      } else {
        console.error(`❌ Instagram [${fresh[i].label}] failed:`, result.reason?.message);
      }
    });

    return res.json({
      message:  "✅ Instagram posting complete",
      platform: "instagram",
      results: [
        ...fresh.map((p, i) => formatResult(p, freshResults[i])),
        ...duplicates.map((p)  => ({ source: p.label, status: "skipped", reason: "duplicate" })),
      ],
    });

  } catch (err) {
    console.error("❌ postToInstagram ERROR:", err.message);
    return res.status(500).json({ error: "Failed", details: err.message });
  }
};


// ─────────────────────────────────────────────────────────────
// POST /api/post-facebook
// Prepares Manorama + Asianet in parallel, then posts BOTH
// to Facebook simultaneously.
// ─────────────────────────────────────────────────────────────
exports.postToFacebook = async (req, res) => {
  console.log("🕒 FACEBOOK POST HIT:", new Date().toISOString());

  try {
    // Step 1 — Prepare both sources simultaneously
    const [manoramaPayload, asianetPayload] = await Promise.all([
      preparePlatformPayload("manorama"),
      preparePlatformPayload("asianet"),
    ]);

    // Step 2 — Filter out duplicates; post only fresh payloads
    const allPayloads = [manoramaPayload, asianetPayload];
    const fresh       = allPayloads.filter((p) => !p.isDuplicate);
    const duplicates  = allPayloads.filter((p) =>  p.isDuplicate);

    duplicates.forEach((p) => console.log(`⏭️  Facebook [${p.label}] skipped — duplicate`));

    console.log(`✅ ${fresh.length} fresh payload(s). Posting to Facebook simultaneously…`);

    // Step 3 — Post all fresh payloads simultaneously
    const freshResults = await Promise.allSettled(
      fresh.map((p) =>
        postReelToFacebook(
          p.finalUrl,
          buildCaptions(p.summary, p.hashtags).facebook
        )
      )
    );

    freshResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`✅ Facebook [${fresh[i].label}] posted`);
      } else {
        console.error(`❌ Facebook [${fresh[i].label}] failed:`, result.reason?.message);
      }
    });

    return res.json({
      message:  "✅ Facebook posting complete",
      platform: "facebook",
      results: [
        ...fresh.map((p, i) => formatResult(p, freshResults[i])),
        ...duplicates.map((p)  => ({ source: p.label, status: "skipped", reason: "duplicate" })),
      ],
    });

  } catch (err) {
    console.error("❌ postToFacebook ERROR:", err.message);
    return res.status(500).json({ error: "Failed", details: err.message });
  }
};


// ─────────────────────────────────────────────────────────────
// POST /api/post-youtube
// Prepares Manorama + Asianet in parallel, then uploads BOTH
// to YouTube Shorts simultaneously.
// ─────────────────────────────────────────────────────────────
exports.postToYoutube = async (req, res) => {
  console.log("🕒 YOUTUBE POST HIT:", new Date().toISOString());

  try {
    const [manoramaPayload, asianetPayload] = await Promise.all([
      preparePlatformPayload("manorama"),
      preparePlatformPayload("asianet"),
    ]);

    const allPayloads = [manoramaPayload, asianetPayload];
    const fresh       = allPayloads.filter((p) => !p.isDuplicate);
    const duplicates  = allPayloads.filter((p) =>  p.isDuplicate);

    duplicates.forEach((p) => console.log(`⏭️  YouTube [${p.label}] skipped — duplicate`));

    console.log(`✅ ${fresh.length} fresh payload(s). Uploading to YouTube simultaneously…`);

    const freshResults = await Promise.allSettled(
      fresh.map((p) =>
        uploadShort(
          p.finalUrl,
          p.finalTitle,
          buildCaptions(p.summary, p.hashtags).youtube
        )
      )
    );

    freshResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`✅ YouTube [${fresh[i].label}] uploaded`);
      } else {
        console.error(`❌ YouTube [${fresh[i].label}] failed:`, result.reason?.message);
      }
    });

    return res.json({
      message:  "✅ YouTube posting complete",
      platform: "youtube",
      results: [
        ...fresh.map((p, i) => formatResult(p, freshResults[i])),
        ...duplicates.map((p)  => ({ source: p.label, status: "skipped", reason: "duplicate" })),
      ],
    });

  } catch (err) {
    console.error("❌ postToYoutube ERROR:", err.message);
    return res.status(500).json({ error: "Failed", details: err.message });
  }
};