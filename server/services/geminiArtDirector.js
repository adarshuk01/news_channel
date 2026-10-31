// ═══════════════════════════════════════════════════════════════
// GEMINI ART DIRECTOR
//
// The canvas poster stays exactly as it is. Gemini (free-tier text
// model) only makes three *design decisions* for each story:
//
//   1. HEADLINE SPLIT   which words are emphasised (gold / accent) and
//                       where the lines break
//   2. ACCENT COLOUR    gold (default) | red (breaking, crime, accident,
//                       disaster) | green (sports)
//   3. PHOTO FOCUS      where the main subject sits in the photo, so the
//                       wide crop at the bottom keeps it in frame
//
// The model never writes or edits the headline. It only returns word
// NUMBERS; the text is rebuilt from your original words, so the
// Malayalam is always character-for-character correct.
//
// getDirection() returns null on ANY problem (no key, rate limit, quota,
// timeout, bad JSON, safety block…) and the poster is then drawn with the
// normal design. It never throws.
//
// ENV (all optional except a key):
//   GEMINI_API_KEY          one key, or several separated by commas
//                           (the next key is tried when one hits its limit)
//   GEMINI_DIRECTOR_ENABLED "false" switches the art director off
//   GEMINI_DIRECTOR_MODELS  comma list tried in order
//                           default "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash"
//   GEMINI_DIRECTOR_TIMEOUT_MS  per request, default 15000
//   GEMINI_DIRECTOR_SEND_IMAGE  "false" = text only (no photo focus)
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");
const fs     = require("fs");
try { require("dotenv").config(); } catch { /* dotenv optional here */ }

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const ACCENTS = ["gold", "red", "green"];
const CATEGORIES = [
  "breaking", "crime", "accident", "disaster", "sports",
  "politics", "entertainment", "business", "weather", "other",
];

// ── Config helpers ───────────────────────────────────────────
function getKeys() {
  return (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && !/PASTE_YOUR_KEY/i.test(k));
}

function getModels() {
  const list = (process.env.GEMINI_DIRECTOR_MODELS ||
    "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash")
    .split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : ["gemini-2.5-flash"];
}

function isEnabled() {
  return process.env.GEMINI_DIRECTOR_ENABLED !== "false" && getKeys().length > 0;
}

// ── Cool-downs: stop hammering a key/model that is rate-limited ──
const cooldownUntil = new Map(); // "key|model" -> epoch ms
const deadModels    = new Map(); // model -> epoch ms (404 / unsupported)

function pairAvailable(key, model) {
  const now = Date.now();
  return (cooldownUntil.get(`${key}|${model}`) || 0) <= now &&
         (deadModels.get(model) || 0) <= now;
}

function parseRetryMs(errBody, headers) {
  try {
    for (const d of errBody?.error?.details || []) {
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
  return status === 429 || st === "RESOURCE_EXHAUSTED" ||
         msg.includes("quota") || msg.includes("rate limit");
}

// ── Small result cache (same story + photo = same direction) ──
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(k) { return cache.get(k) || null; }
function cacheSet(k, v) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, v);
}

// ── Input helpers ────────────────────────────────────────────
function getTitleText(newsItem) {
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    return newsItem.titleLines
      .map((l) => (typeof l === "string" ? l : l?.text))
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return String(newsItem.title || "").replace(/\s+/g, " ").trim();
}

function splitWords(text) {
  return text.split(" ").filter(Boolean);
}

