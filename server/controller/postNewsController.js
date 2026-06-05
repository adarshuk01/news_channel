"use strict";

const path = require("path");
const fs   = require("fs");

const newsService   = require("../services/newsServices");
const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");
const cloudinary    = require("../config/cloudinary");
const redis         = require("../config/redis");
const openai        = require("../config/openai");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { TMP, safeDelete, cleanImageUrl } = require("../utils/fileUtils");
const { uploadShort } = require("../services/youtubeShorts");

// ─────────────────────────────────────────────────────────────────────────────
// 🖼️  Ad Banner — fetched from Cloudinary via Redis
// ─────────────────────────────────────────────────────────────────────────────
const { getNextAdBannerUrl } = require("./adBannerController");


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


// ─────────────────────────────────────────────────────────────
// 🔒 Redis helpers — safe wrappers that never throw
//
// Upstash REST client returns the actual value (not a JSON string).
// It stores arrays/objects as-is via @upstash/redis's auto-serialization.
// All errors are caught so Redis being down never crashes a post.
// ─────────────────────────────────────────────────────────────
const REDIS_KEY = "posted-titles-instagram"; // stores string[]

async function getPostedTitles() {
  try {
    const value = await redis.get(REDIS_KEY);
    // Upstash already deserializes — value is string[] or null
    if (Array.isArray(value)) return value;
    return [];
  } catch (err) {
    console.warn("⚠️  Redis read failed:", err.message);
    return [];
  }
}

