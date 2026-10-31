// ═══════════════════════════════════════════════════════════════
// GEMINI POSTER SERVICE
//
// Generates poster artwork with Google Gemini (free-tier API key).
// Returns null on ANY problem (rate limit, quota, timeout, no key,
// safety block, bad response…) so the caller can fall back to the
// normal canvas poster.
//
// ENV (all optional except a key):
//   GEMINI_API_KEY          one key, or several separated by commas
//                           (extra keys are tried when one hits its limit)
//   GEMINI_POSTER_ENABLED   "false" to switch Gemini off completely
//   GEMINI_POSTER_MODE      "hybrid" (default) – Gemini paints the artwork,
//                           the headline is drawn by canvas with the
//                           real Malayalam font (always correct text)
//                           "full"   – Gemini draws artwork AND headline text
//   GEMINI_IMAGE_MODEL      default "gemini-3.1-flash-image" (Free-tier friendly)
//   GEMINI_TIMEOUT_MS       default 60000
// ═══════════════════════════════════════════════════════════════

const sharp = require("sharp");
const fs    = require("fs");
require("dotenv").config();

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getKeys() {
  return (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function isEnabled() {
  return process.env.GEMINI_POSTER_ENABLED !== "false" && getKeys().length > 0;
}

function getMode() {
  return process.env.GEMINI_POSTER_MODE === "full" ? "full" : "hybrid";
}

// ── Per-key cool-down so we stop hammering a key that is rate-limited ──
const cooldownUntil = new Map(); // key -> epoch ms

function keyAvailable(key) {
  return (cooldownUntil.get(key) || 0) <= Date.now();
}

function parseRetryMs(errBody, headers) {
  try {
    const details = errBody?.error?.details || [];
    for (const d of details) {
      if (d.retryDelay) {
        const s = parseFloat(String(d.retryDelay).replace("s", ""));
        if (!Number.isNaN(s)) return Math.ceil(s * 1000);
      }
    }
  } catch { /* ignore */ }
  const ra = headers?.get?.("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra) * 1000;
  return null;
}

function isRateLimit(status, body) {
  const msg = String(body?.error?.message || "").toLowerCase();
  const st  = String(body?.error?.status  || "");
  return (
    status === 429 ||
    st === "RESOURCE_EXHAUSTED" ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("limit: 0")
  );
}

// ── Load the news image into a JPEG buffer (URL / data URI / path / Buffer) ──
async function loadImageBuffer(image) {
  if (Buffer.isBuffer(image)) return image;
  if (typeof image !== "string") throw new Error("unsupported image input");

  if (image.startsWith("data:")) {
    const b64 = image.slice(image.indexOf(",") + 1);
    return Buffer.from(b64, "base64");
  }
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching news image`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(image);
}

// ── Prompt ────────────────────────────────────────────────────
function buildPrompt({ title, mode, channelName }) {
  const common = [
    "You are an expert news-poster designer for a Malayalam (Kerala) social-media news channel.",
    "Use the attached photograph as the real news photo. Keep its subject(s), faces and context recognisable and unaltered in meaning; do not invent people or events.",
    "Output ONE vertical 4:5 poster, premium breaking-news style: deep black base, rich gold/yellow accents, cinematic lighting, subtle golden glow at the top, high contrast, sharp and clean.",
    "The photograph occupies the LOWER half of the poster and its top edge fades smoothly into the black background.",
    "Do NOT add any watermark, border, UI chrome, social-media icons, logos or advertisement strip.",
  ];

  if (mode === "full") {
    return [
      ...common,
      "The UPPER half of the poster carries the headline, centred, in a very bold Malayalam news typeface: the first part in glowing gold/yellow, any remaining part in white and slightly smaller.",
      "Render the Malayalam headline EXACTLY, character for character, with correct Malayalam conjuncts and no extra, missing or invented letters, and do not translate it.",
      `HEADLINE (copy exactly): ${title}`,
      channelName ? `Small channel name centred between the headline and the photo: ${channelName}` : "",
    ].filter(Boolean).join("\n");
  }

  // hybrid – no text at all, space reserved for the headline
  return [
    ...common,
    "IMPORTANT: the poster must contain ABSOLUTELY NO TEXT, letters, numbers or captions anywhere.",
    "The UPPER ~48% of the poster must be an empty, dark, elegant area (black with a soft gold glow / light rays at the top) reserved for a headline that will be added later. Keep it clean and uncluttered.",
    "Leave a thin clear band just under that area, above the photo, for a channel name that will be added later.",
  ].join("\n");
}

// ── One call to the API with one key ──────────────────────────
async function callGemini(key, prompt, imgBuf) {
  // Use gemini-3.1-flash-image (Nano Banana 2) or standard free-tier image routes
  const model     = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 60000;

  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/jpeg", data: imgBuf.toString("base64") } },
      ],
    }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "4:5" },
    },
  };

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeoutMs),
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${json?.error?.message || res.statusText}`);
    err.status        = res.status;
    err.rateLimited = isRateLimit(res.status, json);
    err.retryMs     = parseRetryMs(json, res.headers);
    throw err;
  }

  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  
  for (const p of parts) {
    const base64Data = p.inlineData?.data || p.inline_data?.data;
    if (base64Data) return Buffer.from(base64Data, "base64");
  }

  const reason = json?.promptFeedback?.blockReason || candidate?.finishReason || "no image returned";
  throw new Error(`Gemini returned no image (${reason})`);
}

/**
 * Try to generate a poster with Gemini.
 * @returns {Promise<{ buffer: Buffer, mode: "hybrid"|"full" } | null>}
 *          buffer is exactly width x height PNG (cover-cropped)
 */
async function generatePosterImage(newsItem, { width, height }) {
  if (!isEnabled()) return null;

  const keys = getKeys().filter(keyAvailable);
  if (!keys.length) {
    console.warn("[Gemini] All keys are cooling down after rate limit — using canvas poster");
    return null;
  }

  const title = Array.isArray(newsItem.titleLines) && newsItem.titleLines.length
    ? newsItem.titleLines.map((l) => (typeof l === "string" ? l : l?.text)).filter(Boolean).join(" ")
    : (newsItem.title || "");

  if (!title.trim()) return null;

  let imgBuf;
  try {
    const raw = await loadImageBuffer(newsItem.image);
    imgBuf = await sharp(raw)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch (e) {
    console.warn("[Gemini] Could not prepare news image:", e.message);
    return null;
  }

  const mode   = getMode();
  const prompt = buildPrompt({
    title,
    mode,
    channelName: newsItem.showChannel === false ? "" : (newsItem.channelName || "flash keralam"),
  });

  for (const key of keys) {
    try {
      console.log(`[Gemini] Generating ${mode} poster…`);
      const out = await callGemini(key, prompt, imgBuf);

      const png = await sharp(out)
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();

      console.log("[Gemini] ✅ Poster generated");
      return { buffer: png, mode };
    } catch (e) {
      if (e.rateLimited) {
        const wait = e.retryMs && e.retryMs <= 10 * 60 * 1000 ? e.retryMs + 1000 : 30 * 60 * 1000;
        cooldownUntil.set(key, Date.now() + wait);
        console.warn(`[Gemini] Rate limit hit — key paused ${Math.round(wait / 1000)}s. ${e.message}`);
        continue; // try next key, if any
      }
      console.warn("[Gemini] Failed:", e.message);
      return null; // non-rate-limit failure: go straight to canvas
    }
  }

  console.warn("[Gemini] Rate limit on all keys — falling back to canvas poster");
  return null;
}

module.exports = { generatePosterImage, isEnabled };