async function loadImageBuffer(image) {
  if (Buffer.isBuffer(image)) return image;
  if (typeof image !== "string") throw new Error("unsupported image input");
  if (image.startsWith("data:")) {
    return Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  }
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching news image`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(image);
}

// Small JPEG for the model (cheap + fast). Also returns the image size.
async function prepareImage(image) {
  const sharp = require("sharp");
  const raw = await loadImageBuffer(image);
  const jpeg = await sharp(raw)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  return jpeg;
}

// ── Prompt + schema ──────────────────────────────────────────
function buildPrompt({ words, summary, hasImage, photoRatio }) {
  const numbered = words.map((w, i) => `${i + 1}: ${w}`).join("\n");
  return [
    "You are the art director of a Malayalam (Kerala) news channel's social-media posters.",
    "A poster has a big headline on a black background and a news photo below it.",
    "You do NOT write or change any text. You only make design decisions about the headline words listed below, by their numbers.",
    "",
    "HEADLINE WORDS (numbered, 1-based):",
    numbered,
    summary ? `\nSTORY SUMMARY (context only, may be empty):\n${summary}` : "",
    "",
    "Decide:",
    "1. category: the main kind of story.",
    "2. accent: the poster accent colour.",
    '   - "red"   for breaking/urgent news, crime, accidents, deaths, disasters, violence.',
    '   - "green" for sports (cricket, football, athletics, games, tournaments).',
    '   - "gold"  for everything else (politics, entertainment, business, general news). When unsure, use "gold".',
    "3. emphasisStart / emphasisEnd: the word numbers (inclusive) of the part that carries the key news (who / what happened). It is drawn big in the accent colour; all other words are drawn smaller in white.",
    "   Usually it starts at word 1. Cover the strongest 1-5 words, not the whole headline unless the headline is very short.",
    "4. breakAfter: word numbers after which a new line starts, at natural phrase boundaries. Aim for lines of about 1-3 words in the emphasised part and 3-5 words in the white part, at most 6 lines overall. Do not list the boundary between emphasised and white words; that break is automatic.",
    hasImage
      ? `5. focusX / focusY: where the main subject of the attached photo is (face, person, vehicle, key object), as fractions of the photo from the top-left corner (0 to 1). The photo will be cropped to a wide band (about ${photoRatio}:1, width:height), so pick the point that must stay visible. If the subject is centred, use 0.5 and 0.5. Faces should be kept, so favour the upper part of a person.`
      : "5. focusX / focusY: use 0.5 and 0.5 (no photo is attached).",
    "",
    "Return only the JSON object.",
  ].filter((l) => l !== undefined).join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category:      { type: "string", enum: CATEGORIES },
    accent:        { type: "string", enum: ACCENTS },
    emphasisStart: { type: "integer" },
    emphasisEnd:   { type: "integer" },
    breakAfter:    { type: "array", items: { type: "integer" } },
    focusX:        { type: "number" },
    focusY:        { type: "number" },
  },
  required: ["category", "accent", "emphasisStart", "emphasisEnd", "breakAfter", "focusX", "focusY"],
};

// ── One request ──────────────────────────────────────────────
async function callGemini(key, model, prompt, imgBuf) {
  const timeoutMs = Number(process.env.GEMINI_DIRECTOR_TIMEOUT_MS) || 15000;

  const parts = [{ text: prompt }];
  if (imgBuf) {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: imgBuf.toString("base64") } });
  }

  const generationConfig = {
    temperature: 0.4,
    maxOutputTokens: 400,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
  };
  // 2.5 models "think" by default; this is a tiny task, so switch it off (faster, fewer free-tier tokens)
  if (/gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body:    JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal:  AbortSignal.timeout(timeoutMs),
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${json?.error?.message || res.statusText}`);
    err.status      = res.status;
    err.rateLimited = isRateLimit(res.status, json);
    err.retryMs     = parseRetryMs(json, res.headers);
    throw err;
  }

  const text = (json?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || "empty response";
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}

// ── Validate the model's answer. Every field is checked on its own,
//    so one bad field never spoils the others. ───────────────────
const clamp01 = (n) => Math.min(1, Math.max(0, n));

function sanitize(raw, wordCount) {
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/```json|```/gi, "").trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const out = {};

  if (CATEGORIES.includes(obj.category)) out.category = obj.category;
  if (ACCENTS.includes(obj.accent))      out.accent   = obj.accent;

  // Emphasis range (1-based, inclusive)
  const s = Math.round(Number(obj.emphasisStart));
  const e = Math.round(Number(obj.emphasisEnd));
  if (Number.isFinite(s) && Number.isFinite(e) && s >= 1 && e >= s && e <= wordCount) {
    out.emphasisStart = s;
    out.emphasisEnd   = e;
  }

  // Line breaks after word N (only between words, no duplicates, max 6 lines)
  if (Array.isArray(obj.breakAfter)) {
    const br = [...new Set(
      obj.breakAfter.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 1 && n < wordCount)
    )].sort((a, b) => a - b);
    if (br.length) out.breakAfter = br.slice(0, 5);
  }

  const fx = Number(obj.focusX), fy = Number(obj.focusY);
  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    out.focus = { x: clamp01(fx), y: clamp01(fy) };
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Turn the word numbers into headline lines, using ONLY the original words.
 * Lines are { text, yellow } — yellow = emphasised (accent colour).
 * Returns null when the plan has no usable emphasis range.
 */