async function savePostedTitle(title) {
  try {
    const list = await getPostedTitles();
    // Prepend newest, cap at 50
    const updated = [title, ...list.filter((t) => t !== title)].slice(0, 50);
    await redis.set(REDIS_KEY, updated);
    console.log(`💾 Saved to Redis: "${title}"`);
  } catch (err) {
    console.warn("⚠️  Redis write failed:", err.message);
  }
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
// 🤖 selectViralNewsWithAI
// 1. Fetches latest 3 news from ALL 5 channels (up to 15 items)
// 2. Filters out already-posted titles via Redis
// 3. Sends fresh candidates to AI with index numbers
// 4. AI returns the single index with highest viral potential
// ─────────────────────────────────────────────────────────────
async function selectViralNewsWithAI() {
  console.log("🔍 Fetching latest 3 news from all channels for AI selection...");

  // Fetch top 3 from all 5 channels simultaneously
  const [
    manoramaResult,
    asianetResult,
    mediaoneResult,
    oneindiaResult,
    news18Result,
  ] = await Promise.allSettled([
    newsService.fetchManoramaLatestNews(),
    newsService.fetchAsianetLatestNews(),
    newsService.fetchMediaOneLatestNews(),
    newsService.fetchOneindiaLatestNews(),
    newsService.fetchNews18LatestNews(),
  ]);

  // Collect up to 3 items from each channel
  const allCandidates = [];

  const channelResults = [
    { label: "Manorama", result: manoramaResult },
    { label: "Asianet",  result: asianetResult  },
    { label: "MediaOne", result: mediaoneResult },
    { label: "Oneindia", result: oneindiaResult },
    { label: "News18",   result: news18Result   },
  ];

  for (const { label, result } of channelResults) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      const top3 = result.value.slice(0, 3);
      top3.forEach((item) => allCandidates.push({ ...item, channelLabel: label }));
      console.log(`  ✅ ${label}: ${top3.length} news fetched`);
    } else {
      console.warn(`  ⚠️  ${label}: fetch failed — ${result.reason?.message}`);
    }
  }

  if (allCandidates.length === 0) {
    throw new Error("No news candidates fetched from any channel");
  }

  // ── Duplicate filter: keep only titles not yet posted ──
  const postedTitles = await getPostedTitles();
  const postedSet    = new Set(postedTitles);

  const freshCandidates = allCandidates.filter((item) => {
    if (postedSet.has(item.title)) {
      console.log(`⏭️  Skipping duplicate: "${item.title}"`);
      return false;
    }
    return true;
  });

  // Fallback: if everything is a duplicate (rare), use all candidates
  const candidates = freshCandidates.length > 0 ? freshCandidates : allCandidates;

  if (freshCandidates.length === 0) {
    console.warn("⚠️  All candidates are duplicates — using full list as fallback");
  }

  console.log(`📋 Fresh: ${candidates.length} / ${allCandidates.length} candidates. Asking AI to pick the best...`);

  // Build numbered list for AI
  const newsList = candidates
    .map((item, idx) =>
      `Index ${idx}:\nChannel: ${item.channelLabel}\nTitle: ${item.title}\nSummary: ${(item.summary || "").slice(0, 200)}`
    )
    .join("\n\n");

  // Ask AI to pick the most viral item
  const aiResponse = await openai.chat.completions.create({
    model: "openai/gpt-oss-120b",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You are a viral social media expert specializing in Malayalam news for Instagram Reels.
Pick the single news item that will get the HIGHEST reach and engagement on Instagram.

Prioritize:
- Breaking news or shocking revelations
- Stories affecting many people (politics, economy, disasters, crimes)
- Emotional or human interest stories
- Trending topics or controversial events
- Celebrity / film / sports news

Respond with ONLY the index number (e.g., 4) — nothing else.`,
      },
      {
        role: "user",
        content: `Pick the best index for maximum Instagram reach:\n\n${newsList}\n\nRespond with ONLY the index number.`,
      },
    ],
  });

  const rawAnswer   = aiResponse.choices[0].message.content.trim();
  const chosenIndex = parseInt(rawAnswer, 10);

  if (isNaN(chosenIndex) || chosenIndex < 0 || chosenIndex >= candidates.length) {
    console.warn(`⚠️  AI returned invalid index "${rawAnswer}", defaulting to index 0`);
    return candidates[0];
  }

  const chosen = candidates[chosenIndex];
  console.log(`🎯 AI selected Index ${chosenIndex}: [${chosen.channelLabel}] "${chosen.title}"`);
  return chosen;
}


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

    const safeTitle  = getSafeYouTubeTitle(cleanTitle);
    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    // 3 — Generate hashtags
    const hashtags = await aiService.generateHashtags(`${item.title} ${item.summary}`);

    // 4 — Pick ad banner (round-robin)
    const adBannerUrl = await getNextAdBannerUrl();

    // 5 — Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title:        cleanTitle || item.title,
      summary:      item.summary || "",
      image:        imageUrl,
      adBannerUrl,
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
      adBannerUsed: adBannerUrl ? adBannerUrl.split("/").pop() : "none",
    };

  } catch (err) {
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);
    throw err;
  }
}


// ─────────────────────────────────────────────────────────────
// preparePayloadFromNewsItem
// Accepts a pre-selected news item (from AI selection),
// builds poster → video → uploads to Cloudinary.
// ─────────────────────────────────────────────────────────────
async function preparePayloadFromNewsItem(item) {
  const label     = item.channelLabel || item.channel || "AI-Selected";
  const timestamp = Date.now();
  const imgFilePath = path.join(TMP, `poster-ai-${timestamp}.png`);
  const vidFilePath = path.join(TMP, `poster-ai-${timestamp}.mp4`);

  try {
    const cleanTitle = keepMalayalamAndSpaces(item.title);
    const imageUrl   = cleanImageUrl(item.image);

    console.log(`📰 [AI-Selected | ${label}] Title: ${item.title}`);

    const safeTitle  = getSafeYouTubeTitle(cleanTitle);
    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    // Generate hashtags
    const hashtags = await aiService.generateHashtags(`${item.title} ${item.summary || ""}`);

    // Pick ad banner
    const adBannerUrl = await getNextAdBannerUrl();

    // Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title:        cleanTitle || item.title,
      summary:      item.summary || "",
      image:        imageUrl,
      adBannerUrl,
    });
    fs.writeFileSync(imgFilePath, pngBuffer);

    // Convert to video
    await videoService.convertImageToVideo(imgFilePath, vidFilePath);

    // Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(vidFilePath, {
      resource_type: "video",
      folder:        "news_posters",
    });
    const finalUrl = upload.secure_url;
    console.log(`🔗 [AI-Selected] Cloudinary URL: ${finalUrl}`);

    // Cleanup
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    // Save posted title to Redis rolling list
    await savePostedTitle(item.title);

    return {
      label,
      finalUrl,
      finalTitle,
      summary:      item.summary || "",
      hashtags,
      adBannerUsed: adBannerUrl ? adBannerUrl.split("/").pop() : "none",
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
    instagram: ` \n ${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n ${hashtags}  #kerala #malayalam #keralagoodnews #keralanews #മലയാളം`,
    facebook:  `${summary}\nകൂടുതൽ അറിയാൻ 👉 ബയോയിലെ ലിങ്ക് ക്ലിക്ക് ചെയ്യൂ\n\n ${hashtags}`,
    youtube:   `${summary}\n\n${hashtags} #Shorts`,
  };
}


// ─────────────────────────────────────────────────────────────
// Shared response formatter
// ─────────────────────────────────────────────────────────────
function formatResult(payload, result) {
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
// 1. Fetches latest 3 news from ALL 5 channels (up to 15 items)
// 2. Filters duplicates via Redis before AI sees anything
// 3. AI picks the most viral fresh item by index
// 4. Safety-net duplicate check before any work begins
// 5. Builds poster/video and posts to Instagram
// ─────────────────────────────────────────────────────────────
exports.postToInstagram = async (req, res) => {
  console.log("🕒 INSTAGRAM POST HIT:", new Date().toISOString());

  try {
    // Step 1 — AI selects the most viral fresh news
    const selectedNews = await selectViralNewsWithAI();

    // Step 2 — Safety-net duplicate check before doing any heavy work
    const postedTitles = await getPostedTitles();
    if (postedTitles.includes(selectedNews.title)) {
      console.log(`⏭️  Instagram: AI-selected news is a duplicate — skipping`);
      return res.json({
        message: "⏭️  Skipped — already posted",
        platform: "instagram",
        aiSelectedNews: {
          channel: selectedNews.channelLabel || selectedNews.channel,
          title:   selectedNews.title,
        },
        results: [{ status: "skipped", reason: "duplicate" }],
      });
    }

    // Step 3 — Prepare poster + video for the chosen item
    const payload = await preparePayloadFromNewsItem(selectedNews);

    // Step 4 — Post to Instagram
    const caption = buildCaptions(payload.summary, payload.hashtags).instagram;

    const freshResults = await Promise.allSettled([
      postReelToInstagram(payload.finalUrl, caption),
    ]);

    freshResults.forEach((result) => {
      if (result.status === "fulfilled") {
        console.log(`✅ Instagram [${payload.label}] posted`);
      } else {
        console.error(`❌ Instagram [${payload.label}] failed:`, result.reason?.message);
      }
    });

    return res.json({
      message:        "✅ Instagram posting complete",
      platform:       "instagram",
      aiSelectedNews: {
        channel: selectedNews.channelLabel || selectedNews.channel,
        title:   selectedNews.title,
      },
      results: freshResults.map((result) => formatResult(payload, result)),
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
        ...duplicates.map((p) => ({ source: p.label, status: "skipped", reason: "duplicate" })),
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
        ...duplicates.map((p) => ({ source: p.label, status: "skipped", reason: "duplicate" })),
      ],
    });

  } catch (err) {
    console.error("❌ postToYoutube ERROR:", err.message);
    return res.status(500).json({ error: "Failed", details: err.message });
  }
};