function buildLines(words, plan) {
  if (!plan || !plan.emphasisStart) return null;

  const n = words.length;
  const breaks = new Set(plan.breakAfter || []);
  // Emphasis boundaries always start a new line
  if (plan.emphasisStart > 1) breaks.add(plan.emphasisStart - 1);
  if (plan.emphasisEnd < n)   breaks.add(plan.emphasisEnd);

  const lines = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    if (breaks.has(i + 1) || i === n - 1) {
      const idxFirst = i + 1 - cur.length + 1; // 1-based number of first word on this line
      lines.push({
        text:   cur.join(" "),
        yellow: idxFirst >= plan.emphasisStart && idxFirst <= plan.emphasisEnd,
      });
      cur = [];
    }
  });

  // Safety net: the lines must contain exactly the original words, in order
  if (lines.map((l) => l.text).join(" ") !== words.join(" ")) return null;
  return lines;
}

/**
 * Ask Gemini for the design direction of one poster.
 *
 * @param {object} newsItem  same object that goes to createNewsPoster
 * @returns {Promise<null | {
 *   accent?: "gold"|"red"|"green",
 *   category?: string,
 *   focus?: {x:number, y:number},
 *   lines?: {text:string, yellow:boolean}[],
 * }>}
 */
async function getDirection(newsItem, { photoRatio = "1.6" } = {}) {
  try {
    if (!isEnabled() || newsItem.aiDirector === false) return null;

    const title = getTitleText(newsItem);
    const words = splitWords(title);
    if (!words.length) return null;

    // Photo (optional, used for the crop focus)
    let imgBuf = null;
    if (process.env.GEMINI_DIRECTOR_SEND_IMAGE !== "false" && newsItem.image) {
      try {
        imgBuf = await prepareImage(newsItem.image);
      } catch (e) {
        console.warn("[Director] Photo not sent (focus stays centred):", e.message);
      }
    }

    const summary = String(newsItem.summary || "").replace(/\s+/g, " ").trim().slice(0, 400);

    const cacheKey = crypto.createHash("sha1")
      .update(title).update("|").update(summary)
      .update("|").update(imgBuf ? crypto.createHash("sha1").update(imgBuf).digest("hex") : "no-img")
      .digest("hex");

    let plan = cacheGet(cacheKey);
    if (!plan) {
      const prompt = buildPrompt({ words, summary, hasImage: !!imgBuf, photoRatio });
      const keys   = getKeys();
      const models = getModels();

      outer:
      for (const model of models) {
        for (const key of keys) {
          if (!pairAvailable(key, model)) continue;
          try {
            const text = await callGemini(key, model, prompt, imgBuf);
            plan = sanitize(text, words.length);
            if (plan) {
              console.log(`[Director] ✅ ${model}: accent=${plan.accent || "-"} category=${plan.category || "-"}`);
              cacheSet(cacheKey, plan);
              break outer;
            }
            console.warn(`[Director] ${model}: unusable answer`);
          } catch (e) {
            if (e.rateLimited) {
              // Short per-minute limit → wait what Google says; otherwise assume daily quota
              const wait = e.retryMs && e.retryMs <= 10 * 60 * 1000 ? e.retryMs + 1000 : 30 * 60 * 1000;
              cooldownUntil.set(`${key}|${model}`, Date.now() + wait);
              console.warn(`[Director] Rate limit on ${model} — paused ${Math.round(wait / 1000)}s`);
            } else if (e.status === 404 || e.status === 400) {
              // Model name not available / request shape not supported → skip this model for a while
              deadModels.set(model, Date.now() + 10 * 60 * 1000);
              console.warn(`[Director] ${model} unavailable: ${e.message}`);
              continue outer;
            } else {
              // timeout / network / server error: do not stack more waits, go straight to the default design
              console.warn(`[Director] ${model} failed: ${e.message}`);
              break outer;
            }
          }
        }
      }
    }

    if (!plan) {
      console.warn("[Director] No direction available — using the default design");
      return null;
    }

    const result = {};
    if (plan.accent)   result.accent   = plan.accent;
    if (plan.category) result.category = plan.category;
    if (plan.focus)    result.focus    = plan.focus;
    const lines = buildLines(words, plan);
    if (lines) result.lines = lines;

    return Object.keys(result).length ? result : null;
  } catch (e) {
    console.warn("[Director] Crashed, using the default design:", e.message);
    return null;
  }
}

module.exports = {
  getDirection,
  isEnabled,
  // exported for tests
  _internal: { sanitize, buildLines, splitWords },
};
